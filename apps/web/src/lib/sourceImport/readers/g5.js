/*
 * G5 (g5marketingcloud.com) inventory reader.
 *
 * G5 hosts the marketing sites of whole estates (Mills Properties' thirty
 * buildings and its corporate site among them). The pages draw their
 * contents from a public GraphQL inventory service after load, so a plain
 * fetch sees a footer and a render sees whatever finished in time. The
 * service itself answers plain requests, with everything the widgets show:
 *
 *   livingLocations(clientUrn)     every building a company lists: name,
 *                                  street address, its own website
 *   apartmentComplex(locationUrn)  a building's floor plans: beds, baths,
 *                                  size, starting rate, available count,
 *                                  the diagram
 *   units(locationUrn, moveInDate) the apartments behind them, with prices
 *                                  per lease term and the date each frees up
 *
 * The URNs are printed in the page: g5-c-... for the company, g5-cl-... for
 * the building (in the floor-plans-plus widget config and in asset paths).
 * Only ever talks to the inventory host; the URNs come off the landlord's
 * page, so the host must not.
 */
import { isoDate, money, num } from "../snapshot.js";

const HOST = "https://inventory.g5marketingcloud.com/graphql";
const TIMEOUT_MS = 20000;

export const G5_HINT_RE = /g5marketingcloud\.com|g5dxm\.com|g5-c-[a-z0-9]+-|g5-cl-[a-z0-9]+-/i;

export function findG5Urns(html) {
  const client = html?.match(/\b(g5-c-[a-z0-9]+-[a-z0-9-]+?)(?=["'\s/\\])/i)?.[1] ?? null;
  // The building's own URN is in the floor plans widget config when the page
  // has one; asset paths carry it too (…/g5-cl-<id>-<slug>/…).
  const location =
    html?.match(/"locationUrn"\s*:\s*"(g5-cl-[^"]+)"/i)?.[1] ??
    html?.match(/\b(g5-cl-[a-z0-9]+-[a-z0-9-]+?)(?=["'\s/\\])/i)?.[1] ??
    null;
  return { client, location };
}

async function gql(query, variables) {
  const res = await fetch(HOST, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "ProximityListingBot/1.0 (+https://useproximity.org)" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (data?.errors?.length) console.log("[source-import] g5:", data.errors[0]?.message);
  return data?.data ?? null;
}

/* A company's buildings: [{ name, address, url, kind: "property" }]. */
export async function fetchG5Locations(clientUrn) {
  if (!/^g5-c-[a-z0-9-]+$/i.test(clientUrn ?? "")) return null;
  const data = await gql(
    `query($c:[String!]){ livingLocations(clientUrn:$c, limit:200, page:1){ collection { urn name displayName street city state postalCode homePageUrl totalAvailableUnits } } }`,
    { c: [clientUrn] }
  );
  const rows = data?.livingLocations?.collection ?? [];
  if (!rows.length) return null;
  return rows.map((r) => ({
    name: (r.displayName || r.name || "").trim(),
    address: [r.street, [r.city, r.state].filter(Boolean).join(", "), r.postalCode].filter(Boolean).join(", ").replace(/, ,/g, ","),
    url: r.homePageUrl || "",
    kind: "property",
    g5LocationUrn: r.urn,
  }));
}

/*
 * A building's inventory as raw snapshot units: one per floor plan, with one
 * offer per apartment and per lease-term price where the units feed has
 * them, else one offer at the plan's starting rate.
 */
export async function fetchG5Inventory(locationUrn) {
  if (!/^g5-cl-[a-z0-9-]+$/i.test(locationUrn ?? "")) return null;
  const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const data = await gql(
    `query($u:String!){
      apartmentComplex(locationUrn:$u){ firstAvailableMoveInDate pricingDisclaimer
        floorplans { id name beds baths sqft startingRate endingRate totalAvailableUnits leaseTermBasisMin imageUrl imageUrls hasSpecials floorplanSpecial { name } } }
    }`,
    { u: locationUrn }
  );
  const plans = data?.apartmentComplex?.floorplans ?? [];
  if (!plans.length) return null;
  /*
   * The units feed is quoted against a move-in date and lists what is free
   * by then, so a date two months out covers everything available now and
   * soon; asked for today it answered nothing for a building with seven
   * apartments free. Today is the fallback, not the first try.
   */
  // ...and it answers only when asked plan by plan (floorplanId): the same
  // query without one returns nothing. A few requests in flight at a time.
  const apartments = [];
  const withUnits = plans.filter((p) => Number(p.totalAvailableUnits) > 0);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const p = withUnits[cursor++];
      if (!p) return;
      const r = await gql(
        `query($u:String!,$d:String,$f:ID){ units(locationUrn:$u, moveInDate:$d, floorplanId:$f, limit:200){ name displayName sqftDisplay availabilityDate prices { priceType formattedPrice value leaseTermBasisMin } floorplan { name } specials { name } } }`,
        { u: locationUrn, d: plus(60), f: String(p.id) }
      );
      for (const a of r?.units ?? []) apartments.push({ ...a, floorplan: a.floorplan ?? { name: p.name } });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, withUnits.length) }, worker));

  const byPlan = new Map();
  for (const a of apartments) {
    const key = String(a.floorplan?.name ?? "").toLowerCase();
    if (!byPlan.has(key)) byPlan.set(key, []);
    byPlan.get(key).push(a);
  }
  const concessions = new Set();
  // A plan with nothing free and no apartments is the catalogue, not the
  // inventory (see rentcafeEmbedded.js); it arrives when something frees up.
  let skipped = 0;
  const units = plans.filter((p) => {
    const keep = Number(p.totalAvailableUnits) > 0 || (byPlan.get(String(p.name ?? "").toLowerCase()) ?? []).length > 0;
    if (!keep) skipped += 1;
    return keep;
  }).map((p) => {
    const mine = byPlan.get(String(p.name ?? "").toLowerCase()) ?? [];
    const offers = [];
    for (const a of mine) {
      const number = (a.displayName || a.name || "").replace(/^(apt|unit|#)\s*/i, "").trim();
      const prices = (a.prices ?? []).filter((x) => money(x.value));
      if (prices.length) {
        for (const x of prices) {
          const term = num(String(x.leaseTermBasisMin ?? "").match(/\d+/)?.[0]);
          offers.push({ rent: money(x.value), rentIsPerPerson: false, leaseTermMonths: term ? [term] : [], availableFrom: isoDate(a.availabilityDate), apartments: number ? [number] : [] });
        }
      }
      for (const s of a.specials ?? []) if (s?.name) concessions.add(String(s.name).trim());
    }
    if (!offers.length && money(p.startingRate)) {
      const term = num(String(p.leaseTermBasisMin ?? "").match(/\d+/)?.[0]);
      offers.push({ rent: money(p.startingRate), rentIsPerPerson: false, leaseTermMonths: term ? [term] : [], availableFrom: null, apartments: [] });
    }
    if (p.floorplanSpecial?.name) concessions.add(String(p.floorplanSpecial.name).trim());
    const images = [...new Set([p.imageUrl, ...(p.imageUrls ?? [])].filter((u) => typeof u === "string" && /^https?:/.test(u)))];
    return {
      name: String(p.name ?? "").trim() || null,
      bedrooms: Number.isFinite(Number(p.beds)) ? Number(p.beds) : null,
      bathrooms: num(p.baths, { max: 20 }),
      area: num(p.sqft, { max: 20000, min: 50 }),
      // G5 plans carry one image, the diagram.
      floorPlanImageUrl: images[0] ?? null,
      available: Number(p.totalAvailableUnits) > 0 || offers.length > 0,
      photos: [],
      offers,
      rentRange: money(p.endingRate) && money(p.endingRate) !== money(p.startingRate) ? [money(p.startingRate), money(p.endingRate)] : null,
    };
  });
  if (!units.length) return null;
  const notes = [];
  if (skipped) notes.push(`${skipped} floor plan${skipped === 1 ? "" : "s"} with no available apartments were left out; they are added when they free up.`);
  if (data?.apartmentComplex?.pricingDisclaimer) notes.push(`The site says: ${data.apartmentComplex.pricingDisclaimer}`);
  const ranged = units.filter((u) => u.rentRange && !u.offers.some((o) => o.apartments.length)).length;
  if (ranged) notes.push(`${ranged} floor plan${ranged === 1 ? " shows" : "s show"} a rent range on the site; the lowest figure was imported as the lease price.`);
  if (units.every((u) => u.offers.every((o) => !o.leaseTermMonths.length))) {
    notes.push("The site does not publish lease lengths on its floor plans. Choose them for each lease before publishing.");
  }
  return { units, concessions: [...concessions], notes, apartments: apartments.length };
}
