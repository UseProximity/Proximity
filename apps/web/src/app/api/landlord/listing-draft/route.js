export const dynamic = "force-dynamic";
// Fetching the landlord's site + a Claude extraction pass can take a while —
// same synchronous-route pattern as /api/lease-check.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchPageSmart,
  tryRenderPage,
  renderPageWaited,
  htmlToText,
  extractImageCandidates,
  extractLinks,
  extractAllLinks,
  normalizeLinkUrl,
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
import {
  SIGHTMAP_HINT_RE,
  findSightmapEmbed,
  fetchSightmapInventory,
  describeSightmapInventory,
} from "@/lib/listingDraft/sightmap";
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

/*
 * The page a single building keeps its actual units on.
 *
 * An apartment community's front page is a brochure: metroflatsstl.com's is
 * 191KB of markup carrying 2,576 characters of text, no prices, no unit types,
 * and no sign of the availability widget. Everything a landlord came here to
 * import is one click away behind "Floor Plans". We used to follow that link
 * only when the pasted page was nearly empty, and a brochure is not empty, so
 * pasting the front page of a building returned a listing with no units at all.
 */
const FLOORPLAN_LINK_RE =
  /floor\s*plans?|floorplans?|availabilit|available\s+(units|apartments)|rates\s*(and|&)?\s*floor|pricing\s*(and|&)?\s*floor/i;

/*
 * A management company's homepage shows a handful of featured buildings and
 * keeps the rest behind one "see everything" link. macapartments.com is the
 * case that surfaced this: the homepage carousel is 8 properties, the other 116
 * live behind "Search Apartments". The model is told (rule 4b) not to offer a
 * nav link as a folder when the buildings are already on the page, which is
 * right for a small landlord and wrong here, because what is on the page is a
 * teaser. So we add the site's own inventory link to the picker as a folder,
 * and the landlord can open it.
 */
const INVENTORY_LINK_RE =
  /search\s*(listing|apartment|rental|propert|home)|\b(all|our|available|browse)\s+(propert|listing|rental|apartment|communit|home)|find\s+(a\s+|your\s+)?(home|apartment|rental)|\bvacanc/i;

// How many links the model is shown. Raised from the old same-site 40: a
// company inventory page carries well over a hundred building links and the
// first forty were alphabetical, so every St. Louis property fell off the end.
const LINK_CAP = 140;

// At most two synthesized folders, so a site with a chatty nav can't bury the
// real properties under a pile of sections.
function inventoryGroups(links, properties, pageUrl) {
  // Offered even when the model already named folders. On macapartments.com it
  // returns the three city links, which look like areas but are marketing pages
  // with no buildings on them; the link that actually reaches the inventory is
  // the one it was told to leave out. Anything it already returned is deduped
  // by URL, so this only ever adds something new.
  const taken = new Set(properties.map((p) => p.url).filter(Boolean));
  return links
    .filter(
      (l) =>
        l.internal &&
        l.url !== pageUrl &&
        !taken.has(l.url) &&
        INVENTORY_LINK_RE.test(`${l.text} ${l.url}`)
    )
    .slice(0, 2)
    .map((l) => ({
      // The site's own link text ("Search Apartments") means nothing to a
      // landlord looking at a picker, so say what the folder actually holds.
      name: "All properties on your website",
      address: "",
      url: l.url,
      kind: "group",
      // Marks this as ours rather than the model's. The client only offers it
      // at the top level: a company's full inventory is the right thing to
      // reach from the front page and a baffling thing to find inside a folder
      // for one city, where it leads to every other city as well.
      source: "inventory",
    }));
}

// A picked property's URL is fetched, so it has to be one the landlord's own
// site actually points at. Same-site passes outright; a building's own domain
// (5252apartments.com, liveat100.com) passes only when the page we just read
// links to it. Without the second rule, every property a large company hosts on
// its own domain silently lost its URL and got re-read from the corporate
// homepage, which is the wrong page for it.
function resolveTargetUrl(rawUrl, pastedUrl, pageUrl, pageLinks) {
  const url = normalizeLinkUrl(rawUrl, pageUrl);
  if (!url) return null;
  if (sameSite(url, pastedUrl)) return url;
  return pageLinks.some((l) => l.url === url) ? url : null;
}

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

    // url is resolved once the page is in hand (see resolveTargetUrl) — a
    // building's own domain can only be cleared against the links we read.
    const rawTargetUrl =
      typeof body.targetProperty?.url === "string" ? body.targetProperty.url : null;
    const targetProperty =
      body.targetProperty && typeof body.targetProperty.name === "string"
        ? {
            name: body.targetProperty.name.slice(0, 200),
            address:
              typeof body.targetProperty.address === "string"
                ? body.targetProperty.address.slice(0, 200)
                : null,
            url: null,
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
    // Links and images come from whichever render preserved page structure
    // (see withLinkHtml in fetchSite): the winning render is picked on text
    // length, which a markdown-only reader can win while carrying no <a> tags.
    const structureOf = (fetched) => fetched.linkHtml ?? fetched.html;
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
    addImages(structureOf(main), main.finalUrl, 1);
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
        addImages(structureOf(main), main.finalUrl, 1);
      }
    }

    // All links, internal and external. A large company gives each building
    // its own domain, so restricting the model to same-site links left it
    // unable to attach a URL to any of them.
    let links = extractAllLinks(structureOf(main), main.finalUrl, LINK_CAP);
    const mergeLinks = (fetched) => {
      const seen = new Set(links.map((l) => l.url));
      links = [
        ...links,
        ...extractAllLinks(structureOf(fetched), fetched.finalUrl, LINK_CAP).filter(
          (l) => !seen.has(l.url)
        ),
      ].slice(0, LINK_CAP * 2);
    };
    if (targetProperty && rawTargetUrl) {
      targetProperty.url = resolveTargetUrl(rawTargetUrl, pastedUrl, main.finalUrl, links);
    }

    // Every page we end up reading, so the availability-widget check below can
    // look at the floor-plans page rather than only the one that was pasted.
    const fetchedPages = [main];

    // Secondary same-site pages, all landlord-initiated: the property they
    // picked (plus its gallery/floor-plan pages), or obvious listings links
    // when the pasted page is a thin marketing shell.
    const followBestEffort = async (u) => {
      try {
        const sub = await fetchPageSmart(u);
        pages.push(pageEntry(sub));
        fetchedPages.push(sub);
        addImages(structureOf(sub), sub.finalUrl, pages.length);
        return sub;
      } catch {
        return null; // the pasted page alone still works
      }
    };
    if (targetProperty?.url && targetProperty.url !== main.finalUrl) {
      const propPage = await followBestEffort(targetProperty.url);
      if (propPage) {
        const galleryish = extractLinks(structureOf(propPage), propPage.finalUrl)
          .filter(
            (l) =>
              /gallery|photo|amenit|floor|feature|tour/i.test(`${l.url} ${l.text}`) &&
              l.url !== propPage.finalUrl &&
              l.url !== main.finalUrl
          )
          .slice(0, 2);
        for (const l of galleryish) await followBestEffort(l.url);
      }
    } else if (!targetProperty) {
      /*
       * One building, brochure front page: go and get the floor plans. Cheap
       * (one same-site fetch, cached) and it is where the units live on every
       * apartment-community site, not just the widget-driven ones.
       */
      const fp = links.find(
        (l) => l.internal && l.url !== main.finalUrl && FLOORPLAN_LINK_RE.test(`${l.text} ${l.url}`)
      );
      const fpPage = fp ? await followBestEffort(fp.url) : null;
      if (fpPage) mergeLinks(fpPage);
    }
    if (!targetProperty && pages.length === 1 && pages[0].text.length < THIN_TEXT_CHARS) {
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

    /*
     * Live availability from the property's own widget.
     *
     * RealPage sites render their units into a canvas and fetch the numbers
     * afterwards, so the page itself carries almost nothing: Metropolitan
     * Flats' fully rendered floor-plans page shows four prices for
     * twenty-three available apartments. Their SightMap feed has every unit,
     * every price and every lease term, so when a page looks like one of these
     * we go and get it. Costs one extra rendered page-load, only on sites that
     * look like this, and only when we are extracting a single property.
     */
    let liveInventory = null;
    {
      // The widget lives on whichever page shows the floor plans, which is
      // usually not the one that was pasted.
      let token = null;
      for (const fetched of fetchedPages) {
        token = findSightmapEmbed(fetched.html);
        if (token) break;
      }
      if (!token) {
        const candidate = fetchedPages.find((f) => SIGHTMAP_HINT_RE.test(f.html));
        if (candidate) {
          const waited = await renderPageWaited(candidate.finalUrl);
          token = waited ? findSightmapEmbed(waited.html) : null;
          if (waited && token) {
            // The waited render is the better page in every way; keep it.
            const idx = fetchedPages.indexOf(candidate);
            fetchedPages[idx] = waited;
            if (idx >= 0 && idx < pages.length) pages[idx] = pageEntry(waited);
            if (candidate === main) main = waited;
          }
        }
      }
      if (token) {
        const inv = await fetchSightmapInventory(token);
        liveInventory = describeSightmapInventory(inv);
        if (liveInventory) {
          console.log(`[listing-draft] sightmap feed: ${inv.units.length} units`);
        }
      }
    }

    const brandName = extractSiteBrand(main.html);
    let draft = await extractListingDraft({
      pages,
      images,
      links,
      targetProperty,
      brandName,
      liveInventory,
    });

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
        addImages(structureOf(main), main.finalUrl, 1);
        const rImages = [...imageMap.entries()]
          .map(([url, v]) => ({ url, alt: v.alt, pages: [...v.pages].sort() }))
          .slice(0, 60);
        draft = await extractListingDraft({
          pages,
          images: rImages,
          links: extractAllLinks(structureOf(main), main.finalUrl, LINK_CAP),
          targetProperty,
          brandName: extractSiteBrand(main.html) ?? brandName,
        });
      }
    }
    /*
     * Still nothing, but the page points at the site's listings. This is the
     * area folder that turns out to be a marketing page: Mac's "St. Louis" nav
     * link goes to a HubSpot page of photographs and a "View Available
     * Apartments" button, with not one building on it. Opening that folder used
     * to dead-end on "we couldn't find rentable properties in those areas", so
     * follow the button once and extract from where it actually leads.
     */
    if (draftEmpty(draft) && !targetProperty) {
      const onward = inventoryGroups(links, [], main.finalUrl)[0];
      const onwardPage = onward ? await followBestEffort(onward.url) : null;
      if (onwardPage) {
        // The buildings are on THAT page, so its links are the ones that let
        // the model attach a URL to each of them.
        mergeLinks(onwardPage);
        draft = await extractListingDraft({
          pages,
          images: [...imageMap.entries()]
            .map(([url, v]) => ({ url, alt: v.alt, pages: [...v.pages].sort() }))
            .slice(0, 60),
          links,
          targetProperty,
          brandName,
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

    // A folder with no URL cannot be opened or gathered, so it is a checkbox
    // that does nothing. Sites that name their neighbourhoods in prose produce
    // a handful of these; drop them rather than show dead rows.
    const properties = (draft.properties ?? []).filter(
      (p) => p.kind !== "group" || p.url
    );
    return NextResponse.json({
      sourceUrl: main.finalUrl,
      // The inventory folder is only useful on a picker. On a single-property
      // import the landlord is already where they wanted to be.
      properties: draft.listing
        ? properties
        : [...properties, ...inventoryGroups(links, properties, main.finalUrl)],
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
