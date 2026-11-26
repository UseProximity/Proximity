/*
 * SecureCafe (RentCafe online leasing) portal reader.
 *
 * Every RentCafe landlord (Mac, Keeley, most of the big St. Louis operators)
 * keeps its real inventory behind "Select floor plan": a SecureCafe portal at
 * <landlord>.securecafe.com/onlineleasing/<building>/oleapplication.aspx.
 * The marketing site shows a floor plan and a "from" price; the portal shows
 * each apartment.
 *
 * Two steps of that portal are worth reading, both bot-walled (403 to a plain
 * fetch) and both fine through a rendered fetch (one credit each):
 *
 *   stepname=Apartments   the whole building on one page: a table per floor
 *                         plan (table id divFPH_<planId>) with a row per
 *                         apartment (row id unitrow_<unitId>): number, size,
 *                         rent, special, amenities, date available
 *   Stepname=RentalOptions one apartment: the term its rent assumes, the range
 *                         of terms offered, the special's dollar value, and,
 *                         behind a slider, a price for every other term
 *
 * The URLs are predictable, so the reader builds them rather than clicking.
 * The ids it learns (property, plans, apartments) are kept on the listing's
 * monitor, so the weekly sync re-renders the one Apartments page and only
 * opens Rental Options for apartments whose price moved.
 */
import { renderPage } from "@/lib/listingDraft/fetchSite";
import { isoDate, money, num } from "../snapshot.js";

export const SECURECAFE_RE = /https?:\/\/([a-z0-9-]+)\.securecafe\.com\/onlineleasing\/([a-z0-9-]+)\/oleapplication\.aspx\?([^"'\s<>]*)/i;
const TIMEOUT_NOTE = "The leasing portal did not answer its price quotes; rents are the ones on its apartment list.";
const MAX_QUOTED = 150;
// How far ahead the apartment list is asked for, so later move-ins show.
const LIST_AHEAD_DAYS = 180;
const CONCURRENCY = 3;

/* Portal coordinates from any page HTML: { host, slug, propertyId } or null. */
export function findSecureCafe(html) {
  if (!html) return null;
  // The link may sit in an anchor (&amp;) or in embedded JSON (\u0026, \/).
  const source = html.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  for (const m of source.matchAll(new RegExp(SECURECAFE_RE.source, "gi"))) {
    let q = m[3].replace(/&amp;/g, "&");
    try {
      q = decodeURIComponent(q);
    } catch {
      /* keep as is */
    }
    const propertyId = q.match(/myOlePropertyId=(\d+)/i)?.[1];
    if (propertyId) return { host: m[1].toLowerCase(), slug: m[2].toLowerCase(), propertyId };
  }
  return null;
}

const mdy = (d = new Date()) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const soon = () => mdy(new Date(Date.now() + 14 * 86400000));

export const apartmentsUrl = ({ host, slug, propertyId }, moveIn = soon()) =>
  `https://${host}.securecafe.com/onlineleasing/${slug}/oleapplication.aspx?stepname=Apartments&myOlePropertyid=${propertyId}&MoveInDate=${encodeURIComponent(moveIn)}`;
export const rentalOptionsUrl = ({ host, slug, propertyId }, { unitId, planId }, moveIn = soon()) =>
  `https://${host}.securecafe.com/onlineleasing/${slug}/oleapplication.aspx?Stepname=RentalOptions&myOlePropertyId=${propertyId}&UnitID=${unitId}&FloorPlanID=${planId}&header=1&MoveInDate=${encodeURIComponent(moveIn)}`;

const text = (html) =>
  String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

/*
 * The Apartments step as { plans: [{ id, name, bedrooms, bathrooms,
 * apartments: [{ unitId, number, area, rent, special, amenities,
 * availableOn }] }] }, or null when the page is not that step.
 */
export function parseApartmentsPage(html) {
  if (!html) return null;
  const plans = [];
  const tables = [...html.matchAll(/<table[^>]*id="divFPH_(\d+)"[\s\S]*?<\/table>/gi)];
  for (const t of tables) {
    const planId = t[1];
    const block = t[0];
    const caption = text(block.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? "");
    const head = caption.match(/Floor Plan:\s*(.+?)\s*-\s*(\d+)\s*Bedrooms?,?\s*([\d.]+)\s*Bathrooms?/i);
    const name = head?.[1]?.trim() ?? caption.replace(/^.*Floor Plan:\s*/i, "").trim() ?? null;
    const apartments = [];
    for (const r of block.matchAll(/<tr[^>]*id="unitrow_(\d+)"[\s\S]*?<\/tr>/gi)) {
      const row = r[0];
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => text(c[1]));
      // Apartment | Sq.Ft. | Rent | Specials | Amenities | Date Available | Action
      const number = (cells[0] ?? "").match(/#\s*([A-Z0-9-]+)/i)?.[1] ?? (cells[0] ?? "").split("\n")[0].replace(/^#/, "").trim();
      const special = (cells[3] ?? "").replace(/^Apartment Specials\s*/i, "").replace(/^-\s*/, "").trim() || null;
      const amenities = (cells[4] ?? "").replace(/^Details\s*/i, "").split("\n").map((a) => a.replace(/^-\s*/, "").trim()).filter(Boolean);
      const avail = (cells[5] ?? "").trim();
      apartments.push({
        unitId: r[1],
        number,
        area: num(cells[1], { max: 20000, min: 50 }),
        rent: money(cells[2]),
        special,
        amenities,
        availableOn: /^available(\s+now)?$/i.test(avail) ? null : isoDate(avail),
      });
    }
    plans.push({
      id: planId,
      name,
      bedrooms: head ? Number(head[2]) : null,
      bathrooms: head ? Number(head[3]) : null,
      apartments,
    });
  }
  return plans.length ? { plans } : null;
}

/*
 * The Rental Options step as { term, rent, specialValue, range: [min, max],
 * moveIn, terms: [every term the slider offers] }, or null. The page's
 * scripts carry `var terms = [12]`: the lengths this apartment can be
 * leased for at a published price.
 */
export function parseRentalOptionsPage(html) {
  if (!html) return null;
  const terms = (html.match(/var\s+terms\s*=\s*\[([\d,\s]*)\]/)?.[1] ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 36);
  const t = text(html.replace(/<script[\s\S]*?<\/script>/gi, " "));
  const term = num(t.match(/Lease\s*Term\s*:?\s*(\d{1,2})\s*months?/i)?.[1]);
  const rent = money(t.match(/\bRent\s*:?\s*\$\s*([\d,]+(?:\.\d{2})?)/i)?.[1]);
  const specialValue = money(t.match(/(?:Short\s*Term\s*Special|Special\s*offer)\s*:?\s*\$\s*([\d,]+(?:\.\d{2})?)/i)?.[1]);
  const range = t.match(/lease terms?[^.]{0,60}?rang\w*\s+from\s*(\d{1,2})\s*(?:to|-|–|through)\s*(\d{1,2})\s*months/i);
  const moveIn = isoDate(t.match(/Move-?in\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]);
  if (!term && !rent) return null;
  return { term, rent, specialValue, range: range ? [Number(range[1]), Number(range[2])] : null, moveIn, terms: terms.length ? terms : term ? [term] : [] };
}

/*
 * The portal's own quote sheet, asked from inside a rendered page.
 *
 * The slider on Rental Options fetches /onlineleasing/rcLoadContent.ashx
 * (contentclass=olequotesheet) with a unit id and a term, on the portal's
 * session. That call does not care which apartment the page was opened for,
 * so one render can quote a batch of apartments: the whole building's
 * prices cost a handful of credits, not one per apartment.
 *
 * Which terms to quote is the slider's decision, not ours: each apartment's
 * Rental Options page carries `var terms = [12]`, the lengths the landlord
 * will lease it for right now. The quote sheet answers for any number you
 * send it, so asking for lengths the slider does not offer would invent
 * leases the landlord does not sell. The script fetches each apartment's
 * page first (same session, no credit), reads that list, and quotes those.
 *
 * Each quote also lists the mandatory monthly charges beside the rent (Mac
 * adds a "Utility Flat Fee"), which the rent on the Apartments page leaves
 * out.
 *
 * The script returns JSON: { "<unitId>": { terms: [12], quotes: { "12":
 * "<the Monthly Charges text of that quote>" } } }, read apart here by
 * parseQuote.
 */
const BATCH = 12;
const FALLBACK_TERMS = [12];

export const quoteScript = ({ portal, moveIn, apartments }) => `
  (async () => {
    const out = {};
    const clean = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ');
    for (const a of ${JSON.stringify(apartments.map((a) => ({ u: a.unitId, p: a.planId, m: encodeURIComponent(a.moveIn ?? moveIn) })))}) {
      const u = a.u;
      const movein = a.m;
      out[u] = { terms: null, quotes: {} };
      try {
        const page = await fetch('/onlineleasing/${portal.slug}/oleapplication.aspx?Stepname=RentalOptions&myOlePropertyId=${portal.propertyId}&UnitID=' + u + '&FloorPlanID=' + a.p + '&header=1&MoveInDate=' + movein, { credentials: 'include' });
        const html = page.ok ? await page.text() : '';
        const m = html.match(/var\\s+terms\\s*=\\s*\\[([\\d,\\s]*)\\]/);
        if (m) out[u].terms = m[1].split(',').map((x) => Number(x.trim())).filter((n) => n > 0);
      } catch (e) { /* no page: quote the fallback below */ }
      const terms = out[u].terms && out[u].terms.length ? out[u].terms : ${JSON.stringify(FALLBACK_TERMS)};
      for (const t of terms) {
        try {
          const r = await fetch('/onlineleasing/rcLoadContent.ashx?contentclass=olequotesheet&MoveinDate=' + movein + '&sLeaseTerm=' + t + '&UnitId=' + u + '&PropertyId=${portal.propertyId}&', { credentials: 'include' });
          if (!r.ok) { out[u].quotes[t] = null; continue; }
          const text = clean(await r.text());
          const i = text.indexOf('Monthly Charges');
          const j = text.indexOf('Move-In Charges');
          const monthly = i >= 0 ? text.slice(i, j > i ? j : i + 800) : '';
          out[u].quotes[t] = monthly ? monthly.slice(0, 600) : null;
        } catch (e) { out[u].quotes[t] = null; }
      }
    }
    return JSON.stringify(out);
  })()`;

/*
 * "Monthly Charges Rent $2,195 Main charge Utility Flat Fee - STU - $40 $40
 * Included $2,235 per month" -> { rent, fees: [[name, amount]], total }.
 */
export function parseQuote(monthly) {
  if (!monthly) return null;
  const rent = money(monthly.match(/\bRent\s*\$\s*([\d,]+(?:\.\d{2})?)/)?.[1]);
  if (!rent) return null;
  const total = money(monthly.match(/\$\s*([\d,]+(?:\.\d{2})?)\s*per month/i)?.[1]);
  const rest = monthly.replace(/^.*?\bRent\s*\$\s*[\d,.]+\s*(?:Main charge)?/i, "");
  const fees = [];
  for (const m of rest.matchAll(/([A-Za-z][A-Za-z0-9 /&()'-]{2,60}?)\s*-?\s*\$\s*([\d,]+(?:\.\d{2})?)/g)) {
    const name = m[1].replace(/\s*-\s*$/, "").trim();
    const amount = money(m[2]);
    if (!amount || /^(included|total|main charge|rent)$/i.test(name) || /per month/i.test(name)) continue;
    if (!fees.some((f) => f[0] === name)) fees.push([name, amount]);
  }
  return { rent, fees, total };
}

/*
 * Quote `apartments` ([{ unitId, planId }]), BATCH per render. The page
 * rendered is the first apartment's Rental Options step, which also tells
 * the building's advertised term range (parsed once by the caller).
 * Returns Map(unitId -> { terms: [months the slider allows], termPrices:
 * { months: rent }, fees: [[name, amount]], total }) and the first page's
 * HTML.
 */
async function quoteApartments(portal, apartments, moveIn, onStep, progress = { done: 0, total: apartments.length }) {
  const quotes = new Map();
  let firstHtml = null;
  const batches = [];
  for (let i = 0; i < apartments.length; i += BATCH) batches.push(apartments.slice(i, i + BATCH));
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const batch = batches[cursor++];
      if (!batch) return;
      const lead = batch[0];
      const r = await renderPage(rentalOptionsUrl(portal, lead, lead.moveIn ?? moveIn), {
        waitMs: 3000,
        raw: true,
        actions: [{ type: "executeJavascript", script: quoteScript({ portal, moveIn, apartments: batch }) }],
      });
      firstHtml ??= r?.html ?? null;
      const returned = r?.returns?.find((v) => typeof v === "string" && v.startsWith("{"));
      if (!returned) console.warn(`[source-import] securecafe quote batch (${batch.length} apartments) returned nothing: ${r ? `html ${r.html.length}, returns ${JSON.stringify(r.returns).slice(0, 200)}` : "render failed"}`);
      if (returned) {
        try {
          for (const [unitId, got] of Object.entries(JSON.parse(returned))) {
            const termPrices = {};
            let fees = null;
            let total = null;
            for (const [t, monthly] of Object.entries(got?.quotes ?? {})) {
              const q = parseQuote(monthly);
              if (!q) continue;
              termPrices[Number(t)] = q.rent;
              fees ??= q.fees;
              total ??= q.total;
            }
            const terms = (got?.terms ?? []).filter((n) => Number.isInteger(n) && n > 0 && n <= 36);
            if (Object.keys(termPrices).length) quotes.set(unitId, { terms: terms.length ? terms : Object.keys(termPrices).map(Number), termPrices, fees: fees ?? [], total });
          }
        } catch (err) {
          console.warn(`[source-import] securecafe quote batch unreadable: ${err?.message}`);
        }
      }
      progress.done += batch.length;
      onStep(`Priced ${Math.min(progress.done, progress.total)} of ${progress.total} apartments`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return { quotes, firstHtml };
}

/* "Utility Flat Fee - STU" is the portal's own code for the studio rate. */
const feeName = (name) => name.replace(/\s*-\s*[A-Z0-9]{1,5}$/, "");

/* "Plus $40/mo Utility Flat Fee" for a lease blurb; null when there are none. */
function feeLine(fees) {
  if (!fees?.length) return null;
  return `Plus ${fees.map(([name, amt]) => `$${amt}/mo ${feeName(name)}`).join(", ")}`;
}

/* Sentences joined with one full stop between them. */
const sentences = (...parts) =>
  parts
    .filter(Boolean)
    .map((p) => p.trim().replace(/[.\s]+$/, ""))
    .join(". ") || null;

/* One line per fee across the building: "a Utility Flat Fee of $40 to $70/month". */
function feeSummary(feeLists) {
  const byName = new Map();
  for (const fees of feeLists) for (const [name, amt] of fees ?? []) byName.set(feeName(name), [...(byName.get(feeName(name)) ?? []), amt]);
  return [...byName.entries()].map(([name, amts]) => {
    const lo = Math.min(...amts);
    const hi = Math.max(...amts);
    return `The portal adds a ${name} of ${lo === hi ? `$${lo}` : `$${lo} to $${hi}`}/month${lo === hi ? "" : ", by apartment size,"} on top of the rent shown.`;
  });
}

/*
 * Read a building through its portal. Returns raw snapshot units (one per
 * floor plan, one offer per apartment and price, lease lengths from the
 * quote sheet), plus the ids and prices learned, or null when the portal
 * gave nothing.
 *
 *   portal      { host, slug, propertyId } from findSecureCafe
 *   known       what a previous read learned, so only apartments whose rent
 *               moved (and new ones) are quoted again (the sync)
 *   onStep      progress text for the workspace
 */
/*
 * Each plan's pictures, asked from inside the Apartments page. "View Floor
 * Plan" opens a gallery (contentclass=photogallery&imagetype=floorplan) of
 * the plan's images on the RentCafe CDN; the hover tooltip shows the first
 * of them, which may or may not be the drawing. Returns { planId: [urls] }
 * with drawing-like names first; the vision check settles which is the
 * diagram.
 */
export const planImagesScript = () => `
  (async () => {
    const out = {};
    for (const box of document.querySelectorAll('[id^="links_"]')) {
      const planId = (box.id.match(/links_(\\d+)/) || [])[1];
      if (!planId) continue;
      const link = box.querySelector('.view-floor-plan a');
      const oc = (link && link.getAttribute('onclick')) || '';
      const q = (oc.match(/'(imagetype=floorplan[^']+)'/) || [])[1];
      if (!q) continue;
      try {
        const r = await fetch('/rcloadcontent.ashx?contentclass=photogallery&' + q.replace(/&amp;/g, '&'), { credentials: 'include' });
        if (!r.ok) continue;
        const html = await r.text();
        // The gallery writes "photo(1).jpg?&maxwidth=800" for a file the CDN
        // only has as "photo.jpg": the "(1)" and the query go, one entry per file.
        const seen = new Set();
        out[planId] = [];
        for (const u of html.match(/https?:\\/\\/[^"'\\s]+\\.(?:jpe?g|png|webp|gif)[^"'\\s]*/gi) || []) {
          const key = u.replace(/\\?.*$/, '').replace(/\\(\\d+\\)(\\.[a-z]+)$/i, '$1');
          if (seen.has(key)) continue;
          seen.add(key);
          out[planId].push(key);
          if (out[planId].length >= 24) break;
        }
      } catch (e) { /* this plan keeps the website's pictures */ }
    }
    return JSON.stringify(out);
  })()`;

const DRAWING_NAME_RE = /floor-?plan|diagram|layout|[-_]unit[-_]|[-_]plan[-_]/i;
const MAX_PLAN_PHOTOS = 12;

export async function readSecureCafe(portal, { known = null, onStep = () => {}, deep = true } = {}) {
  onStep("Reading the leasing portal");
  const moveIn = soon();
  /*
   * The Apartments step lists what is free by the move-in date asked for:
   * two weeks out, 212 Clayton showed 3 of its 17 apartments. Asked six
   * months out it lists them all; each is then priced at its own date.
   */
  const listMoveIn = mdy(new Date(Date.now() + LIST_AHEAD_DAYS * 86400000));
  const page = await renderPage(apartmentsUrl(portal, listMoveIn), { waitMs: 6000, actions: [{ type: "executeJavascript", script: planImagesScript() }] });
  const parsed = page ? parseApartmentsPage(page.html) : null;
  if (!parsed) return null;
  let planImages = {};
  try {
    planImages = JSON.parse(page.returns?.find((v) => typeof v === "string" && v.startsWith("{")) ?? "{}");
  } catch {
    planImages = {};
  }
  // Drawing-like names first so the photo cap never drops the diagram.
  const picturesOf = (planId) => {
    const urls = (planImages[planId] ?? []).filter((u) => typeof u === "string" && /^https?:/.test(u) && !/thumbnail/i.test(u));
    const named = (u) => DRAWING_NAME_RE.test(u.split("/").pop() ?? "");
    return [...urls.filter(named), ...urls.filter((u) => !named(u))].slice(0, MAX_PLAN_PHOTOS);
  };

  const all = parsed.plans.flatMap((p) => p.apartments.map((a) => ({ ...a, planId: p.id })));
  const remembered = new Map((known?.apartments ?? []).map((a) => [a.unitId, a]));
  // Quote what is new or repriced; reuse the rest from the last read.
  // Reused only when the last read recorded which terms the slider allowed;
  // earlier reads quoted terms of our own choosing and must be redone.
  const fresh = (a) => {
    const r = remembered.get(a.unitId);
    return r && r.rent === a.rent && r.termPrices && Array.isArray(r.terms) && r.terms.length;
  };
  const toQuote = all
    .filter((a) => a.rent != null && !fresh(a))
    .slice(0, deep ? MAX_QUOTED : BATCH)
    // Priced for the day it frees up (or soon, if it is free now).
    .map((a) => ({ ...a, moveIn: a.availableOn && new Date(a.availableOn) > new Date(Date.now() + 86400000) ? mdy(new Date(`${a.availableOn}T12:00:00`)) : moveIn }));
  let range = known?.range ?? null;
  let term = known?.term ?? null;
  let specialValue = null;
  const quotes = new Map();
  if (toQuote.length) {
    onStep(`Pricing ${toQuote.length} apartment${toQuote.length === 1 ? "" : "s"} at the lease lengths the portal offers`);
    const got = await quoteApartments(portal, toQuote, moveIn, onStep);
    for (const [k, v] of got.quotes) quotes.set(k, v);
    const options = got.firstHtml ? parseRentalOptionsPage(got.firstHtml) : null;
    range = options?.range ?? range;
    term = options?.term ?? term;
    specialValue = options?.specialValue ?? null;
  }
  const quoteFor = (a) => quotes.get(a.unitId) ?? (fresh(a) ? remembered.get(a.unitId) : null);

  const concessions = new Set();
  const feeLists = [];
  const units = parsed.plans.map((p) => ({
    name: p.name,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    area: p.apartments.map((a) => a.area).filter(Boolean).sort((x, y) => y - x)[0] ?? null,
    // The portal's gallery for the plan; the vision check promotes the
    // drawing among them to the floor plan slot.
    floorPlanImageUrl: null,
    available: p.apartments.length > 0,
    photos: picturesOf(p.id),
    offers: p.apartments.flatMap((a) => {
      if (a.special) concessions.add(a.special);
      const q = quoteFor(a);
      if (q?.fees?.length) feeLists.push(q.fees);
      const special = sentences(a.special, feeLine(q?.fees));
      // No date on the portal means the apartment is available now.
      const base = { rentIsPerPerson: false, availableFrom: a.availableOn, availableNow: !a.availableOn, apartments: a.number ? [a.number] : [], special };
      // A price per term becomes a lease per price (the PRD's shape); terms
      // that share a price share a lease.
      if (q?.termPrices && Object.keys(q.termPrices).length) {
        const byRent = new Map();
        for (const [months, rent] of Object.entries(q.termPrices)) byRent.set(rent, [...(byRent.get(rent) ?? []), Number(months)]);
        return [...byRent.entries()].map(([rent, months]) => ({ ...base, rent, leaseTermMonths: months.sort((x, y) => x - y) }));
      }
      return [{ ...base, rent: a.rent, leaseTermMonths: term ? [term] : [] }];
    }),
    portalPlanId: p.id,
  }));

  const notes = [];
  // What the slider let us pick, across the building, against what the
  // page advertises: "3 to 24 months" on the page, 12 on every slider.
  const offered = [...new Set(all.flatMap((a) => quoteFor(a)?.terms ?? []))].sort((x, y) => x - y);
  if (offered.length) {
    const list = offered.length === 1 ? `${offered[0]} months` : `${offered.slice(0, -1).join(", ")} and ${offered[offered.length - 1]} months`;
    notes.push(
      range && (offered.length > 1 || offered[0] !== range[0] || offered[0] !== range[1])
        ? `The leasing portal advertises lease terms from ${range[0]} to ${range[1]} months but is currently letting applicants choose ${list}; the leases here carry what it lets them choose.`
        : `The leasing portal is currently leasing for ${list}.`
    );
  }
  notes.push(...feeSummary(feeLists));
  if (specialValue) notes.push(`The current special is worth about $${specialValue} on a 12-month lease, per the portal.`);
  if (toQuote.length && !quotes.size) notes.push(TIMEOUT_NOTE);

  return {
    units,
    concessions: [...concessions],
    notes,
    learned: {
      kind: "securecafe",
      ...portal,
      term,
      range,
      plans: parsed.plans.map((p) => ({ id: p.id, name: p.name })),
      apartments: all.map((a) => {
        const q = quoteFor(a);
        return { unitId: a.unitId, planId: a.planId, number: a.number, rent: a.rent, terms: q?.terms ?? null, termPrices: q?.termPrices ?? null, fees: q?.fees ?? null };
      }),
    },
    apartments: all.length,
    quoted: quotes.size,
    reused: all.filter((a) => !quotes.has(a.unitId) && quoteFor(a)).length,
  };
}
