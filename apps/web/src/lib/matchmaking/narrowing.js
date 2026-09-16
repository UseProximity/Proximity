import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  fetchActiveListings,
  splitEligible,
  slimCandidate,
  parseGroupRange,
  splitFor,
} from "./listingFilter";
import { MAX_TRADEOFFS } from "./questionScript";
import { triageTradeoff } from "./tradeoffTriage";

// After the scripted questions, if MORE than three listings still fit the
// student, Proxy narrows the field with listing-aware "Would you X for Y?"
// tradeoff questions — each generated from the REAL differences among the
// candidates (price vs furnished, closer-but-pricier vs farther-but-cheaper,
// near-a-shuttle vs a short walk, …). Answering one prunes the losing side from
// the pool; we ask at most MAX_TRADEOFFS before handing off to the deterministic
// top-3 ranking. This is the one place we let the LLM both phrase the question
// AND choose the split, so the language stays organic and grounded in the data.
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// Cap how many candidates we hand the model per turn — plenty to find a real
// split, bounded so the prompt stays cheap. Listings beyond the cap simply
// survive the turn (the count check uses the FULL eligible set, so we keep
// asking up to the cap and then rank whatever remains).
const POOL_CAP = 40;

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.PROXY_CHAT_KEY });
  return _client;
}

// The axes a tradeoff can be built on. The model must DECLARE which one it split
// the pool along, so the code can reason about the question instead of guessing
// from its prose. It's a cross-check, not the source of truth: the actual numbers
// on each side are computed from our own listing data (see sideProfile).
const AXES = ["price", "proximity", "reviews", "amenities", "furnished", "lease", "neighborhood", "beds", "other"];

// Which declared axis makes a question genuinely ABOUT a given relaxed
// constraint. A shadow listing may only be offered (and therefore opted into) by
// a question on its own axis: a student answering a question about star ratings
// must never thereby accept a place $98 over their budget.
const AXIS_FOR_CONSTRAINT = {
  budget: "price",
  lease_term: "lease",
  furnished: "furnished",
  neighborhood: "neighborhood",
};

const TradeoffSchema = z.object({
  question: z.string().min(1),
  axis: z.enum(AXES),
  optionA: z.object({ label: z.string().min(1), idx: z.array(z.number()) }),
  optionB: z.object({ label: z.string().min(1), idx: z.array(z.number()) }),
});

const NARROW_SYSTEM = `You are Proxy, a housing matchmaker for WashU (Washington University in St. Louis) students. Your personality is playful but serious: warm and a little fun, never silly, and always genuinely helpful. Always write in correct, grammatical English with proper spelling, punctuation, and capitalization. The student has answered preference questions and several listings still fit them. Ask ONE short either/or question that splits the remaining listings into two genuinely appealing groups along a REAL tradeoff in the data, so we can narrow toward their favorites.

You are given:
- preferences and weights (what they told us they care about)
- candidates: the listings still in play, each { idx, title, per_person_rent, furnished, avg_review, amenities, bedrooms_max, units_for_group, lease_term_months, walk_to_campus_min, walk_to_shuttle_min, walk_to_med_campus_min, walk_to_grocery_min }. "idx" is a small integer id for the listing. A field may be null (unknown); never assert it. bedrooms_max is the biggest single unit. units_for_group is how many units in the building the group would take: null or 1 means one unit sleeps everyone; 2 or more means they'd take that many units in the same building (which only happens for groups of 5+, and those units add up to exactly the headcount).
- askedAngles: tradeoffs you've already asked. Pick a DIFFERENT angle.

BEDS ANGLE (ask it FIRST when it applies): if the candidates are genuinely split between places where one unit sleeps everyone (units_for_group null or 1) and places where the group would take several units in the same building (2 or more), that is usually the most decision-relevant tradeoff. Unless askedAngles shows you already asked it, lead with it, naming the real benefit the multi-unit places bring from the data (e.g. "Would you take two units in the same building if it meant saving about $200 a month each?" or "...if it meant being 10 minutes closer to campus?").

Find the most decision-relevant axis where these listings actually differ, then phrase a natural "Would you X for Y?"-style question using REAL numbers from the candidates (e.g. the typical price gap between the furnished and unfurnished ones, or the extra walking minutes for the cheaper cluster). Examples of the FEEL (do not copy verbatim): "Would you pay about $250 more a month for a furnished place?", "Would you be okay being about 12 minutes farther from campus if it means a lower rent and a shuttle stop nearby?", "Is it worth a bit more for the places with standout reviews?"

PRICE IS A CAP, NOT A TARGET. Every candidate you are given is already inside the student's budget unless it carries over_budget true. So a difference in rent BETWEEN two in-budget options costs them nothing they asked to protect: do NOT build a question around "pay $X more for Y" when both sides are in budget, UNLESS "Good value" is one of their stated priorities. Money is only a real axis when one side is over their cap (over_budget true), or when they told you saving money matters. Otherwise split on something they'd actually weigh: distance, reviews, amenities, furnished, lease length, or how many units the group takes.

Declare the axis you split on as "axis", one of: price, proximity, reviews, amenities, furnished, lease, beds, other. Use "price" ONLY when rent is genuinely the thing being traded (see above).

Partition the candidates by their idx: optionA.idx are the listings that fit one answer, optionB.idx the other. Output JSON ONLY, no markdown:
{"question":"<one friendly sentence>","axis":"proximity","optionA":{"label":"<short, human answer chip>","idx":[1,2]},"optionB":{"label":"<short, human answer chip>","idx":[3,4]}}

Rules:
- idx values MUST be real candidate idx integers. optionA.idx and optionB.idx are DISJOINT and each NON-EMPTY. Together they cover most candidates (a few truly-neutral ones may be left out and will simply survive).
- Pick a split that meaningfully reduces the field; never put (almost) everything on one side.
- Labels are the student's possible ANSWERS (e.g. "Yes, worth it" / "No, keep it cheaper"), not "Option A/B". Keep them under ~5 words.
- One sentence. Specific, friendly, grounded in the real numbers. No preamble.
- Never use em dashes (—) anywhere in the question or labels. Use commas, periods, or parentheses instead.`;

// Ask Haiku for ONE tradeoff question over the current candidate pool. Returns a
// client-safe question descriptor (labels only) plus the server-only id mapping
// used to prune the pool when the student answers. Returns { question: null } on
// any failure so the caller can simply fall back to ranking what's left.
export async function generateTradeoff(candidates, preferences, weights, askedAngles) {
  if (!candidates.length) return { question: null, usage: null };
  // Hand the model SHORT integer ids (idx) instead of full listing UUIDs: it only
  // has to echo small numbers when partitioning, which keeps the JSON tiny and
  // avoids the truncated/unterminated output we got when it echoed 40 UUIDs.
  const idxToId = new Map(candidates.map((c, i) => [i + 1, c.listing_id]));
  const forModel = candidates.map((c, i) => {
    const { listing_id, ...rest } = c;
    return { idx: i + 1, ...rest };
  });
  try {
    const response = await getClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: NARROW_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: JSON.stringify({ preferences, weights, candidates: forModel, askedAngles }),
        },
      ],
    });
    const raw = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    let parsedJson;
    try {
      parsedJson = JSON.parse(jsonText);
    } catch (parseErr) {
      console.error("[narrowing] tradeoff JSON unparseable:", parseErr.message);
      return { question: null, usage: response.usage };
    }
    const parsed = TradeoffSchema.safeParse(parsedJson);
    if (!parsed.success) {
      console.error("[narrowing] tradeoff schema invalid:", parsed.error.message);
      return { question: null, usage: response.usage };
    }

    // Map the model's idx integers back to real listing ids, dropping any unknown.
    const aIds = [...new Set(parsed.data.optionA.idx.map((n) => idxToId.get(n)).filter(Boolean))];
    const aSet = new Set(aIds);
    // Enforce disjoint sides (a listing the model double-listed stays with A).
    const bIds = [...new Set(parsed.data.optionB.idx.map((n) => idxToId.get(n)).filter(Boolean))]
      .filter((id) => !aSet.has(id));
    // A real split needs a non-empty losing side on EITHER choice.
    if (aIds.length === 0 || bIds.length === 0) return { question: null, usage: response.usage };

    // Strip any em dash from the chips the same way the prompt is sanitized; both
    // the client option and the serverOptions key derive from these, so they stay
    // matched. (The system prompt forbids them, this is belt-and-suspenders.)
    const stripDash = (s) => s.replace(/\s*—\s*/g, ", ").replace(/—/g, "-");
    const labelA = stripDash(parsed.data.optionA.label.trim());
    const labelB = stripDash(parsed.data.optionB.label.trim());
    // Guard against identical labels (can't tell the answers apart).
    if (labelA.toLowerCase() === labelB.toLowerCase()) return { question: null, usage: response.usage };

    return {
      question: {
        id: "tradeoff",
        field: "_tradeoff",
        kind: "tradeoff",
        prompt: parsed.data.question.trim(),
        options: [labelA, labelB],
        meta: { allowUnsure: true },
      },
      // Server-only: which listings each answer keeps. Never sent to the client.
      serverOptions: {
        prompt: parsed.data.question.trim(),
        options: { [labelA]: aIds, [labelB]: bIds },
      },
      // The machine-readable form of the split, for triageTradeoff. `axis` is the
      // model's own claim about what it split on; the id lists are what the code
      // actually measures.
      split: { axis: parsed.data.axis, aIds, bIds, labelA, labelB },
      usage: response.usage,
    };
  } catch (err) {
    console.error("[narrowing] generateTradeoff failed:", err);
    return { question: null, usage: null };
  }
}

// How many generated tradeoffs we'll silently resolve before giving up and just
// ranking. Each one costs a Haiku call, so the loop is bounded.
const MAX_AUTO_RESOLVE = 4;

// Decide the next step after the scripted questions: a tradeoff question worth
// asking, or a signal to finalize.
//
// Shadow listings (missing exactly one stated constraint) ARE in the candidate
// pool, so Proxy can ask "would you go $98 over to be 7 minutes closer?" at the
// moment it's decision-relevant. But they never count toward the three we're
// narrowing to (the stop condition counts FIT listings only), and they only ever
// reach the cards if the student takes their side of a question that is actually
// about the constraint they break.
//
// Generated questions run through triageTradeoff first: the ones whose answer is
// already determined by what the student told us are resolved in code and never
// shown. Returns the updated preferences whenever auto-resolution pruned anything.
export async function buildNarrowingTurn(session) {
  let prefs = { ...(session.preferences ?? {}) };
  const allListings = await fetchActiveListings();
  const range = parseGroupRange(prefs.group_size);
  const needsGroup = range.min >= 2;

  for (let attempt = 0; attempt <= MAX_AUTO_RESOLVE; attempt++) {
    const { strict, shadow } = splitEligible(allListings, prefs);
    const asked = prefs._tradeoffCount ?? 0;
    // Stop on the FIT count alone: shadow listings are opt-in extras, so they are
    // never a reason to keep interrogating someone whose real field is already
    // down to three.
    if (strict.length <= 3 || asked >= MAX_TRADEOFFS) {
      return { kind: "final", count: strict.length, preferences: prefs, usage: null };
    }

    // Annotate each candidate with how the group would occupy it (so the model can
    // ask the beds tradeoff) and which constraint it breaks, if any (so it can
    // frame the "would you go over budget for this?" question honestly).
    const shadowIds = new Set(shadow.map((e) => e.listing.id));
    const candidates = [...strict, ...shadow].slice(0, POOL_CAP).map((e) => ({
      ...slimCandidate(e.listing, e.offer),
      units_for_group: needsGroup ? splitFor(e.listing, range)?.count ?? 1 : null,
      // The one stated constraint this listing misses, or null when it fits all.
      relax_needed: e.relax?.detail ?? null,
      over_budget: e.relax?.constraint === "budget",
    }));

    const { question, serverOptions, split, usage } = await generateTradeoff(
      candidates,
      prefs,
      session.weights ?? {},
      askedAnglesOf(prefs)
    );
    if (!question || !split) {
      return { kind: "final", count: strict.length, preferences: prefs, usage };
    }

    // A shadow listing may only be OFFERED by a question about the very constraint
    // it breaks. The model routinely sprinkles them onto a side of an unrelated
    // question (a reviews question quietly carrying a $98-over place); answering
    // that is not informed consent, so those are stripped out and pruned for good.
    const constraintOf = new Map(
      [...strict, ...shadow].map((e) => [e.listing.id, e.relax?.constraint ?? null])
    );
    const offerable = (id) =>
      !shadowIds.has(id) || AXIS_FOR_CONSTRAINT[constraintOf.get(id)] === split.axis;
    const offTopic = [...split.aIds, ...split.bIds].filter((id) => !offerable(id));
    const aIds = split.aIds.filter(offerable);
    const bIds = split.bIds.filter(offerable);
    if (offTopic.length) {
      // `_narrowed`, not `_autoPruned`: these break a stated constraint, so the
      // "never leave them on one card" backfill must never revive them.
      prefs = { ...prefs, _narrowed: [...new Set([...(prefs._narrowed ?? []), ...offTopic])] };
    }
    // Stripping may have emptied a side — then there's no question left to ask.
    if (aIds.length === 0 || bIds.length === 0) continue;

    const byId = new Map(candidates.map((c) => [c.listing_id, c]));
    const aList = aIds.map((id) => byId.get(id)).filter(Boolean);
    const bList = bIds.map((id) => byId.get(id)).filter(Boolean);
    const onTopicShadow = [...aIds, ...bIds].filter((id) => shadowIds.has(id));
    const verdict = triageTradeoff({
      aList,
      bList,
      preferences: prefs,
      weights: session.weights ?? {},
      hasShadow: onTopicShadow.length > 0,
    });

    if (!verdict.ask) {
      // Determined by what they already told us — prune the losing side silently
      // and look for a question that genuinely needs their input. This does NOT
      // count against MAX_TRADEOFFS: we never asked them anything.
      const losing = verdict.keep === "A" ? bIds : aIds;
      console.log(
        `[narrowing] auto-resolved (${split.axis}): strict=${strict.length} keep ${verdict.keep} ` +
          `(A=${aIds.length}/B=${bIds.length}), pruning ${losing.length} — ${verdict.why}`
      );
      // `_autoPruned`, NOT `_narrowed`: the student never saw this question, so
      // these listings were dropped on their behalf rather than rejected by them.
      // That distinction lets ranking bring them back if our own pruning left
      // fewer than three matches (see buildRankContext).
      prefs = { ...prefs, _autoPruned: [...new Set([...(prefs._autoPruned ?? []), ...losing])] };
      continue;
    }

    // stepKey makes each tradeoff distinct so the client never dedupes two
    // consecutive "tradeoff" questions as if they were the same prompt.
    question.meta.stepKey = String(asked);
    return {
      kind: "tradeoff",
      question,
      serverOptions: {
        ...serverOptions,
        // Rebuilt from the STRIPPED sides, so an off-topic shadow listing can
        // neither be kept by this answer nor opted into by it.
        options: { [split.labelA]: aIds, [split.labelB]: bIds },
        // Only the shadow listings this question genuinely puts on the table.
        shadowIds: onTopicShadow,
      },
      count: strict.length,
      preferences: prefs,
      usage,
    };
  }

  const { strict } = splitEligible(allListings, prefs);
  return { kind: "final", count: strict.length, preferences: prefs, usage: null };
}

// The prompts already asked, for the "pick a DIFFERENT angle" instruction.
// History entries used to be bare prompt strings; sessions persisted mid-flow may
// still hold those, so read both shapes.
export function askedAnglesOf(preferences) {
  return (preferences?._tradeoffHistory ?? []).map((h) => (typeof h === "string" ? h : h?.prompt)).filter(Boolean);
}

// Every listing pruned by the tradeoff answers recorded so far. DERIVED from the
// history rather than accumulated, so truncating the history (an edit) correctly
// un-prunes everything the dropped answers had rejected.
function narrowedFrom(history) {
  const ids = [];
  for (const h of history) {
    if (typeof h === "string" || !h?.options) continue;
    for (const [label, listingIds] of Object.entries(h.options)) {
      if (label !== h.chosen) ids.push(...(listingIds ?? []));
    }
  }
  return [...new Set(ids)];
}

// The shadow listings the student EXPLICITLY accepted, by taking the side of a
// tradeoff that contained them ("yes, $98 over is worth being closer"). Nothing
// else from the shadow pool may ever be shown. Derived from the history like
// `_narrowed`, so editing an answer withdraws the opt-in it granted.
function shadowOptInFrom(history) {
  const ids = [];
  for (const h of history) {
    if (typeof h === "string" || !h?.options || !h.chosen) continue;
    const shadow = new Set(h.shadowIds ?? []);
    if (shadow.size === 0) continue;
    ids.push(...(h.options[h.chosen] ?? []).filter((id) => shadow.has(id)));
  }
  return [...new Set(ids)];
}

// Apply a student's tradeoff answer to the session preferences: record the whole
// question (prompt + partition + what they picked) in the history, re-derive the
// pruned set from it, and clear the pending tradeoff. `chosen` is the label they
// tapped. Storing the partition is what makes an answer EDITABLE later — we can
// re-ask the exact question, and re-apply a different side, with no new LLM call.
//
// Rejections land in `_narrowed`, NOT `_excluded`. Both are filtered out of the
// results identically, but they mean different things: `_excluded` is "the
// student dislikes this place", while `_narrowed` is "our own tradeoff question
// pruned it". The coaching notes ignore `_narrowed` so Proxy never calls a search
// a hard combination when it was Proxy's own questions that thinned the field.
export function applyTradeoffChoice(preferences, chosen) {
  const prefs = { ...(preferences ?? {}) };
  const pend = prefs._pendingTradeoff;
  const history = [...(prefs._tradeoffHistory ?? [])];
  if (pend?.prompt) {
    history.push({
      prompt: pend.prompt,
      options: pend.options ?? {},
      chosen: typeof chosen === "string" ? chosen : null,
      // Which of the offered listings break one of their stated constraints —
      // picking that side is what admits them to the results.
      shadowIds: pend.shadowIds ?? [],
      // The commute check reuses this machinery but is a different question —
      // tagged so a rewind past it knows to re-arm it (see rewindTradeoffs).
      kind: pend.kind ?? "tradeoff",
    });
  }
  prefs._tradeoffHistory = history;
  prefs._narrowed = narrowedFrom(history);
  prefs._shadowOptIn = shadowOptInFrom(history);
  prefs._tradeoffCount = history.length;
  delete prefs._pendingTradeoff;
  return prefs;
}

// Rewind the narrowing phase to just before tradeoff #index (0-based): drop that
// answer and every one after it, un-prune what they had rejected, and re-arm the
// question itself so the student can answer it differently. Returns the new
// preferences plus the question descriptor to re-ask (null if there's nothing at
// that index).
export function rewindTradeoffs(preferences, index) {
  const prefs = { ...(preferences ?? {}) };
  const history = [...(prefs._tradeoffHistory ?? [])];
  if (index < 0 || index >= history.length) return { preferences: prefs, question: null };

  const entry = history[index];
  const kept = history.slice(0, index);
  const dropped = history.slice(index);

  prefs._tradeoffHistory = kept;
  prefs._narrowed = narrowedFrom(kept);
  prefs._shadowOptIn = shadowOptInFrom(kept);
  prefs._tradeoffCount = kept.length;
  // Silent auto-prunes aren't in the history, so they can't be replayed — drop
  // them wholesale and let narrowing re-derive them from the rewound state.
  delete prefs._autoPruned;
  // If the one-time commute check is among the dropped answers, un-ask it so it
  // can fire again at the right moment.
  if (dropped.some((h) => h?.kind === "commute")) delete prefs._commuteAsked;

  // A legacy string entry has no stored partition, so it can't be re-asked
  // verbatim; rewinding to it simply resumes narrowing from that point.
  if (typeof entry === "string" || !entry?.options) {
    delete prefs._pendingTradeoff;
    return { preferences: prefs, question: null };
  }

  prefs._pendingTradeoff = {
    prompt: entry.prompt,
    options: entry.options,
    shadowIds: entry.shadowIds ?? [],
    kind: entry.kind ?? "tradeoff",
  };
  const options = Object.keys(entry.options);
  return {
    preferences: prefs,
    question: {
      id: entry.kind === "commute" ? "commute_confirm" : "tradeoff",
      field: entry.kind === "commute" ? "_commute" : "_tradeoff",
      kind: "tradeoff",
      prompt: entry.prompt,
      options,
      meta: {
        stepKey: entry.kind === "commute" ? "commute" : String(index),
        ...(entry.kind === "commute" ? {} : { allowUnsure: true }),
      },
    },
  };
}
