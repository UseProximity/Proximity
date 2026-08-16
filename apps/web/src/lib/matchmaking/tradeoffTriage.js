// Deterministic triage for the narrowing phase's "Would you X for Y?" questions.
//
// Kept in its own module with NO imports on purpose: this is the part that must
// be provably correct, so it can be reasoned about (and tested) without the LLM,
// Supabase, or the rest of the pipeline in the way. narrowing.js calls it after
// the model proposes a split.

// ── DETERMINISTIC TRADEOFF TRIAGE ───────────────────────────────────────────
// A tradeoff is only worth a turn if the student could genuinely go either way.
// "Pay $85 more to be 7 minutes closer" is NOT such a question when both options
// sit inside their budget and they never said they cared about saving money:
// they told us their budget was $1,000, so spending $750 instead of $665 costs
// them nothing they asked to protect. We resolve those in code and never ask.
//
// The quality dimensions we can compare, each with the direction that is BETTER
// and the weight keys that mean "this student cares about it". Price is
// deliberately absent — it's the thing being traded, not a quality.
// `min` is how far apart the two sides must be before the difference counts as
// real. Comparing side AVERAGES, a 30-second walk or a 0.05-star gap is noise,
// and silently discarding half the field over noise would be worse than asking.
const QUALITY_DIMS = {
  proximity: { get: (c) => c.walk_to_campus_min, better: "lower", weights: ["walkability", "location"], min: 2 },
  reviews: { get: (c) => c.avg_review, better: "higher", weights: ["reviews"], min: 0.3 },
  amenities: { get: (c) => c.amenities?.length ?? null, better: "higher", weights: ["amenities"], min: 1 },
};

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// What each side of a split actually looks like, computed from OUR data (never
// from anything the model reported). Prices are per person.
function sideProfile(listings) {
  const num = (fn) => avg(listings.map(fn).filter((v) => typeof v === "number" && Number.isFinite(v)));
  const prices = listings.map((c) => c.per_person_rent).filter((v) => typeof v === "number");
  return {
    price: num((c) => c.per_person_rent),
    maxPrice: prices.length ? Math.max(...prices) : null,
    proximity: num((c) => c.walk_to_campus_min),
    reviews: num((c) => c.avg_review),
    amenities: num((c) => c.amenities?.length ?? null),
    // A side containing an unpriced listing can't be proven within budget.
    anyUnpriced: listings.some((c) => c.per_person_rent == null),
  };
}

// Which quality dimensions this student actually cares about (stated priorities
// → weights). A dimension nobody weighted is not a reason to prefer either side.
function caredDims(weights) {
  const w = weights ?? {};
  return Object.entries(QUALITY_DIMS)
    .filter(([, cfg]) => cfg.weights.some((k) => (w[k] ?? 0) > 0))
    .map(([dim]) => dim);
}

// Is side X at least as good as Y on every cared-about dimension, and strictly
// better on at least one? (Pareto dominance, ignoring price.) Dimensions where
// either side has no data are skipped rather than guessed.
function dominates(x, y, dims) {
  let strict = false;
  for (const dim of dims) {
    const a = x[dim];
    const b = y[dim];
    if (a == null || b == null) continue;
    const { better, min } = QUALITY_DIMS[dim];
    // Gap smaller than `min` = the sides are equivalent on this dimension; it
    // neither justifies skipping the question nor blocks it.
    if (Math.abs(a - b) < min) continue;
    const xBetter = better === "lower" ? a < b : a > b;
    if (!xBetter) return false; // materially worse on something they care about
    strict = true;
  }
  return strict;
}

// Decide whether a generated tradeoff should be ASKED or silently resolved.
// Returns { ask: true } or { ask: false, keep: "A"|"B" }.
//
// We only auto-resolve a money-for-quality question where money is not actually
// at stake: BOTH sides fully inside the budget, the student did NOT name "Good
// value" as a priority (if they did, saving money IS the quality they asked
// for), and one side is Pareto-better on the dimensions they care about. Anything
// touching an over-budget (shadow) listing is always asked — that's the student's
// call to make, never ours.
export function triageTradeoff({ aList, bList, preferences, weights, hasShadow }) {
  // A question that genuinely puts a constraint-breaking listing on the table is
  // always the student's call — never ours.
  if (hasShadow) return { ask: true, why: "an over-constraint listing is on offer" };

  const priorities = Array.isArray(preferences?.priorities) ? preferences.priorities : [];
  if (priorities.includes("Good value")) return { ask: true, why: "value is a stated priority" };

  const budgetMax = preferences?.budget_max;
  if (budgetMax == null) return { ask: true, why: "no budget set" };

  const a = sideProfile(aList);
  const b = sideProfile(bList);
  // Both sides must be PROVEN within budget; an unpriced listing isn't.
  if (a.anyUnpriced || b.anyUnpriced) return { ask: true, why: "unpriced listing in play" };
  if ((a.maxPrice ?? Infinity) > budgetMax || (b.maxPrice ?? Infinity) > budgetMax) {
    return { ask: true, why: "a side runs over budget" };
  }

  const dims = caredDims(weights);
  if (dims.length === 0) return { ask: true, why: "no quality dimension is weighted" };

  if (dominates(a, b, dims)) return { ask: false, keep: "A", why: "A is better on everything they care about, within budget" };
  if (dominates(b, a, dims)) return { ask: false, keep: "B", why: "B is better on everything they care about, within budget" };
  return { ask: true, why: "a genuine tradeoff on quality" };
}
