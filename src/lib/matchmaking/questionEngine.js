// Pure, deterministic question-flow engine. NO supabase / Anthropic imports —
// this module is imported on both the server (chatOrchestrator, route) and the
// client (ChatClient) so the next question can render instantly with no round-trip.
import {
  QUESTION_PLAN,
  WEIGHT_MAP,
  PRIORITY_WEIGHTS,
  RANK_BUMPS,
  UNSURE,
  isAnswered,
} from "./questionScript";

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
      return { ...base, value: p._priorities_unsure ? UNSURE : p.priorities ?? [] };
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

// Human-readable rendering of an answer, for the user's chat bubble.
export function answerToLabel(answer) {
  const { kind, value } = answer;
  if (value === UNSURE) return kind === "open_text" ? "Nothing else" : "Not sure";
  if (kind === "budget_max") return value ? `$${value}/mo max` : "No budget set";
  if (kind === "open_text") return value || "Nothing else";
  if (kind === "rank" && Array.isArray(value)) {
    return value.map((v, i) => `${i + 1}. ${v}`).join("  ·  ");
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}
