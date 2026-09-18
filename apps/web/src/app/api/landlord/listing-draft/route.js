export const dynamic = "force-dynamic";
// Fetching the landlord's site + a Claude extraction pass can take a while —
// same synchronous-route pattern as /api/lease-check.
/*
 * 120 seconds was not enough and would have failed in production while working
 * locally. Reading One Hundred Above the Park takes ~197s: the pasted page, the
 * building's page, its floor-plans index, then twelve floor-plan pages for the
 * apartments behind each plan. Localhost is not the slow part — the time is
 * Firecrawl renders plus the Claude call, which cost the same in production.
 */
export const maxDuration = 300;

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
  isListingPortal,
  findPropertyOwnSite,
  hostOf,
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
  sightmapImageCandidates,
} from "@/lib/listingDraft/sightmap";
import {
  findFloorPlanPages,
  chooseFloorPlansToRead,
  fetchFloorPlanUnits,
  describeFloorPlanUnits,
} from "@/lib/listingDraft/floorPlanUnits";
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
    let triedFloorPlans = false;
    let floorPlanIndex = null;

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
      let propPage = await followBestEffort(targetProperty.url);
      if (propPage) {
        mergeLinks(propPage);
        /*
         * Hop to the property's own website when the company's page is only
         * about it.
         *
         * Keeley's page for Lofts at Euclid is a blurb, a price range and a
         * link to loftsateuclid.com, where the floor plans actually are. The
         * floor-plan search below only looks at same-site links, so it found
         * nothing and the landlord got a property with nothing under it. Every
         * property in their portfolio is arranged this way.
         *
         * Only when the other site genuinely has more on it, and the company
         * page is kept either way — its summary, its photos and its links are
         * still good information.
         */
        const ownSite = findPropertyOwnSite(
          structureOf(propPage),
          propPage.finalUrl,
          targetProperty.name
        );
        if (ownSite) {
          const ownPage = await followBestEffort(ownSite);
          /*
           * Any real page will do. What we are after is not its words but the
           * floor plans behind it, and a building's front page is often a
           * near-empty splash with a picture and a menu — judging it on length
           * against the company's blurb would refuse the hop precisely where it
           * helps most. The company's page stays in the set either way.
           */
          if (ownPage && htmlToText(ownPage.html).length > 300) {
            console.log(
              `[listing-draft] ${targetProperty.name}: following its own site ${hostOf(ownPage.finalUrl)}`
            );
            propPage = ownPage;
            mergeLinks(ownPage);
          }
        }
        /*
         * The picked property's own floor-plans page.
         *
         * This used to only happen when the landlord pasted a building's URL
         * directly, so reaching One Hundred Above the Park the way a landlord
         * actually does — paste macapartments.com, pick the building — skipped
         * the whole drill-down. It published twelve units numbered by FLOOR
         * PLAN (100N101A) instead of thirty-six numbered by apartment, with no
         * lease terms and one price each.
         */
        const propFp = extractAllLinks(structureOf(propPage), propPage.finalUrl, LINK_CAP).find(
          (l) =>
            l.internal &&
            l.url !== propPage.finalUrl &&
            FLOORPLAN_LINK_RE.test(`${l.text} ${l.url}`)
        );
        const propFpPage = propFp ? await followBestEffort(propFp.url) : null;
        if (propFpPage) {
          mergeLinks(propFpPage);
          floorPlanIndex = propFpPage;
        }
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
      if (fpPage) {
        mergeLinks(fpPage);
        triedFloorPlans = true;
        floorPlanIndex = fpPage;
      }
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
    let floorPlanData = null;
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
          // The feed's floor-plan diagrams are on a CDN the page never links,
          // so offer them alongside the page's own images.
          for (const im of sightmapImageCandidates(inv)) {
            if (!imageMap.has(im.url)) imageMap.set(im.url, { alt: im.alt, pages: new Set([1]) });
          }
          console.log(`[listing-draft] sightmap feed: ${inv.units.length} units`);
        }
      }
    }

    /*
     * Each floor plan's own page, for the apartments behind it.
     *
     * A floor plan is not an apartment: One Hundred Above the Park lists plan
     * 100N101A with #1501 at $3,080 and #2701 at $3,095, and 100N101C with one
     * apartment free in November and another not until January. The index page
     * shows a plan name and one "starting at" figure, which is the wrong unit of
     * information for a marketplace that syncs availability on a timer.
     *
     * Only for a single property, only off a real floor-plans index, and capped:
     * these pages are usually bot-blocked, so each one costs a render.
     */
    if (!liveInventory && floorPlanIndex) {
      const planUrls = findFloorPlanPages(structureOf(floorPlanIndex), floorPlanIndex.finalUrl);
      if (planUrls.length) {
        const toRead = chooseFloorPlansToRead(planUrls);
        console.log(
          `[listing-draft] ${planUrls.length} floor plans on the index, reading ${toRead.length}`
        );
        const result = await fetchFloorPlanUnits(toRead);
        const described = describeFloorPlanUnits(result);
        if (described) {
          liveInventory = described;
          floorPlanData = result;
          console.log(
            `[listing-draft] floor plans: ${result.plans.length} plans, ` +
              `${result.plans.reduce((n, p) => n + p.apartments.length, 0)} apartments` +
              (result.termRange ? `, terms ${result.termRange.min}-${result.termRange.max}mo` : "")
          );
        }
      }
    }

    const portalPage = isListingPortal(main.finalUrl);
    const brandName = extractSiteBrand(main.html);
    const imagesWithFeed = [...imageMap.entries()]
      .map(([url, v]) => ({ url, alt: v.alt, pages: [...v.pages].sort() }))
      .slice(0, 60);
    let draft = await extractListingDraft({
      pages,
      images: imagesWithFeed,
      // A portal page's links are its own navigation and its competitors'
      // listings. Offering them invites the model to treat the page as a
      // directory, which is how a single listing came back as forty buildings.
      links: portalPage ? [] : links,
      targetProperty,
      brandName,
      liveInventory,
      portalPage,
      unitsHandledElsewhere: !!floorPlanData?.plans?.length,
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

    /*
     * A listing with no units is a listing nobody can rent.
     *
     * This is the general form of the bug that made metroflatsstl.com import
     * as a name and an address: the pasted page was a brochure, the units were
     * a click away, and nothing checked whether we had actually come back with
     * any. Rather than teach the importer about one more platform, ask the only
     * question that matters at the end of a single-property read, and if the
     * answer is no, spend one more page on the most likely place to find them.
     * That catches sites nobody has ever tested, which is the point.
     */
    const noUnits = (d) =>
      d?.listing && (d.listing.units ?? []).length === 0 && !(d.listing.address && d.listing.rent);
    if (noUnits(draft) && !triedFloorPlans) {
      const fp = links.find(
        (l) =>
          l.internal &&
          !fetchedPages.some((f) => f.finalUrl === l.url) &&
          FLOORPLAN_LINK_RE.test(`${l.text} ${l.url}`)
      );
      const page = fp ? await followBestEffort(fp.url) : null;
      if (page) {
        mergeLinks(page);
        console.log("[listing-draft] no units on first pass, retried via", fp.url);
        draft = await extractListingDraft({
          pages,
          images: [...imageMap.entries()]
            .map(([url, v]) => ({ url, alt: v.alt, pages: [...v.pages].sort() }))
            .slice(0, 60),
          links,
          targetProperty,
          brandName,
          liveInventory,
        });
      }
    }

    /*
     * Units come from the parse, not from the model.
     *
     * We read the apartments off the floor-plan pages exactly, then asked the
     * model to write all of them back out: 36 apartments cost 17,000 output
     * tokens and pushed one import to 308 seconds, past what the platform will
     * allow. Restating data we already hold precisely is the most expensive and
     * least reliable thing in the request, so the model is asked for the prose
     * and the numbers are filled in here.
     */
    if (draft?.listing && floorPlanData?.plans?.length) {
      /*
       * The parse owns the apartments; the model fills what the apartment pages
       * did not say. Bedroom and bathroom counts are the usual gap: a plan page
       * may print "1 Bed" in a place the parse reads and the next plan may not
       * print it at all, which published a floor plan with blank bed and bath
       * boxes. Matched on the plan's name first, then its square footage.
       */
      const fromModel = draft.listing.units ?? [];
      const sane = (value, max) => {
        // Number(null) and Number("") are both 0, and 0 bedrooms means studio,
        // so "we don't know" has to be caught before the conversion.
        if (value === null || value === undefined || value === "") return null;
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
      };
      const norm = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();
      /*
       * Names first, and size only when there is no name to go on.
       *
       * Matching on either meant a unit could claim a plan whose square footage
       * happened to be close, and the plan that really belonged to it was then
       * taken. 100N307F came back as a four-bedroom that way: its own page says
       * "3 Bedrooms | 2 Bathrooms", but another unit had claimed that plan on
       * size, so the real one was left with the model's guess. A floor plan
       * code is an exact thing and two plans of the same size are common, so
       * the name has to win.
       */
      const sameplan = (unit, plan) =>
        plan.name && unit.title
          ? norm(unit.title) === norm(plan.name)
          : !!(plan.area && unit.area && Math.abs(Number(unit.area) - plan.area) <= 2);

      /*
       * The model's list is the spine; the pages we opened fill it in.
       *
       * It used to be the other way round, and a building imported as only the
       * plans we happened to open. One Hundred Above the Park has thirty-six
       * floor plans listed in bedroom order, so opening the first twelve gave
       * twelve one-bedrooms and lost every studio, two-bed and three-bed in the
       * building. Whatever the model read off the index stays in the list even
       * when we never opened its page; it just carries a starting price instead
       * of its own apartments.
       */
      const applyPlan = (unit, plan) => {
        const rents = plan.apartments.map((a) => a.rent).filter((r) => r != null);
        return {
          ...unit,
          // Same guard as the model's own units: a count a home cannot have is
          // no better for coming off a floor-plan page.
          bedrooms: sane(plan.bedrooms ?? unit?.bedrooms, 20),
          bathrooms: sane(plan.bathrooms ?? unit?.bathrooms, 20),
          area: plan.area ?? unit?.area ?? null,
          rent: rents.length ? Math.min(...rents) : (unit?.rent ?? null),
          rentBasis: rents.length ? "total" : (unit?.rentBasis ?? "unknown"),
          title: plan.name ?? unit?.title ?? null,
          // The diagram off this plan's own page beats anything the model
          // picked out of a pile of candidate images.
          floorPlanImageUrl: plan.image ?? unit?.floorPlanImageUrl ?? null,
          availableFrom: plan.apartments.some((a) => a.availableOn === "now")
            ? "now"
            : (unit?.availableFrom ?? null),
          unitNames: plan.apartments.map((a) => a.number),
          unitRents: plan.apartments.map((a) => a.rent ?? 0),
          unitAvailability: plan.apartments.map((a) =>
            a.availableOn && a.availableOn !== "now" ? a.availableOn : ""
          ),
          leaseTermMonths: unit?.leaseTermMonths ?? [],
          leaseTermPrices: [],
        };
      };

      const used = new Set();
      let merged = fromModel.map((unit) => {
        const i = floorPlanData.plans.findIndex((p, n) => !used.has(n) && sameplan(unit, p));
        if (i < 0) return unit;
        used.add(i);
        return applyPlan(unit, floorPlanData.plans[i]);
      });
      floorPlanData.plans.forEach((plan, n) => {
        if (!used.has(n)) merged.push(applyPlan(null, plan));
      });
      /*
       * The lease lengths belong to the building, not to the floor plan we
       * happened to open. A property that says its rate is a twelve-month rate
       * says that about every apartment in it, so the term goes on all of them,
       * including the plans whose own page we never opened. Only where the
       * model found nothing better: a floor plan that publishes its own terms
       * keeps them.
       */
      /*
       * A name on its own is not a floor plan.
       *
       * Asking the model to list every plan is right for a building that
       * publishes a plan with a price and no vacancy. It is wrong for Lofts at
       * Euclid, whose pages carry a filter dropdown naming every layout the
       * building has ever had: eleven of its eighteen units came back as a name
       * with no beds, no rent, no size and no apartments, which is a menu
       * entry, not something a student can rent. Anything that tells the
       * landlord something stays; a bare title goes.
       */
      const informative = (u) =>
        u.bedrooms != null ||
        u.rent != null ||
        u.area != null ||
        (u.unitNames ?? []).length > 0;
      const dropped = merged.length - merged.filter(informative).length;
      if (dropped) {
        console.log(`[listing-draft] dropped ${dropped} floor plans that were a name and nothing else`);
      }
      merged = merged.filter(informative);

      const houseTerm = Number(floorPlanData.termRange?.reflects) || null;
      draft.listing.units = houseTerm
        ? merged.map((u) =>
            (u.leaseTermMonths ?? []).length ? u : { ...u, leaseTermMonths: [houseTerm] }
          )
        : merged;
      console.log(
        `[listing-draft] units: ${merged.length} (${used.size} with apartments read off their own page)`
      );
      /*
       * The specials we read off the floor-plan pages, merged with whatever the
       * model found in a banner or popup. Same wording from two sources is one
       * concession, so they are de-duplicated on the text itself.
       */
      const scraped = [
        ...floorPlanData.plans.map((plan) => plan.specials),
        floorPlanData.termRange?.special,
      ].filter(Boolean);
      if (scraped.length) {
        /*
         * The same offer reaches us twice in different words: the model reads
         * the banner ("1 month free rent, must sign on or before September 30
         * 2026") and the parser lifts the floor-plan line ("1 MONTH FREE RENT.
         * Must sign lease on/before September 30th,2026."). Comparing the exact
         * text keeps both. Stripping everything but letters and digits, and the
         * ordinal suffixes, makes them the same offer again.
         */
        const MONTHS = "january february march april may june july august september october november december".split(" ");
        /*
         * What the offer actually is, rather than how it was written.
         *
         * The same special reaches us twice in two voices: the model reads the
         * banner ("6 weeks free rent on select floor plans, must sign lease on
         * or before September 30, 2026") and the parser lifts the application
         * page's line ("6 WEEKS FREE RENT. Must sign lease on/before September
         * 30th,2026."). Comparing the words, however hard they are scrubbed,
         * keeps both, and the listing then shows a student the same discount
         * twice. What makes them one offer is the size of the discount and the
         * date it ends, so that is what gets compared. Anything we cannot read
         * that way falls back to comparing the text.
         */
        const fingerprint = (raw) => {
          const text = String(raw).toLowerCase();
          const free = text.match(/(\d+(?:\.\d+)?)\s*(week|month)s?\s+free/);
          const pct = text.match(/(\d+)\s*%\s*off/);
          const dollars = text.match(/\$\s?([\d,]+)\s*(?:off|free|credit)/);
          const size = free
            ? `${free[1]}${free[2]}`
            : pct
            ? `${pct[1]}pct`
            : dollars
            ? `$${dollars[1].replace(/,/g, "")}`
            : null;
          if (!size) {
            return text
              .replace(/(\d+)(st|nd|rd|th)\b/g, "$1")
              .replace(/[^a-z0-9]/g, "")
              .slice(0, 40);
          }
          const named = text.match(
            new RegExp(`(${MONTHS.join("|")})\\w*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})?`)
          );
          const slashed = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
          const deadline = named
            ? `${MONTHS.indexOf(named[1]) + 1}-${named[2]}`
            : slashed
            ? `${Number(slashed[1])}-${Number(slashed[2])}`
            : "";
          return `${size}@${deadline}`;
        };
        const seen = new Set((draft.listing.concessions ?? []).map(fingerprint));
        for (const c of scraped) {
          const key = fingerprint(c);
          if (seen.has(key)) continue;
          seen.add(key);
          draft.listing.concessions = [...(draft.listing.concessions ?? []), c];
        }
      }
      if (floorPlanData.termRange?.min) {
        /*
         * Said on the listing, not in a source note.
         *
         * A source note is shown once during the import review and thrown away
         * on publish, so putting this there meant a student never learned that
         * the rent they are looking at assumes a particular lease length. The
         * lease row already carries the term the price belongs to; this is the
         * sentence that explains the other lengths exist, and it rides along on
         * the description, which the lease panel renders.
         */
        const { min, max, reflects } = floorPlanData.termRange;
        const term = reflects ? `${reflects}-month` : "standard";
        const sentence = `Lease terms from ${min} to ${max} months are available. The rent shown is the rate for a ${term} lease; other lengths are priced differently.`;
        const existing = (draft.listing.description ?? "").trim();
        if (!/lease terms from/i.test(existing)) {
          draft.listing.description = existing ? `${existing}\n\n${sentence}` : sentence;
        }
        draft.listing.sourceNotes = [
          `This building quotes lease terms from ${min} to ${max} months and publishes one rate per apartment. Check the term before you publish.`,
          ...(draft.listing.sourceNotes ?? []),
        ];
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

    /*
     * A portal page with nothing on it is a listing that has been taken down.
     * Apartments.com answers a dead listing with "Sorry, we no longer have this
     * property online" and a city search full of other people's buildings, so
     * saying nothing leaves the landlord staring at an empty picker wondering
     * what they did wrong.
     */
    if (portalPage && !draft.listing) {
      let site = "that listing site";
      try {
        site = new URL(main.finalUrl).hostname.replace(/^www\./, "");
      } catch {
        /* keep the generic wording */
      }
      return NextResponse.json(
        {
          error: `That listing is no longer live on ${site}. Paste the address of your own website instead, or the listing page that is currently up.`,
        },
        { status: 422 }
      );
    }

    // A folder with no URL cannot be opened or gathered, so it is a checkbox
    // that does nothing. Sites that name their neighbourhoods in prose produce
    // a handful of these; drop them rather than show dead rows.
    /*
     * On a listing portal the page is one property and the rest of the page is
     * the portal's competitors. Never hand those back as things to import.
     */
    const properties = isListingPortal(main.finalUrl)
      ? []
      : (draft.properties ?? []).filter((p) => p.kind !== "group" || p.url);
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
