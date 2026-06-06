// Pure, deterministic question-flow engine. NO supabase / Anthropic imports —
// this module is imported on both the server (chatOrchestrator, route) and the
// client (ChatClient) so the next question can render instantly with no round-trip.
import {
  QUESTION_PLAN,
  QUESTION_BY_ID,
  WEIGHT_MAP,
  PRIORITY_WEIGHTS,
  RANK_BUMPS,
  UNSURE,
  isAnswered,
} from "./questionScript";

// ── Reliable-mode pairwise ranking ─────────────────────────────────────────
// Instead of a drag-to-rank, the `priorities` step asks a short series of
// "Which matters more, A or B?" questions. We seed a likely order from signal
// already collected (budget/area/commute/etc.), then ask only enough pairwise
// comparisons to lock the top 3 — comparing each new item against the current
// #3 first so the (many) low-signal items usually drop out in a single tap.
// State lives on `preferences._pairwise`; everything here is pure so it runs
// identically on client and server.
const PRIORITY_OPTIONS = QUESTION_BY_ID.priorities.options;
const PAIRWISE_CAP = 7; // hard ceiling; remaining items fall back to seed order

// Seed score for a priority = sum of the weights its dimensions already carry.
function seedScore(label, weights) {
  return (PRIORITY_WEIGHTS[label] ?? []).reduce((sum, dim) => sum + (weights?.[dim] ?? 0), 0);
}

// The 7 priorities sorted most-likely-important first; ties keep canonical order.
function seedPriorities(weights) {
  return PRIORITY_OPTIONS.map((label, i) => ({ label, i, s: seedScore(label, weights) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.label);
}

// Build the wire pair + key for the comparison the state is currently awaiting.
function advancePairwise(s) {
  if (s.queue.length === 0) return finalizePairwise(s);
  const cand = s.queue[0];
  const idx = s.order.length; // start by comparing against the current bottom
  return { ...s, cand, queue: s.queue.slice(1), idx, pair: [cand, s.order[idx - 1]], stepKey: `${s.asked}` };
}

function finalizePairwise(s) {
  const tail = s.seedOrder.filter((l) => !s.order.includes(l));
  return { ...s, cand: null, pair: null, done: true, result: [...s.order, ...tail] };
}

// Insert the current candidate at `pos`, spill anything past the top-3 into the
// tail, then move on (respecting the question cap).
function placeAndAdvance(s, pos) {
  const cand = s.cand;
  const order = [...s.order];
  order.splice(pos, 0, cand);
  let rest = s.rest;
  if (order.length > 3) rest = [...rest, order.pop()];
  const ns = { ...s, order, rest, cand: null, pair: null };
  return ns.asked >= PAIRWISE_CAP ? finalizePairwise(ns) : advancePairwise(ns);
}

// Fresh pairwise state, seeded from prior weights and ready to ask its first pair.
export function initPairwise(weights) {
  const seedOrder = seedPriorities(weights);
  const state = {
    seedOrder,
    order: [seedOrder[0]], // top seed seats for free
    queue: seedOrder.slice(1),
    rest: [],
    cand: null,
    idx: 0,
    asked: 0,
    done: false,
    result: null,
    pair: null,
    stepKey: "",
  };
  return advancePairwise(state);
}

// Advance the state by one answered comparison. `winner` is the chosen label.
export function pairwiseStep(state, winner) {
  if (!state || state.done) return state;
  const s = { ...state, asked: state.asked + 1 };
  if (winner === s.cand) {
    // Candidate climbs; if it beat the #1 slot it lands on top, else ask the
    // next-higher matchup.
    const idx = s.idx - 1;
    if (idx === 0) return placeAndAdvance(s, 0);
    return { ...s, idx, pair: [s.cand, s.order[idx - 1]], stepKey: `${s.asked}` };
  }
  // Candidate lost — it belongs at the current boundary (or out of the top-3).
  return placeAndAdvance(s, s.idx);
}

// Seed the pairwise state the moment `priorities` becomes the next question and
// no state exists yet — done here (inside applyAnswer) because this is where the
// up-to-date weights are available.
function maybeSeedPairwise(prefs, weights) {
  if (prefs._pairwise) return;
  if (isAnswered(QUESTION_BY_ID.priorities, prefs)) return;
  const next = QUESTION_PLAN.find((q) => !isAnswered(q, prefs));
  if (next?.id === "priorities") prefs._pairwise = initPairwise(weights);
}

// Build the wire descriptor for a question (sent to the client / stored on the
// assistant message). Interpolates {{name}} and attaches kind-specific meta.
export function describeQuestion(question, preferences) {
  const p = preferences ?? {};
  const prompt = question.prompt.replace("{{name}}", p.name || "there");
  const meta = {};
  if (question.kind === "confirm_or_replace") meta.currentName = p.name || "";
  if (question.kind === "budget_max") meta.maxLabel = question.maxLabel;
  if (question.kind === "month_select") meta.others = question.others ?? [];
  if (question.kind === "open_text") meta.placeholder = question.placeholder ?? "";
  // Pairwise renders the CURRENT A-vs-B pair, not the full option list. stepKey
  // makes each pair distinct so the client doesn't dedupe consecutive comparisons.
  if (question.kind === "pairwise_rank") {
    const pw = p._pairwise;
    return {
      id: question.id,
      field: question.field,
      kind: "pairwise",
      prompt: "Which matters more?",
      options: pw?.pair ?? [],
      meta: { stepKey: pw?.stepKey ?? "", allowUnsure: true },
    };
  }
  if (question.allowUnsure) meta.allowUnsure = true;
  return {
    id: question.id,
    field: question.field,
    kind: question.kind,
    prompt,
    options: question.options ?? null,
    meta,
  };
}

// First unanswered question (descriptor), or null when the script is complete.
export function nextQuestion(preferences) {
  const q = QUESTION_PLAN.find((question) => !isAnswered(question, preferences));
  return q ? describeQuestion(q, preferences) : null;
}

// Assistant message carrying a question, ready to push into the transcript.
export function buildQuestionMessage(question, preferences) {
  const descriptor = describeQuestion(question, preferences);
  return {
    role: "assistant",
    content: descriptor.prompt,
    ts: new Date().toISOString(),
    question: descriptor,
  };
}

function bumpWeight(weights, key, amount) {
  weights[key] = Math.max(weights[key] ?? 0, amount);
}

// Apply a structured answer to preferences + weights. Returns NEW objects plus
// change flags. `answer` = { questionId, field, kind, value }.
export function applyAnswer(preferences, weights, answer) {
  const prefs = { ...(preferences ?? {}) };
  const w = { ...(weights ?? {}) };
  const { kind, field, value } = answer;
  const unsure = value === UNSURE;

  switch (kind) {
    case "confirm_or_replace":
      prefs.name = value;
      prefs._name_confirmed = true;
      break;
    case "budget_max":
      if (unsure) {
        prefs.budget_max = null;
        prefs._budget_unsure = true; // no budget cap downstream
      } else if (value !== "" && value != null) {
        prefs.budget_max = Number(value);
        delete prefs._budget_unsure;
      }
      break;
    case "open_text":
      prefs.notes = unsure ? "" : value;
      prefs._extras_done = true;
      break;
    case "multi":
      prefs[field] = unsure ? ["No preference"] : Array.isArray(value) ? value : [value];
      break;
    case "rank":
      if (unsure) {
        prefs[field] = [];
        prefs._priorities_unsure = true; // no ranking → equal weighting
      } else {
        prefs[field] = Array.isArray(value) ? value : [value];
        delete prefs._priorities_unsure;
      }
      break;
    case "pairwise": {
      // One A-vs-B comparison. Mid-flow we only advance the state; weights are
      // applied (via RANK_BUMPS) once the full order is locked.
      if (unsure) {
        prefs.priorities = [];
        prefs._priorities_unsure = true;
        if (prefs._pairwise) prefs._pairwise = { ...prefs._pairwise, done: true, pair: null };
        break;
      }
      if (!prefs._pairwise) break;
      const ns = pairwiseStep(prefs._pairwise, value);
      prefs._pairwise = ns;
      if (ns.done && Array.isArray(ns.result)) {
        prefs.priorities = ns.result;
        delete prefs._priorities_unsure;
        ns.result.forEach((label, i) => {
          const bump = RANK_BUMPS[i] ?? RANK_BUMPS[RANK_BUMPS.length - 1];
          for (const key of PRIORITY_WEIGHTS[label] ?? []) bumpWeight(w, key, bump);
        });
      }
      break;
    }
    default: // choice, yesno_pref, month_select
      prefs[field] = unsure ? "No preference" : value;
  }

  // "Unsure" answers impose no constraint and add no weight.
  if (!unsure) {
    const direct = WEIGHT_MAP[answer.questionId];
    if (direct) {
      for (const [key, amount] of Object.entries(direct)) bumpWeight(w, key, amount);
    }
    // Priorities ranking: top-ranked items get the biggest weight bump.
    if (answer.questionId === "priorities" && Array.isArray(value)) {
      value.forEach((label, i) => {
        const bump = RANK_BUMPS[i] ?? RANK_BUMPS[RANK_BUMPS.length - 1];
        for (const key of PRIORITY_WEIGHTS[label] ?? []) bumpWeight(w, key, bump);
      });
    }
  }

  // Seed the pairwise flow the instant `priorities` becomes the next question.
  maybeSeedPairwise(prefs, w);

  const weightsChanged = JSON.stringify(w) !== JSON.stringify(weights ?? {});
  return { preferences: prefs, weights: w, prefsChanged: true, weightsChanged };
}

// Reconstruct the structured answer for an already-answered question from the
// stored preferences (used to replay earlier answers when rewinding).
function reconstructAnswer(q, p) {
  const base = { questionId: q.id, field: q.field, kind: q.kind };
  switch (q.id) {
    case "name_confirm":
      return { ...base, value: p.name };
    case "budget":
      return { ...base, value: p._budget_unsure ? UNSURE : p.budget_max };
    case "priorities":
      // Replay as a plain rank from the stored order so RANK_BUMPS weights
      // rebuild deterministically (the live flow's pairwise state isn't needed
      // once a final order exists).
      return { ...base, kind: "rank", value: p._priorities_unsure ? UNSURE : p.priorities ?? [] };
    case "extras":
      return { ...base, value: p._extras_done ? p.notes || UNSURE : null };
    default: {
      const v = p[q.field];
      // A stored "No preference" replays as unsure (no constraint, no weight).
      if (v === "No preference" || (Array.isArray(v) && v.length === 1 && v[0] === "No preference")) {
        return { ...base, value: UNSURE };
      }
      return { ...base, value: v };
    }
  }
}

// Rebuild preferences + weights as if only the questions BEFORE `questionId`
// had been answered — i.e. rewind the flow to re-ask from that question.
export function rewindTo(preferences, questionId) {
  const idx = QUESTION_PLAN.findIndex((q) => q.id === questionId);
  if (idx < 0) return { preferences: { ...(preferences ?? {}) }, weights: {} };
  let prefs = preferences?.name != null ? { name: preferences.name } : {};
  let weights = {};
  for (let i = 0; i < idx; i++) {
    const q = QUESTION_PLAN[i];
    if (!isAnswered(q, preferences)) continue;
    const ans = reconstructAnswer(q, preferences);
    if (!ans || ans.value == null) continue;
    const applied = applyAnswer(prefs, weights, ans);
    prefs = applied.preferences;
    weights = applied.weights;
  }
  return { preferences: prefs, weights };
}

// Rebuild preferences + weights from scratch by replaying every answered
// question. Used when an answer is edited outside the flow (e.g. reordering
// priorities in the panel): because weight bumps are monotonic (max), lowering
// a dimension requires recomputing the whole stack, not patching in place.
export function recomputeFromPreferences(preferences) {
  const p = preferences ?? {};
  let prefs = p.name != null ? { name: p.name } : {};
  let weights = {};
  for (const q of QUESTION_PLAN) {
    if (!isAnswered(q, p)) continue;
    const ans = reconstructAnswer(q, p);
    if (!ans || ans.value == null) continue;
    const applied = applyAnswer(prefs, weights, ans);
    prefs = applied.preferences;
    weights = applied.weights;
  }
  return { preferences: prefs, weights };
}

// Human-readable rendering of an answer, for the user's chat bubble.
export function answerToLabel(answer) {
  const { kind, value } = answer;
  if (kind === "pairwise") return value === UNSURE ? "No strong preference" : String(value);
  if (value === UNSURE) return kind === "open_text" ? "Nothing else" : "Not sure";
  if (kind === "budget_max") return value ? `$${value}/mo max` : "No budget set";
  if (kind === "open_text") return value || "Nothing else";
  if (kind === "rank" && Array.isArray(value)) {
    return value.map((v, i) => `${i + 1}. ${v}`).join("  ·  ");
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}
