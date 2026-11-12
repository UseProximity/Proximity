/*
 * Walking a leasing portal the way a renter does.
 *
 * Some landlords keep their real prices only inside the leasing app behind
 * "Apply Now": every lease length priced per apartment, for that apartment's
 * own move-in date (RealPage Online Leasing was the first, Wyatt 2026-11-10).
 * Those apps are not pages: a plain fetch gets an empty shell. So a portal is
 * opened in a rendered browser and a walk script clicks through it, reading
 * what the app loads on the way, and never calls the portal's data service
 * itself.
 *
 * This file is the part every portal shares. A portal (readers/portals.js)
 * brings only what is particular to it: how to find it on the landlord's
 * site, the URL its app opens at, and the walk script for its screens. The
 * walk script returns one JSON shape whatever the portal
 * (readers/portalWalkParse.js unitsFromWalk):
 *
 *   { plans: [{ id, name, bedrooms, bathrooms, area, image }],
 *     units: { "<number>": { plan, number, avail, min, max, twelve, deposit, area } },
 *     priced: [{ number, plan, moveIn, terms: { months: rent }, services, deposit }],
 *     log: [text], done, timeUp }
 *
 * Time. A server function lives five minutes and a sync does more than read
 * the portal, so one run gives the portal PORTAL_RUN_MS. A building of a dozen
 * apartments fits; a larger one is finished by the next run, which picks up
 * from the progress kept on the monitor (a walk is one render, as long as the
 * renderer allows: WALK_MS, or SHORT_WALK_MS where it will not run a script
 * that long).
 */
import { renderPage } from "@/lib/listingDraft/fetchSite";
import { mergeWalk, unitsFromWalk } from "./portalWalkParse.js";

export const PORTAL_RUN_MS = 175000;
export const WALK_MS = 120000;
export const SHORT_WALK_MS = 40000;
const RENDER_SLACK_MS = 35000;
const MAX_RUNS = 6;
// Progress older than this is prices from another week: start again.
const PROGRESS_FRESH_MS = 3 * 86400000;

/* One render of the portal's app with the walk script inside it. */
async function walkOnce(def, target, { skip, budgetMs }) {
  const r = await renderPage(def.appUrl(target), {
    waitMs: def.waitMs ?? 6000,
    raw: true,
    timeoutMs: budgetMs + RENDER_SLACK_MS,
    actions: [{ type: "executeJavascript", script: def.walkScript({ skip, budgetMs }) }],
  });
  const returned = r?.returns?.find((v) => typeof v === "string" && v.startsWith("{"));
  if (!returned) {
    console.warn(`[source-import] ${def.kind} ${target.id}: walk returned nothing (${r ? `html ${r.html.length}, returns ${JSON.stringify(r.returns).slice(0, 200)}` : "render failed"})`);
    return null;
  }
  try {
    return JSON.parse(returned);
  } catch (err) {
    console.warn(`[source-import] ${def.kind} ${target.id}: walk unreadable: ${err?.message}`);
    return null;
  }
}

/*
 * Read a building through its portal. Returns raw snapshot units (one per
 * floor plan, one offer per apartment and price), or null when the portal
 * gave nothing.
 *
 *   def      the portal (readers/portals.js)
 *   portal   what def.find saw on the landlord's site
 *   known    what an earlier read learned: the portal's own id, the walk
 *            length the renderer allowed, and a walk left unfinished
 *
 * `complete` says every apartment the portal lists was read. When it is
 * false and `pending` is true, the walk ran out of time with more to do:
 * `learned.progress` holds what it has, and the next read carries on.
 */
export async function walkPortal(def, portal, { known = null, onStep = () => {}, today = new Date().toISOString().slice(0, 10), runMs = PORTAL_RUN_MS } = {}) {
  onStep("Reading the leasing portal");
  const sameBuilding = !!known && known.kind === def.kind && def.sameBuilding(portal, known);
  const target = await def.resolve(portal, sameBuilding ? known : null);
  if (!target?.id) {
    console.warn(`[source-import] ${def.kind}: could not open the portal (${JSON.stringify(portal).slice(0, 120)})`);
    return null;
  }
  const prior =
    sameBuilding && known?.progress && Date.now() - Date.parse(known.progress.startedAt ?? 0) < PROGRESS_FRESH_MS && (known.progress.runs ?? 0) < MAX_RUNS ? known.progress : null;
  const walk = { plans: prior?.plans ?? [], units: prior?.units ?? {}, priced: prior?.priced ?? [], log: [] };
  const startedAt = prior?.startedAt ?? new Date().toISOString();
  const deadline = Date.now() + runMs;
  let walkMs = sameBuilding && known?.walkMs ? known.walkMs : WALK_MS;
  let complete = false;
  let progressed = false;
  for (;;) {
    const budgetMs = Math.min(walkMs, deadline - Date.now() - RENDER_SLACK_MS);
    if (budgetMs < 30000) break;
    const before = walk.priced.length;
    const got = await walkOnce(def, target, { skip: walk.priced.map((q) => q.number), budgetMs });
    if (!got) {
      // The renderer may not run a script this long: carry on in short walks.
      if (walkMs > SHORT_WALK_MS) {
        walkMs = SHORT_WALK_MS;
        continue;
      }
      break;
    }
    mergeWalk(walk, got);
    const total = Object.keys(walk.units).length;
    onStep(`Priced ${walk.priced.length} of ${total} apartment${total === 1 ? "" : "s"} at every lease length the portal offers`);
    if (walk.priced.length > before) progressed = true;
    if (got.done) {
      complete = true;
      break;
    }
    // A walk that priced nothing and was not cut off by the clock is stuck.
    if (walk.priced.length === before && !got.timeUp) break;
  }
  const built = unitsFromWalk(walk, today);
  const pending = !complete && progressed;
  if (!built.units.length && !pending) return null;
  const notes = [...built.notes];
  if (!complete && !pending) notes.push("The leasing portal stopped answering before every apartment was read; what is here is what it gave. Check it against the portal.");
  return {
    units: built.units,
    concessions: [],
    notes,
    complete,
    pending,
    learned: {
      kind: def.kind,
      ...target.learned,
      walkMs,
      lengths: built.lengths,
      apartments: complete ? walk.priced.map((q) => ({ number: q.number, plan: q.plan, moveIn: q.moveIn, termPrices: q.terms })) : [],
      // What an unfinished walk has so far, for the next read to carry on.
      progress: pending ? { startedAt, runs: (prior?.runs ?? 0) + 1, plans: walk.plans, units: walk.units, priced: walk.priced } : null,
    },
    apartments: built.apartments,
    quoted: built.quoted,
  };
}
