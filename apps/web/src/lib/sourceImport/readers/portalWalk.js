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
 *     log: [text], done, timeUp, empty, listedAll }
 *
 *   done       every apartment the portal lists was reached
 *   timeUp     the render's time ran out with more to do
 *   empty      why the portal showed nothing, when it did: "no_plans" (no
 *              floor plans listed: down, or asking visitors to sign in)
 *   listedAll  every floor plan was listed at the portal's own first date
 *   units[n].stuck   the apartment would not open twice: left for last
 *
 * Time. A server function lives five minutes and a sync does more than read
 * the portal, so one run gives the portal PORTAL_RUN_MS. A building of a dozen
 * apartments fits; a larger one is finished by the next run, which picks up
 * from the progress kept on the monitor (a walk is one render, as long as the
 * renderer allows: WALK_MS, or SHORT_WALK_MS where it will not run a script
 * that long).
 */
import { renderPage } from "@/lib/listingDraft/fetchSite";
import { mergeWalk, resumePoint, stuckUnits, unitsFromWalk } from "./portalWalkParse.js";

export const PORTAL_RUN_MS = 175000;
export const WALK_MS = 120000;
export const SHORT_WALK_MS = 40000;
const RENDER_SLACK_MS = 35000;
// The shortest walk worth a render, and so the shortest run worth starting.
const MIN_WALK_MS = 30000;
export const MIN_PORTAL_RUN_MS = MIN_WALK_MS + RENDER_SLACK_MS;
const MAX_RUNS = 6;
// Progress older than this is prices from another week: start again.
const PROGRESS_FRESH_MS = 3 * 86400000;

/* One render of the portal's app with the walk script inside it. */
async function walkOnce(def, target, { skip, budgetMs, resumeAt = [], last = [] }) {
  const r = await renderPage(def.appUrl(target), {
    waitMs: def.waitMs ?? 6000,
    raw: true,
    timeoutMs: budgetMs + RENDER_SLACK_MS,
    actions: [{ type: "executeJavascript", script: def.walkScript({ skip, budgetMs, resumeAt, last }) }],
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

/* A portal that gave nothing, and why, for the team (read.js portalUnread). */
const nothingRead = (reason) => ({ units: [], notes: [], complete: false, pending: false, reason, learned: null, apartments: 0, quoted: 0 });

/*
 * Read a building through its portal. Returns raw snapshot units (one per
 * floor plan, one offer per apartment and price). When the portal gave
 * nothing, units is empty and `reason` says why.
 *
 *   def      the portal (readers/portals.js)
 *   portal   what def.find saw on the landlord's site
 *   known    what an earlier read learned: the portal's own id, the walk
 *            length the renderer allowed, and a walk left unfinished
 *   linked   the landlord's site links to the portal today (false when it
 *            is only remembered from an earlier read)
 *
 * `complete` says every apartment the portal lists was read. When it is
 * false and `pending` is true, the walk ran out of time with more to do:
 * `learned.progress` holds what it has, and the next read carries on.
 */
export async function walkPortal(def, portal, { known = null, linked = true, onStep = () => {}, today = new Date().toISOString().slice(0, 10), runMs = PORTAL_RUN_MS } = {}) {
  onStep("Reading the leasing portal");
  const sameBuilding = !!known && known.kind === def.kind && def.sameBuilding(portal, known);
  const target = await def.resolve(portal, sameBuilding ? known : null);
  if (!target?.id) {
    console.warn(`[source-import] ${def.kind}: could not open the portal (${JSON.stringify(portal).slice(0, 120)})`);
    return nothingRead(linked ? "the landlord's site links to a leasing portal that could not be opened" : "the leasing portal this listing was read from before could not be opened");
  }
  const prior =
    sameBuilding && known?.progress && Date.now() - Date.parse(known.progress.startedAt ?? 0) < PROGRESS_FRESH_MS && (known.progress.runs ?? 0) < MAX_RUNS ? known.progress : null;
  const walk = { plans: prior?.plans ?? [], units: prior?.units ?? {}, priced: prior?.priced ?? [], log: [] };
  const startedAt = prior?.startedAt ?? new Date().toISOString();
  const deadline = Date.now() + runMs;
  let walkMs = sameBuilding && known?.walkMs ? known.walkMs : WALK_MS;
  let complete = false;
  let progressed = false;
  let lastLog = [];
  let lastEmpty = null;
  let attempts = 0;
  let rendered = false;
  const pricedBefore = walk.priced.length;
  let listedNew = false;
  for (;;) {
    const budgetMs = Math.min(walkMs, deadline - Date.now() - RENDER_SLACK_MS);
    if (budgetMs < MIN_WALK_MS) break;
    const before = walk.priced.length;
    const knownBefore = Object.keys(walk.units).length;
    attempts += 1;
    const got = await walkOnce(def, target, { skip: walk.priced.map((q) => q.number), budgetMs, resumeAt: resumePoint(walk), last: stuckUnits(walk) });
    if (!got) {
      // The renderer may not run a script this long: carry on in short walks.
      if (walkMs > SHORT_WALK_MS) {
        walkMs = SHORT_WALK_MS;
        continue;
      }
      break;
    }
    rendered = true;
    mergeWalk(walk, got);
    lastLog = got.log ?? [];
    lastEmpty = got.empty ?? null;
    const total = Object.keys(walk.units).length;
    onStep(`Priced ${walk.priced.length} of ${total} apartment${total === 1 ? "" : "s"} at every lease length the portal offers`);
    // An apartment priced, or one the portal had not listed before (it lists
    // apartments only once the move-in date nears theirs: Mansions on the
    // Plaza's 142 showed only after the date reached January, 2026-11-18).
    const found = walk.priced.length > before || total > knownBefore;
    if (total > knownBefore) listedNew = true;
    if (found) progressed = true;
    if (got.done) {
      complete = true;
      break;
    }
    // A walk that found nothing and was not cut off by the clock is stuck.
    if (!found && !got.timeUp) break;
  }
  if (!complete) console.log(`[source-import] ${def.kind} ${target.id}: walk not finished: ${lastLog.slice(-8).join(" | ") || "no log"}`);
  const built = unitsFromWalk(walk, today);
  /*
   * Listing apartments is progress only while prices follow. A run that
   * priced nothing may carry on once (the apartments it listed are priced by
   * the next run); a second such run in a row means the portal's pricing
   * step is not opening, and that has to be said, not carried on forever.
   */
  const pricedSome = walk.priced.length > pricedBefore;
  const idle = pricedSome ? 0 : (prior?.idle ?? 0) + 1;
  const pending = !complete && progressed && (pricedSome || (listedNew && idle < 2));
  // Apartments listed and not one priced: the twelve month rents the list
  // states are not the portal's price list, however far the walk got.
  const nonePriced = built.apartments > 0 && built.quoted === 0 && !pending;
  if (nonePriced) complete = false;
  if (!built.units.length && !pending) {
    return nothingRead(
      attempts === 0
        ? "there was too little time left in the run to open the leasing portal"
        : !rendered
          ? "the leasing portal's page could not be opened"
          : lastEmpty === "no_plans"
            ? "the leasing portal listed no floor plans (it may be down, or asking visitors to sign in)"
            : `the leasing portal gave no apartments (${lastLog.slice(-1)[0] ?? "no reason given"})`
    );
  }
  const notes = [...built.notes];
  if (!complete && !pending) notes.push("The leasing portal stopped answering before every apartment was read; what is here is what it gave. Check it against the portal.");
  return {
    units: built.units,
    concessions: [],
    notes,
    complete,
    pending,
    // Apartments came back but the portal's prices did not: for the team.
    reason: nonePriced ? `the leasing portal listed ${built.apartments} apartment${built.apartments === 1 ? "" : "s"} but none could be opened for lease lengths (${lastLog.slice(-1)[0] ?? "no reason given"})` : null,
    learned: {
      kind: def.kind,
      ...target.learned,
      walkMs,
      lengths: built.lengths,
      apartments: complete ? walk.priced.map((q) => ({ number: q.number, plan: q.plan, moveIn: q.moveIn, termPrices: q.terms })) : [],
      // What an unfinished walk has so far, for the next read to carry on.
      progress: pending ? { startedAt, runs: (prior?.runs ?? 0) + 1, idle, plans: walk.plans, units: walk.units, priced: walk.priced } : null,
    },
    apartments: built.apartments,
    quoted: built.quoted,
  };
}
