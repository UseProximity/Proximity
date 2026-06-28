import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { fetchActiveListings, filterEligible, slimCandidate } from "./listingFilter";

// After the scripted questions, if MORE than three listings still fit the
// student, Proxy narrows the field with listing-aware "Would you X for Y?"
// tradeoff questions — each generated from the REAL differences among the
// candidates (price vs furnished, closer-but-pricier vs farther-but-cheaper,
// near-a-shuttle vs a short walk, …). Answering one prunes the losing side from
// the pool; we ask at most MAX_TRADEOFFS before handing off to the deterministic
// top-3 ranking. This is the one place we let the LLM both phrase the question
// AND choose the split, so the language stays organic and grounded in the data.
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const MAX_TRADEOFFS = 3;

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

const TradeoffSchema = z.object({
  question: z.string().min(1),
  optionA: z.object({ label: z.string().min(1), idx: z.array(z.number()) }),
  optionB: z.object({ label: z.string().min(1), idx: z.array(z.number()) }),
});

const NARROW_SYSTEM = `You are Proxy, a housing matchmaker for WashU (Washington University in St. Louis) students. Your personality is playful but serious: warm and a little fun, never silly, and always genuinely helpful. Always write in correct, grammatical English with proper spelling, punctuation, and capitalization. The student has answered preference questions and several listings still fit them. Ask ONE short either/or question that splits the remaining listings into two genuinely appealing groups along a REAL tradeoff in the data, so we can narrow toward their favorites.

You are given:
- preferences and weights (what they told us they care about)
- candidates: the listings still in play, each { idx, title, per_person_rent, furnished, avg_review, amenities, bedrooms_max, lease_term_months, walk_to_campus_min, walk_to_shuttle_min, walk_to_med_campus_min, walk_to_grocery_min }. "idx" is a small integer id for the listing. A field may be null (unknown); never assert it.
- askedAngles: tradeoffs you've already asked. Pick a DIFFERENT angle.

Find the most decision-relevant axis where these listings actually differ, then phrase a natural "Would you X for Y?"-style question using REAL numbers from the candidates (e.g. the typical price gap between the furnished and unfurnished ones, or the extra walking minutes for the cheaper cluster). Examples of the FEEL (do not copy verbatim): "Would you pay about $250 more a month for a furnished place?", "Would you be okay being about 12 minutes farther from campus if it means a lower rent and a shuttle stop nearby?", "Is it worth a bit more for the places with standout reviews?"

Partition the candidates by their idx: optionA.idx are the listings that fit one answer, optionB.idx the other. Output JSON ONLY, no markdown:
{"question":"<one friendly sentence>","optionA":{"label":"<short, human answer chip>","idx":[1,2]},"optionB":{"label":"<short, human answer chip>","idx":[3,4]}}

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

    const labelA = parsed.data.optionA.label.trim();
    const labelB = parsed.data.optionB.label.trim();
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
      usage: response.usage,
    };
  } catch (err) {
    console.error("[narrowing] generateTradeoff failed:", err);
    return { question: null, usage: null };
  }
}

// Decide the next step after the scripted questions: either a tradeoff question
// (when >3 candidates remain and we're under the cap) or a signal to finalize.
// Pure-ish: fetches listings + may call Haiku, but mutates nothing.
export async function buildNarrowingTurn(session) {
  const prefs = session.preferences ?? {};
  const eligible = filterEligible(await fetchActiveListings(), prefs);
  const asked = prefs._tradeoffCount ?? 0;

  if (eligible.length <= 3 || asked >= MAX_TRADEOFFS) {
    return { kind: "final", count: eligible.length, usage: null };
  }

  const candidates = eligible.slice(0, POOL_CAP).map((e) => slimCandidate(e.listing));
  const { question, serverOptions, usage } = await generateTradeoff(
    candidates,
    prefs,
    session.weights ?? {},
    prefs._tradeoffHistory ?? []
  );
  if (!question) return { kind: "final", count: eligible.length, usage };
  // stepKey makes each tradeoff distinct so the client never dedupes two
  // consecutive "tradeoff" questions as if they were the same prompt.
  question.meta.stepKey = String(asked);
  return { kind: "tradeoff", question, serverOptions, count: eligible.length, usage };
}

// Apply a student's tradeoff answer to the session preferences (in place):
// reject the losing side's listings, bump the count + history, clear the pending
// tradeoff. `chosen` is the label the student tapped.
export function applyTradeoffChoice(preferences, chosen) {
  const prefs = { ...(preferences ?? {}) };
  const pend = prefs._pendingTradeoff;
  if (pend?.options && typeof chosen === "string") {
    const labels = Object.keys(pend.options);
    if (labels.includes(chosen)) {
      const rejectIds = labels
        .filter((l) => l !== chosen)
        .flatMap((l) => pend.options[l] ?? []);
      prefs._excluded = [...new Set([...(prefs._excluded ?? []), ...rejectIds])];
    }
  }
  prefs._tradeoffCount = (prefs._tradeoffCount ?? 0) + 1;
  if (pend?.prompt) prefs._tradeoffHistory = [...(prefs._tradeoffHistory ?? []), pend.prompt];
  delete prefs._pendingTradeoff;
  return prefs;
}
