export const dynamic = "force-dynamic";
// Fetching the landlord's site + a Claude extraction pass can take a while —
// same synchronous-route pattern as /api/lease-check.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchPageSmart,
  tryRenderPage,
  htmlToText,
  extractImageCandidates,
  extractLinks,
  extractJsonLd,
  extractSiteBrand,
  detectPmsPortal,
  SYNCABLE_PMS,
  sameSite,
  DraftFetchError,
} from "@/lib/listingDraft/fetchSite";

// Display names for PMS portals named in landlord-facing messages.
const PMS_DISPLAY = {
  propertyware: "Propertyware",
  showmojo: "ShowMojo",
  rentcafe: "RentCafe",
  appfolio: "AppFolio",
  buildium: "Buildium",
  rentecdirect: "Rentec Direct",
  doorloop: "DoorLoop",
};
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

    // PMS-hosted listing pages render empty without JS. Syncable systems have
    // a better option than importing: the existing PMS integration. The client
    // sends skipPmsSteer when the landlord chose "read my website instead"
    // (e.g. their plan doesn't include API access) — then we import anyway,
    // leaning on the render fallbacks.
    const skipPmsSteer = body.skipPmsSteer === true;
    const pastedPortal = detectPmsPortal(pastedUrl);
    if (!skipPmsSteer && pastedPortal && SYNCABLE_PMS.has(pastedPortal)) {
      return NextResponse.json({ pms: pastedPortal });
    }

    let main;
    try {
      main = await fetchPageSmart(pastedUrl);
    } catch (err) {
      if (err instanceof DraftFetchError) return fetchErrorResponse(err);
      throw err;
    }

    // Page text plus any schema.org JSON-LD — sites often carry the address,
    // photos, and prices there even when the visible text doesn't.
    const pageEntry = (fetched) => {
      const jsonLd = extractJsonLd(fetched.html);
      return {
        url: fetched.finalUrl,
        text:
          htmlToText(fetched.html) +
          (jsonLd ? `\n\nSTRUCTURED DATA (JSON-LD):\n${jsonLd}` : ""),
      };
    };

    const pages = [pageEntry(main)];
    // url -> { alt, pages:Set } — which page(s) each image candidate appeared
    // on is the model's best signal for "this property's photo" vs site chrome.
    const imageMap = new Map();
    const addImages = (html, finalUrl, pageNum) => {
      for (const im of extractImageCandidates(html, finalUrl)) {
        const cur = imageMap.get(im.url);
        if (cur) {
          cur.pages.add(pageNum);
          if (!cur.alt && im.alt) cur.alt = im.alt;
        } else {
          imageMap.set(im.url, { alt: im.alt, pages: new Set([pageNum]) });
        }
      }
    };
    addImages(main.html, main.finalUrl, 1);
    const linkedPortal = detectPmsPortal(main.finalUrl, main.html);

    // A non-syncable PMS widget with little surrounding content means the
    // listings only exist after JS runs — worth spending a render credit on
    // before falling back to the "we can't read <system>" message.
    if (
      linkedPortal &&
      (skipPmsSteer || !SYNCABLE_PMS.has(linkedPortal)) &&
      pages[0].text.length < 3000
    ) {
      const rendered = await tryRenderPage(main.finalUrl);
      if (rendered && htmlToText(rendered.html).length > pages[0].text.length) {
        main = rendered;
        pages[0] = pageEntry(main);
        imageMap.clear();
        addImages(main.html, main.finalUrl, 1);
      }
    }

    const links = extractLinks(main.html, main.finalUrl);

    // Secondary same-site pages, all landlord-initiated: the property they
    // picked (plus its gallery/floor-plan pages), or obvious listings links
    // when the pasted page is a thin marketing shell.
    const followBestEffort = async (u) => {
      try {
        const sub = await fetchPageSmart(u);
        pages.push(pageEntry(sub));
        addImages(sub.html, sub.finalUrl, pages.length);
        return sub;
      } catch {
        return null; // the pasted page alone still works
      }
    };
    if (targetProperty?.url && targetProperty.url !== main.finalUrl) {
      const propPage = await followBestEffort(targetProperty.url);
      if (propPage) {
        const galleryish = extractLinks(propPage.html, propPage.finalUrl)
          .filter(
            (l) =>
              /gallery|photo|amenit|floor|feature|tour/i.test(`${l.url} ${l.text}`) &&
              l.url !== propPage.finalUrl &&
              l.url !== main.finalUrl
          )
          .slice(0, 2);
        for (const l of galleryish) await followBestEffort(l.url);
      }
    } else if (pages[0].text.length < THIN_TEXT_CHARS) {
      const followUrls = [];
      for (const l of links) {
        if (followUrls.length >= 2) break;
        if (LISTINGS_LINK_RE.test(`${l.url} ${l.text}`) && l.url !== main.finalUrl) {
          followUrls.push(l.url);
        }
      }
      for (const u of followUrls) await followBestEffort(u);
    }
    const images = [...imageMap.entries()]
      .map(([url, v]) => ({ url, alt: v.alt, pages: [...v.pages].sort() }))
      .slice(0, 60);

    // Empty-ish result with a known portal in play: name the system instead of
    // failing generically (syncable ones steer to the integration).
    const portalResponse = () => {
      if (!linkedPortal) return null;
      if (!skipPmsSteer && SYNCABLE_PMS.has(linkedPortal)) {
        return NextResponse.json({ pms: linkedPortal });
      }
      return NextResponse.json(
        {
          error: `Your listings appear to live inside ${
            PMS_DISPLAY[linkedPortal] ?? "your property-management system"
          }, which we can't read from your website. You can still fill out the form manually.`,
        },
        { status: 422 }
      );
    };

    const totalText = pages.reduce((n, p) => n + p.text.length, 0);
    if (totalText < 200) {
      return (
        portalResponse() ??
        NextResponse.json(
          {
            error:
              "We couldn't find readable listing info on that page. Try pasting your listings or availability page instead.",
          },
          { status: 422 }
        )
      );
    }

    // Count against the rate limit only once we're about to spend on Claude.
    if (listingDraftRateLimited(session.user.id)) {
      return NextResponse.json(
        { error: "You've used all your website imports for now. Try again in an hour." },
        { status: 429 }
      );
    }

    const brandName = extractSiteBrand(main.html);
    let draft = await extractListingDraft({ pages, images, links, targetProperty, brandName });

    // Totally empty result on an un-rendered page usually means the content
    // only exists after JS runs — spend one render credit and try once more.
    const draftEmpty = (d) =>
      !d || (!d.listing && (d.properties ?? []).length === 0);
    if (draftEmpty(draft) && !targetProperty) {
      const rendered = await tryRenderPage(main.finalUrl);
      if (rendered && htmlToText(rendered.html).length > pages[0].text.length) {
        main = rendered;
        pages[0] = pageEntry(main);
        imageMap.clear();
        addImages(main.html, main.finalUrl, 1);
        const rImages = [...imageMap.entries()]
          .map(([url, v]) => ({ url, alt: v.alt, pages: [...v.pages].sort() }))
          .slice(0, 60);
        draft = await extractListingDraft({
          pages,
          images: rImages,
          links: extractLinks(main.html, main.finalUrl),
          targetProperty,
          brandName: extractSiteBrand(main.html) ?? brandName,
        });
      }
    }
    if (!draft) {
      return NextResponse.json(
        { error: "We couldn't read that page. You can still fill out the form manually." },
        { status: 422 }
      );
    }

    // Nothing useful extracted from a site that links to a PMS portal → name it.
    const empty =
      !draft.listing ||
      (!draft.listing.address &&
        !draft.listing.description &&
        (draft.listing.units ?? []).length === 0);
    if (empty && (draft.properties ?? []).length <= 1) {
      const pr = portalResponse();
      if (pr) return pr;
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
