/*
 * What a portal walk found, as snapshot units. Pure, so it is tested without a
 * browser (portalWalkParse.test.js, realpageOllParse.test.js).
 *
 * Every walked portal (readers/portalWalk.js) returns the same shape, whatever
 * its screens look like: the floor plans, the apartments it listed, and the
 * apartments it priced for each lease length. The rules for turning that into
 * leases are the writer's (one lease per price) and the same for every portal.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-11-13" -> "Nov 13, 2026".
export function sayDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null;
}

const dollars = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : null);

/* Sentences joined with one full stop between them. */
const sentences = (...parts) =>
  parts
    .filter(Boolean)
    .map((p) => String(p).trim().replace(/[.\s]+$/, ""))
    .join(". ") || null;

/* "Plus $18/mo Damage Waiver, $5/mo Pest Control", or null. */
export function feeLine(services) {
  const fees = (services ?? []).filter(([name, amt]) => name && dollars(amt));
  if (!fees.length) return null;
  return `Plus ${fees.map(([name, amt]) => `$${dollars(amt)}/mo ${name}`).join(", ")}`;
}

/*
 * One apartment's priced lengths as leases: a lease is one price, so lengths
 * that share a price share a lease (the same shape the SecureCafe reader
 * writes).
 */
export function offersFor(unit, quote, today) {
  const future = unit.avail && unit.avail > today;
  const base = {
    rentIsPerPerson: false,
    availableFrom: future ? unit.avail : null,
    availableNow: !future,
    apartments: unit.number ? [String(unit.number)] : [],
  };
  const terms = Object.entries(quote?.terms ?? {})
    .map(([months, rent]) => [Number(months), dollars(rent)])
    .filter(([months, rent]) => Number.isInteger(months) && months > 0 && months <= 36 && rent);
  if (terms.length) {
    const special = sentences(quote.moveIn ? `Rent quoted for a ${sayDate(quote.moveIn) ?? quote.moveIn} move-in and subject to change` : null, feeLine(quote.services));
    const byRent = new Map();
    for (const [months, rent] of terms) byRent.set(rent, [...(byRent.get(rent) ?? []), months]);
    return [...byRent.entries()].map(([rent, months]) => ({ ...base, rent, leaseTermMonths: months.sort((a, b) => a - b), special }));
  }
  // The portal listed the apartment but never let its lease lengths be
  // opened: its twelve month rent is the one price the list itself states.
  const rent = dollars(unit.twelve) ?? dollars(unit.min);
  if (!rent) return [];
  return [{ ...base, rent, leaseTermMonths: dollars(unit.twelve) ? [12] : [], special: "Other lease lengths are priced by the leasing office" }];
}

/*
 * The writer keeps one lease per price on a floor plan (apply.js), so two
 * apartments at the same rent have to arrive as one offer. Usually they are
 * twins (the same price for the same lengths: Ceylon's 222, 422 and 522) and
 * the offer simply names them all. When the lengths differ, the offer carries
 * every length and says that they vary, rather than dropping an apartment.
 */
export function mergeSameRent(offers) {
  const byRent = new Map();
  for (const o of offers) {
    const prior = byRent.get(o.rent);
    if (!prior) {
      byRent.set(o.rent, { ...o, apartments: [...o.apartments], leaseTermMonths: [...o.leaseTermMonths] });
      continue;
    }
    const sameLengths = prior.leaseTermMonths.join(",") === o.leaseTermMonths.join(",");
    prior.apartments = [...new Set([...prior.apartments, ...o.apartments])];
    prior.leaseTermMonths = [...new Set([...prior.leaseTermMonths, ...o.leaseTermMonths])].sort((a, b) => a - b);
    // Free now beats a date; otherwise the earliest date.
    if (o.availableNow || prior.availableNow) {
      prior.availableNow = true;
      prior.availableFrom = null;
    } else if (o.availableFrom && (!prior.availableFrom || o.availableFrom < prior.availableFrom)) {
      prior.availableFrom = o.availableFrom;
    }
    if (!sameLengths && !/vary by apartment/.test(prior.special ?? "")) prior.special = sentences(prior.special, "Lease lengths at this rent vary by apartment; confirm with the office");
  }
  return [...byRent.values()];
}

/*
 * The walk's findings as raw snapshot units, one per floor plan.
 *
 *   walk    { plans: [{ id, name, bedrooms, bathrooms, area, image }],
 *             units: { "<number>": { plan, number, avail, min, max, twelve,
 *                      deposit, area } },
 *             priced: [{ number, moveIn, terms: { months: rent },
 *                        services: [[name, amount]], deposit }] }
 *   today   "YYYY-MM-DD"
 *
 * Returns { units, notes, apartments, quoted, lengths }.
 */
export function unitsFromWalk(walk, today) {
  const quotes = new Map((walk.priced ?? []).map((q) => [String(q.number), q]));
  const byPlan = new Map();
  for (const u of Object.values(walk.units ?? {})) {
    if (!u?.plan || !u.number) continue;
    byPlan.set(u.plan, [...(byPlan.get(u.plan) ?? []), u]);
  }
  const planInfo = new Map((walk.plans ?? []).map((p) => [p.name, p]));
  const units = [];
  const lengths = new Set();
  const feeNames = new Map();
  let quoted = 0;
  let unquoted = 0;
  for (const [plan, apartments] of byPlan) {
    const info = planInfo.get(plan) ?? {};
    apartments.sort((a, b) => String(a.avail ?? "").localeCompare(String(b.avail ?? "")) || String(a.number).localeCompare(String(b.number)));
    const offers = apartments.flatMap((a) => {
      const q = quotes.get(String(a.number));
      if (q && Object.keys(q.terms ?? {}).length) {
        quoted += 1;
        for (const m of Object.keys(q.terms)) lengths.add(Number(m));
        for (const [name, amt] of q.services ?? []) if (name && dollars(amt)) feeNames.set(name, [...(feeNames.get(name) ?? []), dollars(amt)]);
      } else {
        unquoted += 1;
      }
      return offersFor(a, q, today);
    });
    if (!offers.length) continue;
    const merged = mergeSameRent(offers);
    units.push({
      name: plan,
      bedrooms: info.bedrooms ?? null,
      bathrooms: info.bathrooms ?? null,
      area: info.area ?? apartments.map((a) => a.area).filter(Boolean).sort((x, y) => y - x)[0] ?? null,
      floorPlanImageUrl: null,
      available: true,
      photos: info.image ? [info.image] : [],
      offers: merged,
      portalPlanId: info.id ?? null,
    });
  }
  const notes = [];
  const offered = [...lengths].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  if (offered.length) {
    const list = offered.length === 1 ? `${offered[0]} months` : `${offered.slice(0, -1).join(", ")} and ${offered[offered.length - 1]} months`;
    notes.push(`The leasing portal prices each apartment separately for ${list}; each price is quoted for that apartment's earliest move-in date and changes often.`);
  }
  for (const [name, amts] of feeNames) {
    const lo = Math.min(...amts);
    const hi = Math.max(...amts);
    notes.push(`The portal adds a ${name} of ${lo === hi ? `$${lo}` : `$${lo} to $${hi}`}/month on top of the rent shown.`);
  }
  if (unquoted) notes.push(`${unquoted} apartment${unquoted === 1 ? "" : "s"} on the leasing portal could not be opened for lease lengths; ${unquoted === 1 ? "it carries" : "they carry"} the portal's twelve month rent only. Check ${unquoted === 1 ? "it" : "them"}.`);
  return { units, notes, apartments: quoted + unquoted, quoted, lengths: offered };
}

/*
 * Fold one render's findings into the running total.
 *
 * An apartment free now that a render did not list, though it listed every
 * floor plan at the portal's first date (got.listedAll), has probably been
 * let. Missed twice, it is marked stuck like one that would not open (the
 * walk script marks those itself), so it stops holding the resume jump back.
 * It is never dropped here: a floor plan lists only so many apartments.
 */
export function mergeWalk(into, got) {
  if (!got) return into;
  if ((got.plans ?? []).length) into.plans = got.plans;
  const before = into.units ?? {};
  into.units = { ...before, ...(got.units ?? {}) };
  const seen = new Set((into.priced ?? []).map((q) => String(q.number)));
  into.priced = [...(into.priced ?? []), ...(got.priced ?? []).filter((q) => q?.number && !seen.has(String(q.number)) && Object.keys(q.terms ?? {}).length)];
  if (got.listedAll) {
    const priced = new Set(into.priced.map((q) => String(q.number)));
    for (const [n, u] of Object.entries(before)) {
      if (!u || u.avail || priced.has(String(u.number ?? n)) || (got.units ?? {})[n]) continue;
      const misses = (u.misses ?? 0) + 1;
      into.units[n] = { ...u, misses, ...(misses >= 2 && { stuck: true }) };
    }
  }
  into.log = [...(into.log ?? []), ...(got.log ?? [])].slice(-60);
  return into;
}

/*
 * The next Sunday's run. Portal prices are refreshed weekly on Sunday
 * (Wyatt, 2026-11-10); the cron runs at 09:00 UTC, and the check is set a
 * little before it so that run picks the listing up.
 */
export function nextSundayCheckAt(now = Date.now(), slackMs = 6 * 60 * 60 * 1000) {
  const d = new Date(now);
  const run = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0, 0));
  let days = (7 - run.getUTCDay()) % 7;
  // Today is Sunday and its run has passed (or is this one): next week's.
  if (days === 0 && run.getTime() - slackMs <= now) days = 7;
  return new Date(run.getTime() + days * 86400000 - slackMs).toISOString();
}

/*
 * Where a carried-on walk starts. A fresh render opens at the earliest
 * move-in date, and reaching an apartment that frees up months out means
 * listing every floor plan again on the way (a minute a pass on Mansions on
 * the Plaza). Opening an apartment already priced moves the date to its
 * own, so the walk is handed those apartments, latest first, one per date.
 * It jumps to the latest it can open: an apartment the portal only lists
 * once the date is near (Mansions' 142 at Jan 21 shows only from Jan 15)
 * is reached by first opening an earlier one. Only up to the earliest
 * apartment still unpriced, so that one is still priced for its own date.
 * A stuck apartment (it would not open twice, or the portal stopped listing
 * it) does not count: one of those would otherwise switch the jump off for
 * every later render. The walk tries it again last (stuckUnits).
 */
export function resumePoint(walk, max = 4) {
  const priced = new Set((walk.priced ?? []).map((q) => String(q.number)));
  if (!priced.size) return [];
  const units = Object.values(walk.units ?? {}).filter((u) => u?.number && u.plan);
  const open = units.filter((u) => !priced.has(String(u.number)) && !u.stuck);
  // An unpriced apartment free now: nothing to skip ahead to.
  if (open.some((u) => !u.avail)) return [];
  const limit = open.map((u) => u.avail).sort()[0] ?? null;
  const dates = new Set();
  return units
    .filter((u) => priced.has(String(u.number)) && u.avail && (!limit || u.avail <= limit))
    .sort((a, b) => b.avail.localeCompare(a.avail) || String(a.number).localeCompare(String(b.number)))
    .filter((u) => !dates.has(u.avail) && dates.add(u.avail))
    .slice(0, max)
    .map((u) => ({ number: String(u.number), plan: u.plan, avail: u.avail }));
}

/* The unpriced apartments a walk leaves for last (see resumePoint). */
export function stuckUnits(walk) {
  const priced = new Set((walk.priced ?? []).map((q) => String(q.number)));
  return Object.values(walk.units ?? {})
    .filter((u) => u?.number && u.stuck && !priced.has(String(u.number)))
    .map((u) => String(u.number));
}

/*
 * A walk script with its options written in where __OPTS__ is. A function
 * does the replacing, so "$&" or "$'" in a portal's floor plan name (carried
 * in resumeAt) is not read as a replacement pattern.
 */
export function withWalkOptions(script, options) {
  const json = JSON.stringify(options);
  return script.replace("__OPTS__", () => json);
}
