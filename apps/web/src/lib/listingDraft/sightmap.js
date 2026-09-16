/*
 * SightMap inventory reader.
 *
 * RealPage-hosted marketing sites (metroflatsstl.com and the rest of the G5
 * estate) put their live availability inside a SightMap widget. Nothing useful
 * survives into the page: a fully rendered floor-plans page carries FOUR dollar
 * figures and two unit numbers for a building with twenty-three available
 * apartments, because the widget draws into a canvas and fetches its data
 * afterwards. Reading the page harder was never going to work.
 *
 * The widget's own API does carry all of it, and it is public and unauthenticated:
 *
 *   1. the rendered page embeds  https://sightmap.com/embed/<embedToken>
 *   2. that embed page (plain HTML, no JS needed) names its API path,
 *      api/v1/<apiToken>/sightmaps/<sightmapId>
 *   3. .../app/api/v1/<apiToken>/sightmaps/<id> returns every unit: number,
 *      floor plan, beds, baths, area, price, the date it frees up, and the
 *      lease term that price assumes
 *   4. each unit carries a leasing_price_url returning the whole term matrix,
 *      e.g. 7 months $2,203 / 9 months $2,019 / 12 months $1,974
 *
 * Step 4 is fetched once per floor plan rather than once per unit: which terms
 * a building offers does not vary unit to unit, and twenty-three extra requests
 * to learn one list is not a trade worth making.
 */

// Only ever talk to this host. The tokens come off a landlord's page, so the
// path is attacker-influenced even though the host is not — pinning the host
// is what keeps this from being an SSRF hole.
const SIGHTMAP_HOST = "sightmap.com";
const TIMEOUT_MS = 20000;
const MAX_TERM_LOOKUPS = 12;

// Worth spending a rendered page-load on. `realpage` is the giveaway that
// survives into un-rendered HTML; the others catch sites that name the widget
// directly.
export const SIGHTMAP_HINT_RE = /sightmap|realpage|onlineleasing|knockrentals/i;

export const findSightmapEmbed = (html) =>
  html?.match(/sightmap\.com\/embed\/([A-Za-z0-9]+)/i)?.[1] ?? null;

async function getJson(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname.replace(/^www\./, "") !== SIGHTMAP_HOST) {
      return null;
    }
    const res = await fetch(u, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json", "User-Agent": "ProximityListingBot/1.0" },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function getText(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname.replace(/^www\./, "") !== SIGHTMAP_HOST) {
      return null;
    }
    const res = await fetch(u, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "ProximityListingBot/1.0" },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/*
 * Returns { units: [...] } or null. Every field is whatever the API said —
 * nothing is inferred, so a null here means the site genuinely did not publish
 * it rather than that we failed to read it.
 */
export async function fetchSightmapInventory(embedToken) {
  if (!/^[A-Za-z0-9]{6,32}$/.test(embedToken ?? "")) return null;

  const embed = await getText(`https://${SIGHTMAP_HOST}/embed/${embedToken}`);
  const api = embed?.match(/api\/v1\/([A-Za-z0-9]+)\/sightmaps\/(\d+)/);
  if (!api) return null;
  const [, apiToken, sightmapId] = api;

  const payload = await getJson(
    `https://${SIGHTMAP_HOST}/app/api/v1/${apiToken}/sightmaps/${sightmapId}`
  );
  const data = payload?.data;
  if (!data?.units?.length) return null;

  const plans = new Map(
    (data.floor_plans ?? []).map((f) => [
      String(f.id),
      {
        name: f.name ?? null,
        bedrooms: typeof f.bedroom_count === "number" ? f.bedroom_count : null,
        bathrooms: typeof f.bathroom_count === "number" ? f.bathroom_count : null,
        imageUrl: f.image_url ?? null,
      },
    ])
  );

  const units = data.units
    .filter((u) => typeof u.price === "number" && u.price > 0)
    .map((u) => {
      const plan = plans.get(String(u.floor_plan_id)) ?? {};
      return {
        unitNumber: u.unit_number ?? null,
        planName: plan.name ?? null,
        bedrooms: plan.bedrooms ?? null,
        bathrooms: plan.bathrooms ?? null,
        floorPlanImageUrl: plan.imageUrl ?? null,
        area: typeof u.area === "number" ? u.area : null,
        price: u.price,
        leaseTerm: u.display_lease_term ?? null,
        availableOn: u.available_on ?? null,
        availableLabel: u.display_available_on ?? null,
        specials: u.specials_description ?? null,
        planId: String(u.floor_plan_id ?? ""),
        priceUrl: typeof u.leasing_price_url === "string" ? u.leasing_price_url : null,
      };
    });
  if (!units.length) return null;

  // One term lookup per floor plan: the offered lengths are a property of the
  // building, not of the apartment.
  const byPlan = new Map();
  for (const u of units) {
    if (!u.priceUrl) continue;
    if (!byPlan.has(u.planId)) byPlan.set(u.planId, []);
    byPlan.get(u.planId).push(u);
  }
  const termsByPlan = new Map();
  await Promise.all(
    [...byPlan.entries()].slice(0, MAX_TERM_LOOKUPS).map(async ([planId, list]) => {
      // Two attempts per plan: one unit's matrix can come back empty (a unit
      // already under application, say) and that used to leave the whole floor
      // plan with no lease terms at all.
      for (const u of list.slice(0, 2)) {
        const t = await getJson(u.priceUrl);
        const options = (t?.data?.options ?? [])
          .map((o) => ({
            months: Number(o.lease_term),
            price: typeof o.price === "number" ? o.price : null,
          }))
          .filter((o) => Number.isFinite(o.months) && o.months > 0);
        if (options.length) {
          termsByPlan.set(planId, options);
          return;
        }
      }
    })
  );

  for (const u of units) {
    u.termPricing = termsByPlan.get(u.planId) ?? null;
    delete u.priceUrl;
  }
  return { units };
}

/*
 * A compact block for the extraction prompt. Deliberately plain text rather
 * than JSON: it sits alongside the page text the model is already reading, and
 * the point is that these numbers came from the property's own availability
 * feed and should beat anything the marketing copy says.
 */
export function describeSightmapInventory(inv) {
  if (!inv?.units?.length) return null;
  const byPlan = new Map();
  for (const u of inv.units) {
    if (!byPlan.has(u.planId)) byPlan.set(u.planId, []);
    byPlan.get(u.planId).push(u);
  }
  const lines = [];
  for (const [, list] of byPlan) {
    const f = list[0];
    const head = [
      f.planName ? `"${f.planName}"` : "(unnamed floor plan)",
      f.bedrooms === 0 ? "studio" : f.bedrooms != null ? `${f.bedrooms} bed` : null,
      f.bathrooms != null ? `${f.bathrooms} bath` : null,
      f.area ? `${f.area} sq ft` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const cheapest = Math.min(...list.map((u) => u.price));
    lines.push(`FLOOR PLAN ${head}`);
    lines.push(
      `  asking rent for this floor plan: $${cheapest} per month for the whole unit` +
        ` (the lowest currently available; use this as the floor plan's rent)`
    );
    if (f.termPricing?.length) {
      lines.push(
        `  lease terms offered: ${f.termPricing
          .map((o) => `${o.months} months $${o.price}`)
          .join("; ")}`
      );
    }
    for (const u of list) {
      lines.push(
        `  unit ${u.unitNumber ?? "?"}: $${u.price}/mo` +
          (u.leaseTerm ? ` on a ${u.leaseTerm} lease` : "") +
          (u.availableOn ? `, available ${u.availableOn}` : "") +
          (u.availableLabel ? ` (${u.availableLabel})` : "") +
          (u.specials ? `, special: ${u.specials}` : "")
      );
    }
  }
  return `LIVE AVAILABILITY FEED (from this property's own availability system — these prices, unit numbers, lease terms and dates are authoritative; prefer them over anything in the page text, and never contradict them):\n${lines.join(
    "\n"
  )}`;
}
