import Anthropic from "@anthropic-ai/sdk";
import supabase from "@/lib/supabase";
import { rankListings } from "./listingFilter";
import { buildNarrowingTurn, applyTradeoffChoice } from "./narrowing";
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
  if (!_client) _client = new Anthropic({ apiKey: process.env.PROXY_CHAT_KEY });
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

const REFINE_SYSTEM = `You are Proxy, a housing matchmaker for WashU students. Your personality is playful but serious: warm and a little fun, never silly, and always genuinely helpful. Always write the "reply" in correct, grammatical English with proper spelling, punctuation, and capitalization.
The user already received 3 housing recommendations and wants to adjust them. You are given their message, current preferences and weights, and shownListings — the listings they're looking at right now, each {id, title, perPerson, amenities}. Output JSON ONLY:
{"reply": "<one short, friendly sentence>", "preferences": { ...only keys to change... }, "weights": { ...only dimensions to change, each 0..1... }, "exclude": [ ...listing ids to never show again... ]}
Preference keys you may set: budget_max (number), area (array of neighborhoods), group_size (number of people to live with, including them), furnished ("Yes"|"No"|"No preference"), lease_term, move_in_month, proximity_targets (array; allowed values: "campus", "med_campus", "grocery"), exclude_subleases (boolean).
Weight dimensions: budget, location, value, reviews, amenities, walkability, lease_flexibility, social, group_fit, neighborhood. Raise toward 1 to emphasize, lower toward 0 to de-emphasize.
Referencing a listing they were shown — match the name in their message to a shownListings entry by title (case-insensitive, partial match is fine) and use its id:
- "not <name>" / "anything but <name>" / "something other than <name>" / "don't show me <name>" -> add that id to exclude.
- "not as expensive as <name>" / "cheaper than <name>" / "less than <name>" -> add that id to exclude AND set budget_max to a round number just below that listing's perPerson.
Guidance: "cheaper"/"too expensive" -> raise value+budget weights (and/or lower budget_max); "fit more people"/"bigger"/"more roommates"/"a larger group" -> raise group_size to the number implied and never below the current value; "closer to campus" -> proximity_targets ["campus"] + raise walkability+location; "close to the med campus / medical school" -> proximity_targets ["med_campus"] + raise walkability; "close to groceries / Schnucks" -> proximity_targets ["grocery"] + raise walkability; "in/near a neighborhood (The Loop / Central West End / Clayton / DeMun / DeBaliviere)" -> set area [that neighborhood] + raise neighborhood toward 1; "nicer"/"more amenities" -> raise amenities; "better reviews" -> raise reviews; "no sublease(s)"/"not a sublease"/"don't want a sublease"/"no subletting"/"I want a real/full lease" -> set exclude_subleases true (and "subleases are fine"/"open to a sublease" -> exclude_subleases false). Preserve any existing proximity_targets the user still wants. If nothing actionable, return empty preferences, weights, and exclude with a brief acknowledging reply.
Never use em dashes (—) in the reply. Use commas, periods, or parentheses instead.`;

// Interpret a post-recommendation refinement request into pref/weight changes.
async function interpretRefinement(session, message) {
  // The listings the user is currently looking at, so the model can resolve
  // references like "not as expensive as LOCAL" to a real listing + price.
  const shownListings = (session.recommendations ?? []).map((r) => ({
    id: r.listing_id,
    title: r.card_data?.title ?? null,
    perPerson: r.card_data?.min_rent ?? null,
    amenities: r.card_data?.top_amenities ?? [],
  }));
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
            shownListings,
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
      exclude: Array.isArray(parsed.exclude) ? parsed.exclude : [],
      usage: response.usage,
    };
  } catch (err) {
    console.error("[chatOrchestrator] interpretRefinement failed:", err);
    return { reply: "Here are some updated options.", preferences: {}, weights: {}, exclude: [], usage: null };
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
    const { ranked, usage, groupNote, budgetNote } = await rankListings({
      preferences: session.preferences,
      weights: session.weights,
      requestedIntentions: intentions,
      limit: 3,
    });
    addUsage(session, usage);
    session.recommendations = ranked.slice(0, 3);
    // Transient (not DB columns) — read within this turn to flag budget/group fit.
    session._groupNote = groupNote ?? null;
    session._budgetNote = budgetNote ?? null;
  } catch (err) {
    console.error("[chatOrchestrator] rankTop3 failed:", err);
    session.recommendations = [];
    session._groupNote = null;
    session._budgetNote = null;
  }
}

// Append the honest budget/group-fit notes (if any) to an assistant message.
function withNotes(text, session) {
  const notes = [session._budgetNote, session._groupNote].filter(Boolean);
  return notes.length ? `${text}\n\n${notes.join("\n\n")}` : text;
}

// Finalize: rank the deterministic top 3, mark the session done, push the
// closing message, persist, and return the turn payload.
async function finalizeRecommendations(session) {
  await rankTop3(session);
  logConversationCost(session);
  session.status = "recommendations_ready";
  const closing = withNotes(
    "All set. Here are your top three matches. Want to tweak anything? Just tell me (e.g. “cheaper” or “closer to campus”).",
    session
  );
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

// The narrowing phase: after the scripted questions, if more than 3 listings
// still fit, ask a listing-aware "Would you X for Y?" tradeoff question;
// otherwise finalize the top 3. Each tradeoff answer re-enters here.
async function runNarrowing(session) {
  let turn;
  try {
    turn = await buildNarrowingTurn(session);
    addUsage(session, turn.usage);
  } catch (err) {
    console.error("[chatOrchestrator] runNarrowing failed:", err);
    return finalizeRecommendations(session);
  }

  if (turn.kind === "tradeoff" && turn.question) {
    // Stash the server-only id mapping so the next turn can prune the loser.
    session.preferences._pendingTradeoff = turn.serverOptions;
    session.transcript.push({
      role: "assistant",
      content: turn.question.prompt,
      ts: new Date().toISOString(),
      question: turn.question,
    });
    await persistSession(session);
    return {
      session,
      nextQuestion: turn.question,
      assistantMessage: turn.question.prompt,
      recommendations: session.recommendations ?? [],
    };
  }

  return finalizeRecommendations(session);
}

// Re-rank the top 3 from a given prefs/weights snapshot (used by the panel's
// live priority-reorder, which re-ranks immediately when picks already exist).
export async function computeRecommendations(preferences, weights) {
  const intentions = pickIntentions(weights);
  const { ranked } = await rankListings({
    preferences,
    weights,
    requestedIntentions: intentions,
    limit: 3,
  });
  return ranked.slice(0, 3);
}

export async function handleTurn({ session, answer = null, message = "", preferences = null, weights = null, tradeoff = null }) {
  // Adopt the client's authoritative snapshot when provided, preserving the
  // server-only cumulative usage tally (the client never sends it back).
  if (preferences) {
    // Carry server-only hidden keys the client doesn't manage: the cumulative
    // usage tally, the persistent rejected-listing set, and the narrowing-phase
    // state (pending tradeoff + how many we've asked + their history). The DB
    // copy is authoritative for these, so they always override the client echo.
    const prev = session.preferences ?? {};
    const carried = {};
    for (const k of ["_usage", "_excluded", "_pendingTradeoff", "_tradeoffCount", "_tradeoffHistory", "_viewerGender"]) {
      if (prev[k] !== undefined) carried[k] = prev[k];
    }
    session.preferences = { ...preferences, ...carried };
  }
  if (weights) session.weights = weights;

  // Narrowing path: the user answered a "Would you X for Y?" tradeoff. Prune the
  // losing side, then ask the next tradeoff (or finalize if ≤3 / cap reached).
  if (tradeoff) {
    const chosen = tradeoff.chosen ?? "";
    session.transcript.push({ role: "user", content: String(chosen), ts: new Date().toISOString() });
    session.preferences = applyTradeoffChoice(session.preferences, chosen);
    return runNarrowing(session);
  }

  // Refine path: recommendations already exist and the user typed a tweak.
  if (message && session.status === "recommendations_ready") {
    session.transcript.push({ role: "user", content: message, ts: new Date().toISOString() });
    const { reply, preferences: prefPatch, weights: weightPatch, exclude, usage } = await interpretRefinement(session, message);
    addUsage(session, usage);
    session.preferences = { ...session.preferences, ...prefPatch };
    session.weights = { ...session.weights, ...weightPatch };
    // Add any listings the user rejected to the persistent exclude set, resolving
    // the model's references (an id, or a title it matched) back to listing ids
    // using the cards the user was just shown.
    if (Array.isArray(exclude) && exclude.length) {
      const shown = session.recommendations ?? [];
      const resolveId = (ref) => {
        const s = String(ref).toLowerCase();
        if (shown.some((r) => r.listing_id === ref)) return ref;
        const byTitle = shown.find((r) => {
          const t = (r.card_data?.title ?? "").toLowerCase();
          return t && (t === s || t.includes(s) || s.includes(t));
        });
        return byTitle?.listing_id ?? null;
      };
      const ids = exclude.map(resolveId).filter(Boolean);
      const prevExcluded = session.preferences._excluded ?? [];
      session.preferences._excluded = [...new Set([...prevExcluded, ...ids])];
    }
    await rankTop3(session);
    logConversationCost(session);
    const refineReply = withNotes(reply, session);
    session.transcript.push({
      role: "assistant",
      content: refineReply,
      ts: new Date().toISOString(),
      recommendations: session.recommendations,
    });
    await persistSession(session);
    return {
      session,
      nextQuestion: null,
      assistantMessage: refineReply,
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

  // Scripted questions complete — enter the narrowing phase (tradeoff questions
  // when >3 listings still fit), which finalizes the top 3 when it's done.
  return runNarrowing(session);
}
