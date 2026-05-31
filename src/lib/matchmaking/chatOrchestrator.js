import Anthropic from "@anthropic-ai/sdk";
import supabase from "@/lib/supabase";
import { rankListings } from "./listingFilter";
import { QUESTION_BY_ID } from "./questionScript";
import {
  nextQuestion,
  applyAnswer,
  buildQuestionMessage,
  answerToLabel,
} from "./questionEngine";

// The question flow is fully deterministic (see questionEngine). The ONLY LLM
// here is a fast Haiku call used to parse a free-text reply when the user types
// instead of tapping a chip — "light AI polish", never on the common path.
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// Weight dimension → recommendation intention label (must match the labels
// RecommendationCards knows, see RecommendationCards.js INTENTION_COLORS).
const DIMENSION_TO_INTENTION = {
  location: "Closest to campus",
  walkability: "Closest to campus",
  budget: "Best value",
  value: "Best value",
  reviews: "Best reviews",
  amenities: "Most amenities",
  lease_flexibility: "Most flexible lease",
  social: "Best social fit",
  group_fit: "Best social fit",
};

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// Claude Haiku 4.5 pricing (USD per token). All matchmaking LLM calls use Haiku.
const HAIKU_PRICE = {
  input: 1.0 / 1e6,
  output: 5.0 / 1e6,
  cacheRead: 0.1 / 1e6,
  cacheWrite: 1.25 / 1e6,
};

// Accumulate token usage for the whole conversation on the session (hidden _usage).
function addUsage(session, usage) {
  if (!usage) return;
  const u = session.preferences._usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  u.input += usage.input_tokens ?? 0;
  u.output += usage.output_tokens ?? 0;
  u.cacheRead += usage.cache_read_input_tokens ?? 0;
  u.cacheWrite += usage.cache_creation_input_tokens ?? 0;
  session.preferences._usage = u;
}

function logConversationCost(session) {
  const u = session.preferences?._usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const cost =
    u.input * HAIKU_PRICE.input +
    u.output * HAIKU_PRICE.output +
    u.cacheRead * HAIKU_PRICE.cacheRead +
    u.cacheWrite * HAIKU_PRICE.cacheWrite;
  console.log(
    `[matchmaking] conversation ${session.id} cost $${cost.toFixed(4)} ` +
      `(in:${u.input} out:${u.output} cacheRead:${u.cacheRead} cacheWrite:${u.cacheWrite})`
  );
}

// Pick exactly 3 intentions deterministically: "Best overall match" + the top-2
// weighted dimensions, de-duped, with sensible fallbacks.
function pickIntentions(weights) {
  const sorted = Object.entries(weights ?? {})
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);
  const intentions = ["Best overall match"];
  for (const [dim] of sorted) {
    const label = DIMENSION_TO_INTENTION[dim];
    if (label && !intentions.includes(label)) intentions.push(label);
    if (intentions.length === 3) break;
  }
  for (const fallback of ["Best value", "Closest to campus", "Best reviews"]) {
    if (intentions.length === 3) break;
    if (!intentions.includes(fallback)) intentions.push(fallback);
  }
  return intentions.slice(0, 3);
}

const PARSE_SYSTEM = `You convert a user's free-text reply into a structured value for ONE housing-preference question on a WashU off-campus housing app. Respond with JSON only: {"value": <value>}.
Rules by question kind:
- choice / yesno_pref: value is exactly one of the given options (verbatim).
- multi: value is an array of options the user picked (verbatim, subset of options).
- rank: value is the full array of options ordered most-important first (verbatim).
- budget_max: value is a single number — the max monthly rent per person in dollars.
- confirm_or_replace: value is the name string the user wants to be called.
If the reply does not actually answer the question, respond {"value": null}.`;

// Single fast Haiku call to map free text onto the current question's value.
async function parseFreeText(message, question) {
  if (!question) return null;
  try {
    const response = await getClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 256,
      system: [{ type: "text", text: PARSE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            question: { kind: question.kind, prompt: question.prompt, options: question.options },
            reply: message,
          }),
        },
      ],
    });
    const raw = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    const parsed = JSON.parse(jsonText);
    return { value: parsed?.value ?? null, usage: response.usage };
  } catch (err) {
    console.error("[chatOrchestrator] parseFreeText failed:", err);
    return { value: null, usage: null };
  }
}

const REFINE_SYSTEM = `The user already received 3 housing recommendations and wants to adjust them. Given their message plus current preferences and weights, output JSON ONLY:
{"reply": "<one short, friendly sentence>", "preferences": { ...only keys to change... }, "weights": { ...only dimensions to change, each 0..1... }}
Preference keys you may set: budget_max (number), area (array of neighborhoods), group_size, furnished ("Yes"|"No"|"No preference"), lease_term, move_in_month.
Weight dimensions: budget, location, value, reviews, amenities, walkability, lease_flexibility, social, group_fit. Raise toward 1 to emphasize, lower toward 0 to de-emphasize.
Guidance: "cheaper"/"too expensive" -> raise value+budget weights (and/or lower budget_max); "closer to campus" -> raise walkability+location; "nicer"/"more amenities" -> raise amenities; "better reviews" -> raise reviews. If nothing actionable, return empty preferences and weights with a brief acknowledging reply.`;

// Interpret a post-recommendation refinement request into pref/weight changes.
async function interpretRefinement(session, message) {
  try {
    const response = await getClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 300,
      system: [{ type: "text", text: REFINE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            message,
            preferences: session.preferences,
            weights: session.weights,
          }),
        },
      ],
    });
    const raw = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    const parsed = JSON.parse(jsonText);
    return {
      reply: typeof parsed.reply === "string" ? parsed.reply : "Updated your matches.",
      preferences: parsed.preferences && typeof parsed.preferences === "object" ? parsed.preferences : {},
      weights: parsed.weights && typeof parsed.weights === "object" ? parsed.weights : {},
      usage: response.usage,
    };
  } catch (err) {
    console.error("[chatOrchestrator] interpretRefinement failed:", err);
    return { reply: "Here are some updated options.", preferences: {}, weights: {}, usage: null };
  }
}

async function persistSession(session) {
  const { error } = await supabase
    .from("matchmaking_chat_sessions")
    .upsert(
      {
        id: session.id,
        user_id: session.user_id,
        status: session.status,
        transcript: session.transcript,
        preferences: session.preferences,
        weights: session.weights,
        candidates: session.candidates,
        recommendations: session.recommendations,
      },
      { onConflict: "id" }
    );
  if (error) throw new Error(`[chatOrchestrator] Failed to persist session: ${error.message}`);
}

// Deterministic turn. `answer` = structured chip answer; `message` = legacy
// free-text (parsed via Haiku). With neither, this is an init turn that just
// emits the first question.
async function rankTop3(session) {
  const intentions = pickIntentions(session.weights);
  try {
    const { ranked, usage } = await rankListings({
      preferences: session.preferences,
      weights: session.weights,
      requestedIntentions: intentions,
      limit: 3,
    });
    addUsage(session, usage);
    session.recommendations = ranked.slice(0, 3);
  } catch (err) {
    console.error("[chatOrchestrator] rankTop3 failed:", err);
    session.recommendations = [];
  }
}

export async function handleTurn({ session, answer = null, message = "", preferences = null, weights = null }) {
  // Adopt the client's authoritative snapshot when provided, preserving the
  // server-only cumulative usage tally (the client never sends it back).
  if (preferences) {
    const prevUsage = session.preferences?._usage;
    session.preferences = prevUsage ? { ...preferences, _usage: prevUsage } : { ...preferences };
  }
  if (weights) session.weights = weights;

  // Refine path: recommendations already exist and the user typed a tweak.
  if (message && session.status === "recommendations_ready") {
    session.transcript.push({ role: "user", content: message, ts: new Date().toISOString() });
    const { reply, preferences: prefPatch, weights: weightPatch, usage } = await interpretRefinement(session, message);
    addUsage(session, usage);
    session.preferences = { ...session.preferences, ...prefPatch };
    session.weights = { ...session.weights, ...weightPatch };
    await rankTop3(session);
    logConversationCost(session);
    session.transcript.push({
      role: "assistant",
      content: reply,
      ts: new Date().toISOString(),
      recommendations: session.recommendations,
    });
    await persistSession(session);
    return {
      session,
      nextQuestion: null,
      assistantMessage: reply,
      recommendations: session.recommendations,
    };
  }

  // The question currently awaiting a reply (computed before we apply anything).
  const current = nextQuestion(session.preferences);

  let effectiveAnswer = answer;

  // Free-text fallback path.
  if (!effectiveAnswer && message && current) {
    const { value, usage } = await parseFreeText(message, current);
    addUsage(session, usage);
    effectiveAnswer = {
      questionId: current.id,
      field: current.field,
      kind: current.kind,
      // If Haiku couldn't parse, stash the raw text so the flow still advances.
      value: value ?? message,
    };
  }

  if (effectiveAnswer) {
    session.transcript.push({
      role: "user",
      content: answerToLabel(effectiveAnswer),
      ts: new Date().toISOString(),
    });
    // Chip path: snapshot already adopted above. Free-text path: apply the
    // parsed answer onto the current (snapshot) preferences.
    if (!(answer && preferences)) {
      const applied = applyAnswer(session.preferences, session.weights, effectiveAnswer);
      session.preferences = applied.preferences;
      session.weights = applied.weights;
    }
  }

  const upcoming = nextQuestion(session.preferences);

  if (upcoming) {
    session.transcript.push(buildQuestionMessage(QUESTION_BY_ID[upcoming.id], session.preferences));
    await persistSession(session);
    return { session, nextQuestion: upcoming, assistantMessage: upcoming.prompt };
  }

  // Script complete — rank the three recommendations (the only slow step).
  await rankTop3(session);
  logConversationCost(session);
  session.status = "recommendations_ready";

  const closing =
    "All set — here are your top three matches. Want to tweak anything? Just tell me (e.g. “cheaper” or “closer to campus”).";
  session.transcript.push({
    role: "assistant",
    content: closing,
    ts: new Date().toISOString(),
    recommendations: session.recommendations,
  });

  await persistSession(session);
  return {
    session,
    nextQuestion: null,
    assistantMessage: closing,
    recommendations: session.recommendations,
  };
}
