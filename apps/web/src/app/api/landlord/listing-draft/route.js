export const dynamic = "force-dynamic";
// Fetching the landlord's site + a Claude extraction pass can take a while —
// same synchronous-route pattern as /api/lease-check.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchPage,
  htmlToText,
  extractImageCandidates,
  extractLinks,
  detectAppfolio,
  sameSite,
  DraftFetchError,
} from "@/lib/listingDraft/fetchSite";
import { extractListingDraft } from "@/lib/listingDraft/extract";
import { listingDraftRateLimited } from "@/lib/listingDraft/rateLimit";

// Friendly, detail-free messages per DraftFetchError code (CLAUDE.md security:
// never leak fetch internals). Unknown codes fall back to `unreachable`.
const FETCH_ERRORS = {
  bad_url: [400, "That doesn't look like a valid website address."],
  unsupported_scheme: [400, "Please paste a normal http(s) website address."],
  private_address: [400, "That address can't be used here."],
  blocked: [
    422,
    "Your website's security settings blocked our reader. You can still fill out the form manually.",
  ],
  unreachable: [
    422,
    "We couldn't reach that page. Double-check the address, or fill out the form manually.",
  ],
};

function fetchErrorResponse(err) {
  const [status, message] =
    FETCH_ERRORS[err.code] ?? FETCH_ERRORS.unreachable;
  return NextResponse.json({ error: message }, { status });
}

// When the pasted page is a thin marketing shell, follow up to two same-site
// links that look like they lead to the actual listings.
const LISTINGS_LINK_RE = /listing|apartment|rent|avail|propert|floor|unit|home|residen/i;
const THIN_TEXT_CHARS = 800;

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!["landlord", "super"].includes(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!rawUrl) {
      return NextResponse.json({ error: "Paste a website address first." }, { status: 400 });
    }
    // Be forgiving about a missing scheme — landlords paste "mysite.com".
    const pastedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

    const targetProperty =
      body.targetProperty && typeof body.targetProperty.name === "string"
        ? {
            name: body.targetProperty.name.slice(0, 200),
            address:
              typeof body.targetProperty.address === "string"
                ? body.targetProperty.address.slice(0, 200)
                : null,
            url:
              typeof body.targetProperty.url === "string" &&
              sameSite(body.targetProperty.url, pastedUrl)
                ? body.targetProperty.url
                : null,
          }
        : null;

    // AppFolio-hosted listing pages render empty without JS — and those
    // landlords have a better option: the existing PMS sync.
    if (detectAppfolio(pastedUrl)) {
      return NextResponse.json({ pms: "appfolio" });
    }

    let main;
    try {
      main = await fetchPage(pastedUrl);
    } catch (err) {
      if (err instanceof DraftFetchError) return fetchErrorResponse(err);
      throw err;
    }

    const pages = [{ url: main.finalUrl, text: htmlToText(main.html) }];
    let images = extractImageCandidates(main.html, main.finalUrl);
    const links = extractLinks(main.html, main.finalUrl);
    const appfolioLinked = detectAppfolio(main.finalUrl, main.html);

    // Secondary same-site pages (all landlord-initiated: either the property
    // they picked, or obvious listings links when the pasted page is thin).
    const followUrls = [];
    if (targetProperty?.url && targetProperty.url !== main.finalUrl) {
      followUrls.push(targetProperty.url);
    } else if (pages[0].text.length < THIN_TEXT_CHARS) {
      for (const l of links) {
        if (followUrls.length >= 2) break;
        if (LISTINGS_LINK_RE.test(`${l.url} ${l.text}`) && l.url !== main.finalUrl) {
          followUrls.push(l.url);
        }
      }
    }
    for (const u of followUrls) {
      try {
        const sub = await fetchPage(u);
        pages.push({ url: sub.finalUrl, text: htmlToText(sub.html) });
        images = images.concat(extractImageCandidates(sub.html, sub.finalUrl));
      } catch {
        // Secondary pages are best-effort; the pasted page alone still works.
      }
    }
    // Dedupe images across pages, keep the cap sane for the prompt.
    const seen = new Set();
    images = images.filter((im) => !seen.has(im.url) && seen.add(im.url)).slice(0, 60);

    const totalText = pages.reduce((n, p) => n + p.text.length, 0);
    if (totalText < 200) {
      if (appfolioLinked) return NextResponse.json({ pms: "appfolio" });
      return NextResponse.json(
        {
          error:
            "We couldn't find readable listing info on that page. Try pasting your listings or availability page instead.",
        },
        { status: 422 }
      );
    }

    // Count against the rate limit only once we're about to spend on Claude.
    if (listingDraftRateLimited(session.user.id)) {
      return NextResponse.json(
        { error: "You've used all your website imports for now. Try again in an hour." },
        { status: 429 }
      );
    }

    const draft = await extractListingDraft({ pages, images, links, targetProperty });
    if (!draft) {
      return NextResponse.json(
        { error: "We couldn't read that page. You can still fill out the form manually." },
        { status: 422 }
      );
    }

    // Nothing useful extracted from a site that links to AppFolio → steer to sync.
    const empty =
      !draft.listing ||
      (!draft.listing.address &&
        !draft.listing.description &&
        (draft.listing.units ?? []).length === 0);
    if (empty && appfolioLinked && (draft.properties ?? []).length <= 1) {
      return NextResponse.json({ pms: "appfolio" });
    }

    return NextResponse.json({
      sourceUrl: main.finalUrl,
      properties: draft.properties ?? [],
      listing: draft.listing,
    });
  } catch (e) {
    console.error("[listing-draft] error:", e?.message);
    return NextResponse.json(
      { error: "Something went wrong reading that website. Please try again." },
      { status: 500 }
    );
  }
}
