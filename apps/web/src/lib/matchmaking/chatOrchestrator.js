import Anthropic from "@anthropic-ai/sdk";
import supabase from "@/lib/supabase";
import { rankListings, filterEligible, fetchActiveListings, slimCandidate, extractCardData, buildRankContext } from "./listingFilter";
import { defaultInquiryNote } from "./contactNote";
import { buildNarrowingTurn, applyTradeoffChoice } from "./narrowing";
import { QUESTION_BY_ID } from "./questionScript";
import {
  nextQuestion,
  applyAnswer,
  buildQuestionMessage,
  answerToLabel,
} from "./questionEngine";

// ── THE FLOW (this file is the state machine; handleTurn at the bottom is the
// single entry point) ───────────────────────────────────────────────────────
//
//   1. SCRIPTED QUESTIONS — 12 fixed questions, ZERO LLM calls. The client
//      renders each as tappable controls and answers post back structured, so
//      nothing here has to interpret prose. See questionScript / questionEngine.
//   2. NARROWING — once the script is done, if >3 listings still fit, ask up to
//      MAX_TRADEOFFS listing-aware "Would you X for Y?" questions, then a
//      one-time commute check. LLM: narrowing.js (phrases + splits the pool).
//   3. RANKING — the deterministic top 3, explained. LLM: listingFilter.js
//      (picks/orders/writes the reasons, with code-enforced honesty guardrails).
//   4. CONVERSATION — after the matches exist, free-text turns go to the
//      tool-using agent below (AGENT_SYSTEM + AGENT_TOOLS), which can re-rank,
//      swap in specific listings, or open an email draft to an owner.
//
// Every LLM call is best-effort: a failure falls back to deterministic behavior
// rather than leaving the student stuck. All of them use Haiku.
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

// Belt-and-suspenders: the prompts forbid em dashes, but never let one reach the
// user. Collapse " — " to a comma and any stray em dash to a hyphen.
function stripEmDashes(s) {
  return typeof s === "string" ? s.replace(/\s*—\s*/g, ", ").replace(/—/g, "-") : s;
}

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

// ── Post-recommendation conversational agent ────────────────────────────────
// Once the 3 matches exist, free-text turns are handled by a tool-using agent
// (not a one-shot parse). It has the full transcript + the live matches as
// context, and can: re-rank the search, open an email draft to an owner, or just
// answer questions about the listings. This is what makes Proxy feel like a
// chatbot rather than a script.
const AGENT_SYSTEM = `You are Proxy, a warm, playful-but-serious housing matchmaker for WashU (Washington University in St. Louis) students. The student has already received their top 3 matches and is now chatting with you. You can see the whole conversation and their current matches.

What you can do:
- Answer questions about the matches using the data you are given (per-person rent, beds/baths, furnished, lease type, amenities, and the highlight note which often includes walk times). Be short and specific. If a detail truly isn't in your data, say so honestly and suggest opening the listing's page; never invent facts.
- See the whole market, not just the 3 matches: "market" in your data lists EVERY listing that currently fits the student's filters (budget, group size, lease, anything they've ruled out), and it refreshes whenever their preferences change. Use it to answer questions like "is there anything with a gym?", "what else is in the Loop?", or "anything cheaper than these?" by naming real listings with real facts from that data. If a listing is not in "market", it does not fit their current search: say so rather than inventing one, and offer to loosen a filter.
- Find them different or additional listings: re-rank at any time by calling update_search with ONLY the keys to change. Use preference keys for "cheaper", "closer to campus", "bigger group / more roommates", "no subleases", "change my budget to X", "I actually have 5 people". Put any NEW must-have or dealbreaker that fits no other key (a gym, parking, pet friendly, a specific street) in preferences.notes. Set fresh_options true when they ask for more, new, other, or different options. Use exclude for a specific listing they dislike. Every re-rank returns ONLY listings the student has not been shown before; their previous matches never reappear on the cards (they stay referenceable, and show_listings can bring a specific one back if they ask).
- Put specific listings on their cards: when the student asks to see particular places from the market (e.g. "show me that Kingsbury one" or "let me see those two with gyms"), call show_listings with those listings' exact titles from "market". This swaps their match cards to exactly those listings.
- Email an owner for them: when they ask you to email, contact, or reach out to a listing's owner, call open_contact_draft with that listing's title. You CAN do this — never say you can't contact landlords. The student reviews and edits the draft before it sends, and they are CC'd.

Rules:
- Only re-rank when the student actually wants different options. For a plain question, just answer — do not call update_search.
- After update_search, the new matches are always listings the student has NOT seen before. The tool result's previous_top names their earlier #1 match and whether it still scores as their best overall fit; when still_best_overall is true, tell them their earlier match is still their strongest overall fit and these three are fresh alternatives. Never present an old match as if it were a new find.
- Subleases: a listing IS a sublease only when its data says isSublease (matches) or is_sublease (market) is true, meaning the place is someone's existing lease being taken over. subleaseFriendly is a DIFFERENT thing: it means a tenant there would be allowed to sublet later. Never use subleaseFriendly to decide whether a place is a sublease. Subleases are already excluded from matches by default; only if the student explicitly asks to see subleases should you call update_search with exclude_subleases false. Even then, when the student has a lease term, only subleases whose posted description explicitly states a matching timeframe (like "summer sublet" or "June through August") are offered; if a sublease they expect is missing, explain its post does not state a timeframe matching their term.
- The 3 matches are numbered by "position" in the data (1 = first/top, 2 = second, 3 = third), in the exact order the student sees them. When they say "the first/second/third one", "the second", or "number 2", that means that POSITION. When they name a listing ("Five-Nine", "the Kingsbury place"), match it by title. In either case, when you call a tool, pass the listing's exact title OR its position number (1, 2, or 3) — for an ordinal reference, prefer passing the position number so there is no ambiguity.
- After you use a tool, briefly tell the student what you did, naming the listing the tool reported back (do not guess the name yourself).
- Never end the conversation or imply you are done helping. End every reply by leaving the door open and inviting a natural next step in their housing search (refine the matches, compare places, get more details on a listing, or have you reach out to an owner), worded for the moment rather than as a canned line.
- Reply in one to three short, friendly, grammatical sentences. Never use em dashes (—); use commas, periods, or parentheses.`;

const AGENT_TOOLS = [
  {
    name: "update_search",
    description:
      "Adjust the student's search and re-rank their top 3 matches. Use for cheaper/closer/bigger-group/no-subleases requests, budget or group-size edits, new must-haves, excluding a disliked listing, or surfacing fresh options beyond the current matches.",
    input_schema: {
      type: "object",
      properties: {
        preferences: {
          type: "object",
          description:
            "Only the preference keys to change. Allowed: budget_max (number, per-person monthly), area (array of neighborhoods like 'The Loop'), group_size (number of people incl. them), furnished ('Yes'|'No'|'No preference'), lease_term ('Semester only'|'Academic year'|'Full year only' — a summer sublet counts as 'Semester only'), move_in_month (string), proximity_targets (array of 'campus'|'med_campus'|'grocery'), exclude_subleases (boolean — defaults to true, subleases are hidden; set false ONLY when the student explicitly asks to see subleases), notes (string: ONLY the new must-have/dealbreaker to add, e.g. 'needs a gym'; it is appended to their existing notes).",
        },
        fresh_options: {
          type: "boolean",
          description:
            "Set true when the student asks for more/new/other/different options without changing any preference. (Every re-rank already shows only never-before-shown listings; set-aside listings are NOT rejected — they stay referenceable and show_listings can bring one back on request.)",
        },
        weights: {
          type: "object",
          description:
            "Only weight dimensions to change, each 0..1 (raise to emphasize). Dimensions: budget, location, value, reviews, amenities, walkability, lease_flexibility, social, group_fit, neighborhood.",
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description: "Shown listings to never show again — each the listing's exact title or its position number ('1', '2', '3').",
        },
      },
    },
  },
  {
    name: "show_listings",
    description:
      "Swap the student's match cards to specific listings from the `market` data (up to 3), e.g. when they ask to see a particular place you mentioned. For broad requests (cheaper, closer, more options) prefer update_search.",
    input_schema: {
      type: "object",
      properties: {
        listings: {
          type: "array",
          items: { type: "string" },
          description: "1-3 listings to show, each the exact title (or listing_id) of an entry in `market`.",
        },
        reason: {
          type: "string",
          description: "One short sentence, addressed to the student, on why these are worth a look.",
        },
      },
      required: ["listings"],
    },
  },
  {
    name: "open_contact_draft",
    description:
      "Open an editable email draft to the owner(s) of specific shown listings so the student can review and send it. Use whenever the student asks you to email, contact, or reach out to a listing's owner.",
    input_schema: {
      type: "object",
      properties: {
        listings: {
          type: "array",
          items: { type: "string" },
          description:
            "Which shown listings' owners to contact. Each item is the listing's exact title OR its position number ('1', '2', '3'). Use the position number for ordinal references like 'the third one'.",
        },
      },
      required: ["listings"],
    },
  },
];

// Ordinal / position words → 1-based index, so "the third one" resolves to match #3.
const ORDINAL_POS = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3 };
function refPosition(s) {
  for (const [word, pos] of Object.entries(ORDINAL_POS)) {
    if (new RegExp(`\\b${word}\\b`).test(s)) return pos;
  }
  // "number 2", "#3", or a bare "2" (1–3 only, to avoid matching street numbers).
  const m = s.match(/(?:^|#|\bnumber\s*|\boption\s*|\bmatch\s*)\s*([123])\b/);
  return m ? Number(m[1]) : null;
}

// Resolve a free-text listing reference to a shown listing id. Tries, in order:
// exact id, name match (title OR address), then ordinal/position ("the third", "#2").
function resolveShownId(session, ref) {
  const shown = session.recommendations ?? [];
  if (shown.some((r) => r.listing_id === ref)) return ref;
  const s = String(ref).toLowerCase().trim();
  const hit = shown.find((r) => {
    const t = (r.card_data?.title ?? "").toLowerCase();
    const a = (r.card_data?.address ?? "").toLowerCase();
    return (t && (t === s || t.includes(s) || s.includes(t))) || (a && s.length >= 3 && a.includes(s));
  });
  if (hit) return hit.listing_id;
  const pos = refPosition(s);
  if (pos && shown[pos - 1]) return shown[pos - 1].listing_id;
  return null;
}

// Richer per-listing facts for the 3 shown matches, so the agent can answer
// questions (furnished, lease, beds/baths, sublease) beyond what the card carries.
async function shownListingsContext(session) {
  const recs = session.recommendations ?? [];
  if (!recs.length) return [];
  let rows = {};
  try {
    const { data } = await supabase
      .from("listings")
      .select(
        "id, title, address, furnished, lease_type, lease_structure, min_bedrooms, max_bedrooms, min_bathrooms, max_bathrooms, sublease_friendly, listing_units!listing_id(unit_leases!unit_id(is_active, sublease))"
      )
      .in("id", recs.map((r) => r.listing_id));
    rows = Object.fromEntries((data ?? []).map((r) => [r.id, r]));
  } catch (err) {
    console.error("[chatOrchestrator] shownListingsContext failed:", err);
  }
  const range = (a, b) => (a == null ? null : a === b ? `${a}` : `${a}-${b}`);
  return recs.map((r, i) => {
    const row = rows[r.listing_id] ?? {};
    // A listing IS a sublease when its active leases are all sublease rows
    // (unit_leases.sublease, rent listed or not) — NOT when sublease_friendly is
    // set, which only means a tenant would be allowed to sublet.
    const activeLeases = (row.listing_units ?? []).flatMap((u) =>
      (u.unit_leases ?? []).filter((l) => l.is_active)
    );
    return {
      // 1-based position in the order shown, so "the first/second/third one" is unambiguous.
      position: i + 1,
      title: r.card_data?.title ?? row.title ?? null,
      tag: r.intention,
      address: r.card_data?.address ?? row.address ?? null,
      perPersonRent: r.card_data?.min_rent ?? null,
      amenities: r.card_data?.top_amenities ?? [],
      furnished: row.furnished ?? null,
      leaseType: row.lease_type ?? null,
      isSublease: activeLeases.length ? activeLeases.every((l) => !!l.sublease) : false,
      subleaseFriendly: row.sublease_friendly ?? null,
      bedrooms: range(row.min_bedrooms, row.max_bedrooms),
      bathrooms: range(row.min_bathrooms, row.max_bathrooms),
      highlight: r.reason ?? null,
    };
  });
}

// Proxy's knowledge base for the post-recommendation conversation: every active
// listing that fits the student's CURRENT filters (budget, group size, lease,
// gender restrictions, explicit dislikes), slimmed for the model. Re-derived from
// preferences on every turn, so when the search changes the catalog changes with
// it. Listings merely set aside by a "show me more" turn stay visible here — the
// student saw them, and only explicit dislikes are truly gone.
const MARKET_CATALOG_LIMIT = 60;
async function eligibleCatalog(session) {
  try {
    const prefs = { ...(session.preferences ?? {}), _setAside: [] };
    const eligible = filterEligible(await fetchActiveListings(), prefs);
    const shownIds = new Set((session.recommendations ?? []).map((r) => r.listing_id));
    return eligible.slice(0, MARKET_CATALOG_LIMIT).map(({ listing }) => {
      const slim = slimCandidate(listing);
      return shownIds.has(listing.id) ? { ...slim, currently_shown: true } : slim;
    });
  } catch (err) {
    console.error("[chatOrchestrator] eligibleCatalog failed:", err);
    return [];
  }
}

// Resolve a reference (exact id, or title/address text) against the eligible
// market catalog — NOT just the shown 3. Used by show_listings.
function resolveEligibleListing(eligible, ref) {
  const s = String(ref ?? "").toLowerCase().trim();
  if (!s) return null;
  return (
    eligible.find(({ listing }) => listing.id === ref) ??
    eligible.find(({ listing }) => {
      const t = (slimCandidate(listing).title ?? "").toLowerCase();
      const a = (listing.address ?? "").toLowerCase();
      return (t && (t === s || t.includes(s) || s.includes(t))) || (a && s.length >= 3 && a.includes(s));
    }) ??
    null
  );
}

// Run one tool call and mutate the session. Returns a compact result for the model.
async function runAgentTool(session, name, input) {
  if (name === "update_search") {
    // Snapshot so a fresh-options ask that finds NOTHING new can keep the current
    // matches on screen (and referenceable) instead of wiping them.
    const prevRecs = session.recommendations ?? [];
    const prevSetAside = session.preferences._setAside ?? [];
    const prefPatch = input?.preferences && typeof input.preferences === "object" ? { ...input.preferences } : {};
    const weightPatch = input?.weights && typeof input.weights === "object" ? input.weights : {};
    // Notes are cumulative must-haves: APPEND the new request so earlier ones
    // (from the question flow or prior turns) keep steering the ranking.
    if (typeof prefPatch.notes === "string") {
      const addition = prefPatch.notes.trim();
      const prev = (session.preferences.notes ?? "").toString().trim();
      if (!addition) delete prefPatch.notes;
      else if (prev && prev.toLowerCase().includes(addition.toLowerCase())) prefPatch.notes = prev;
      else prefPatch.notes = prev ? `${prev}. ${addition}` : addition;
    }
    session.preferences = { ...session.preferences, ...prefPatch };
    session.weights = { ...session.weights, ...weightPatch };
    // Never repeat: ANY refine (preference/weight change, "show me more", or an
    // exclude) folds the currently shown listings into the set-aside, so every
    // re-rank surfaces only listings the student hasn't been shown before. Only
    // the nothing-new fallback below ever puts a shown listing back on the cards.
    const shownNow = prevRecs.map((r) => r.listing_id).filter(Boolean);
    if (shownNow.length) {
      session.preferences._setAside = [...new Set([...(session.preferences._setAside ?? []), ...shownNow])];
    }
    if (Array.isArray(input?.exclude) && input.exclude.length) {
      const ids = input.exclude.map((ref) => resolveShownId(session, ref)).filter(Boolean);
      const prev = session.preferences._excluded ?? [];
      session.preferences._excluded = [...new Set([...prev, ...ids])];
    }
    await rankTop3(session);
    if (!(session.recommendations ?? []).length && prevRecs.length) {
      // Nothing NEW surfaced. Be honest about which case this is before keeping
      // their current cards: does ANYTHING fit these prefs, ignoring the
      // never-repeat set-aside?
      let anyFit = false;
      try {
        anyFit = filterEligible(await fetchActiveListings(), { ...session.preferences, _setAside: [] }).length > 0;
      } catch (err) {
        console.error("[chatOrchestrator] no-new-options check failed:", err);
      }
      session.recommendations = prevRecs;
      session.preferences._setAside = prevSetAside;
      return {
        ok: true,
        no_new_options: true,
        note: anyFit
          ? "They have already seen every listing that fits this search, so their current matches stay on screen. Tell them these remain the best fits on the market right now and suggest loosening a preference (budget, area, lease) to unlock more."
          : "No listing on the market fits the new constraints at all. Their current matches are kept on screen so they aren't left empty-handed; tell them plainly that nothing fits that ask and suggest what to loosen.",
      };
    }
    session._reranked = true;
    // Honest "your old #1 is still your best fit" signal: compare deterministic
    // fit scores over the UNRESTRICTED pool (old and new listings normalized
    // together), so the agent can truthfully say the earlier match still wins
    // overall even though the cards now show all-new places.
    let previousTop = null;
    if (prevRecs.length && (session.recommendations ?? []).length) {
      try {
        const ctx = buildRankContext(
          await fetchActiveListings(),
          { ...session.preferences, _setAside: [] },
          session.weights,
          3
        );
        const fitOf = (id) => ctx.fitById?.[id];
        const prevFit = fitOf(prevRecs[0]?.listing_id);
        const newBest = Math.max(...session.recommendations.map((r) => fitOf(r.listing_id) ?? 0));
        if (prevFit != null) {
          previousTop = {
            title: prevRecs[0]?.card_data?.title ?? null,
            still_best_overall: prevFit >= newBest,
          };
        }
      } catch (err) {
        console.error("[chatOrchestrator] previous_top check failed:", err);
      }
    }
    return {
      ok: true,
      all_new: true,
      previous_top: previousTop,
      matches: (session.recommendations ?? []).map((r) => ({
        title: r.card_data?.title ?? null,
        perPerson: r.card_data?.min_rent ?? null,
      })),
    };
  }

  if (name === "show_listings") {
    const refs = Array.isArray(input?.listings) ? input.listings.slice(0, 3) : [];
    if (!refs.length) return { ok: false, error: "No listings given." };
    let eligible;
    try {
      // Match against everything the student could see (set-asides included);
      // only explicit dislikes stay out.
      eligible = filterEligible(await fetchActiveListings(), { ...(session.preferences ?? {}), _setAside: [] });
    } catch (err) {
      console.error("[chatOrchestrator] show_listings fetch failed:", err);
      return { ok: false, error: "Could not load listings right now." };
    }
    const found = [];
    const seen = new Set();
    for (const ref of refs) {
      const hit = resolveEligibleListing(eligible, ref);
      if (hit && !seen.has(hit.listing.id)) {
        seen.add(hit.listing.id);
        found.push(hit.listing);
      }
    }
    if (!found.length) {
      return { ok: false, error: "None of those match a listing in the student's current market. Use exact titles from `market`." };
    }
    const reason = stripEmDashes((input?.reason ?? "").trim()) || "You asked to take a closer look at this one.";
    session.recommendations = found.map((listing) => ({
      listing_id: listing.id,
      score: null,
      intention: "Your pick",
      reason,
      card_data: extractCardData(listing),
    }));
    session._reranked = true;
    return { ok: true, shown: found.map((l) => extractCardData(l).title) };
  }

  if (name === "open_contact_draft") {
    const refs = Array.isArray(input?.listings) ? input.listings : [];
    const ids = [...new Set(refs.map((ref) => resolveShownId(session, ref)).filter(Boolean))];
    if (!ids.length) return { ok: false, error: "No matching shown listing found for that name." };
    const titleFor = (id) => (session.recommendations ?? []).find((r) => r.listing_id === id)?.card_data?.title ?? "this listing";
    const recipientsLabel = ids.map(titleFor).join(" & ");
    const message = defaultInquiryNote(session.preferences?.name);
    session._draft = { listingIds: ids, recipientsLabel, message };
    return { ok: true, recipients: ids.map(titleFor) };
  }

  return { ok: false, error: "Unknown tool." };
}

// Map the stored transcript into alternating chat turns for the model, merging
// consecutive same-role entries and noting when matches were shown.
function transcriptToMessages(session) {
  const entries = (session.transcript ?? []).slice(-16);
  const out = [];
  for (const m of entries) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    let text = m.content ?? "";
    if (m.recommendations?.length) {
      const titles = m.recommendations.map((r) => r.card_data?.title).filter(Boolean).join(", ");
      if (titles) text += `\n(showed matches: ${titles})`;
    }
    if (!text.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n${text}`;
    else out.push({ role: m.role, content: text });
  }
  if (out.length === 0 || out[0].role !== "user") out.unshift({ role: "user", content: "(start)" });
  return out;
}

// Drive the agent: a short tool-use loop. Mutates the session (re-rank / draft)
// and returns the final reply text.
async function runAgentTurn(session) {
  const context = {
    preferences: Object.fromEntries(
      Object.entries(session.preferences ?? {}).filter(([k]) => !k.startsWith("_"))
    ),
    matches: await shownListingsContext(session),
    // The full eligible market under their current filters — Proxy's knowledge
    // base for "what else is out there" conversation. See eligibleCatalog.
    market: await eligibleCatalog(session),
  };
  const system = [
    { type: "text", text: AGENT_SYSTEM, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: `Current preferences, the matches the student is looking at, and "market" (every listing that fits their current filters):\n${JSON.stringify(context)}`,
      // The catalog is a few thousand tokens and stable between turns; cache it
      // so the in-turn tool loop (and quick follow-ups) reread it at 0.1x.
      cache_control: { type: "ephemeral" },
    },
  ];
  const messages = transcriptToMessages(session);

  let reply = "";
  try {
    for (let i = 0; i < 4; i++) {
      const resp = await getClient().messages.create({
        model: HAIKU_MODEL,
        max_tokens: 600,
        system,
        tools: AGENT_TOOLS,
        messages,
      });
      addUsage(session, resp.usage);
      if (resp.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: resp.content });
        const results = [];
        for (const block of resp.content) {
          if (block.type === "tool_use") {
            const result = await runAgentTool(session, block.name, block.input);
            results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
          }
        }
        messages.push({ role: "user", content: results });
        continue;
      }
      reply = resp.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      break;
    }
  } catch (err) {
    console.error("[chatOrchestrator] runAgentTurn failed:", err);
  }

  if (!reply) {
    reply = session._draft
      ? "I've put together a draft for you, take a look below and send when you're ready."
      : session._reranked
      ? "Here are some updated matches."
      : "I'm here. Want me to tweak your matches or reach out to an owner?";
  }
  return stripEmDashes(reply);
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
        recommendations: session.recommendations,
      },
      { onConflict: "id" }
    );
  if (error) throw new Error(`[chatOrchestrator] Failed to persist session: ${error.message}`);
}

// STAGE 3: rank the top 3 for the current prefs/weights and stash the honest
// budget / group-fit / relax-coach notes for this turn's message.
async function rankTop3(session) {
  const intentions = pickIntentions(session.weights);
  try {
    const { ranked, usage, groupNote, budgetNote, relaxNote } = await rankListings({
      preferences: session.preferences,
      weights: session.weights,
      requestedIntentions: intentions,
      limit: 3,
    });
    addUsage(session, usage);
    session.recommendations = ranked.slice(0, 3).map((r) => ({ ...r, reason: stripEmDashes(r.reason) }));
    // Transient (not DB columns) — read within this turn to flag budget/group fit.
    session._groupNote = stripEmDashes(groupNote ?? null);
    session._budgetNote = stripEmDashes(budgetNote ?? null);
    // Hard-combination coach: which single relaxation would open up the market.
    session._relaxNote = stripEmDashes(relaxNote ?? null);
  } catch (err) {
    console.error("[chatOrchestrator] rankTop3 failed:", err);
    session.recommendations = [];
    session._groupNote = null;
    session._budgetNote = null;
    session._relaxNote = null;
  }
}

// Append the honest budget/group-fit/hard-combination notes (if any) to an
// assistant message.
function withNotes(text, session) {
  const notes = [session._budgetNote, session._groupNote, session._relaxNote].filter(Boolean);
  return notes.length ? `${text}\n\n${notes.join("\n\n")}` : text;
}

// Finalize: rank the deterministic top 3, mark the session done, push the
// closing message, persist, and return the turn payload.
async function finalizeRecommendations(session) {
  await rankTop3(session);
  // A rewound/edited flow carries the never-repeat set-aside from earlier
  // refines; if that alone filtered out everything that fits, re-showing a
  // previous match beats telling the student we came up empty.
  if (!(session.recommendations ?? []).length && (session.preferences?._setAside ?? []).length) {
    session.preferences._setAside = [];
    await rankTop3(session);
  }
  logConversationCost(session);
  session.status = "recommendations_ready";
  // With the strict group-size bed floor, ranking can now honestly come back
  // empty (e.g. a big group nothing on the market can house) — say so instead
  // of announcing matches that don't exist. The notes explain why.
  const closing = withNotes(
    session.recommendations?.length
      ? "All set. Here are your top three matches. Want to tweak anything? Just tell me (e.g. “cheaper” or “closer to campus”)."
      : "I came up empty: I don't have matches I can honestly recommend right now. Tell me what to adjust (like a smaller group or a different budget) and I'll look again.",
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

// Beyond this walk (minutes) a place realistically needs a car or the shuttle to
// reach campus. We replaced the upfront "how do you get to campus?" question with
// this just-in-time check so we only raise it when it actually matters.
const COMMUTE_WALK_LIMIT = 20;

// Before finalizing, if the student's surviving matches are split between
// walkable places and ones that realistically need a car or the shuttle, ask
// ONCE whether to keep the far ones in the mix. "No" excludes them and re-ranks.
// Reuses the tradeoff pruning machinery. Returns a turn payload (the confirm
// question) when it fires, or null to proceed straight to finalizing.
async function maybeCommuteConfirm(session) {
  const prefs = session.preferences ?? {};
  if (prefs._commuteAsked) return null;

  let eligible;
  try {
    eligible = filterEligible(await fetchActiveListings(), prefs);
  } catch (err) {
    console.error("[chatOrchestrator] maybeCommuteConfirm fetch failed:", err);
    return null;
  }

  const slim = eligible.map((e) => slimCandidate(e.listing));
  const walk = (c) => (typeof c.walk_to_campus_min === "number" ? c.walk_to_campus_min : null);
  const far = slim.filter((c) => walk(c) !== null && walk(c) > COMMUTE_WALK_LIMIT);
  const near = slim.filter((c) => walk(c) !== null && walk(c) <= COMMUTE_WALK_LIMIT);

  // Only worth asking when the pool is genuinely mixed: some far places that
  // would otherwise surface, AND nearer alternatives to fall back on if they say
  // no. Otherwise mark it asked so we don't reconsider on re-entry.
  if (far.length === 0 || near.length === 0) {
    prefs._commuteAsked = true;
    session.preferences = prefs;
    return null;
  }

  const minFarWalk = Math.round(Math.min(...far.map((c) => c.walk_to_campus_min)));
  const KEEP = "Yes, keep them";
  const DROP = "No, walking distance only";
  const prompt = `Heads up: a few of your best matches are about a ${minFarWalk}-minute walk from campus, so you'd want a car or the shuttle to get there. Want me to keep those in the mix?`;

  prefs._commuteAsked = true;
  // Tradeoff pruning: picking DROP excludes the listings filed under KEEP (the
  // far ones); picking KEEP excludes nothing. See applyTradeoffChoice.
  prefs._pendingTradeoff = { prompt, options: { [KEEP]: far.map((c) => c.listing_id), [DROP]: [] } };
  session.preferences = prefs;

  const question = {
    id: "commute_confirm",
    field: "_commute",
    kind: "tradeoff",
    prompt,
    options: [KEEP, DROP],
    // stepKey keeps this distinct from the numbered narrowing tradeoffs so the
    // client never dedupes it against them.
    meta: { stepKey: "commute" },
  };
  session.transcript.push({ role: "assistant", content: prompt, ts: new Date().toISOString(), question });
  await persistSession(session);
  return { session, nextQuestion: question, assistantMessage: prompt, recommendations: session.recommendations ?? [] };
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
    // Strip any em dash from the model's prompt (option labels are left intact so
    // they still match the stored serverOptions when the answer comes back).
    turn.question.prompt = stripEmDashes(turn.question.prompt);
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

  // Narrowing is done. Before showing the picks, raise the car/shuttle check once
  // if the surviving pool is split between walkable and far-from-campus places.
  const commute = await maybeCommuteConfirm(session);
  if (commute) return commute;

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
  return ranked.slice(0, 3).map((r) => ({ ...r, reason: stripEmDashes(r.reason) }));
}

// Single entry point for every turn. Which branch runs is decided purely by
// which field the client sent, in this order:
//   tradeoff  -> STAGE 2 (narrowing answer)
//   message   -> STAGE 4 (conversation, only once matches exist)
//   answer    -> STAGE 1 (scripted question answer)
//   none      -> init turn: just emit the first question
// Falling off the end of STAGE 1 (script complete) advances into STAGE 2/3.
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
    for (const k of ["_usage", "_excluded", "_setAside", "_pendingTradeoff", "_tradeoffCount", "_tradeoffHistory", "_viewerGender", "_commuteAsked"]) {
      if (prev[k] !== undefined) carried[k] = prev[k];
    }
    session.preferences = { ...preferences, ...carried };
  }
  if (weights) session.weights = weights;

  // STAGE 2 — narrowing: the user answered a "Would you X for Y?" tradeoff. Prune the
  // losing side, then ask the next tradeoff (or finalize if ≤3 / cap reached).
  if (tradeoff) {
    const chosen = tradeoff.chosen ?? "";
    session.transcript.push({ role: "user", content: String(chosen), ts: new Date().toISOString() });
    session.preferences = applyTradeoffChoice(session.preferences, chosen);
    return runNarrowing(session);
  }

  // STAGE 4 — conversation: recommendations already exist and the user typed a
  // message. A tool-using agent (full transcript + live matches) handles it — it
  // may re-rank, open an email draft to an owner, or just answer a question.
  if (message && session.status === "recommendations_ready") {
    session._reranked = false;
    session._draft = null;
    session.transcript.push({ role: "user", content: message, ts: new Date().toISOString() });
    const reply = await runAgentTurn(session);
    logConversationCost(session);
    // Only a re-rank changes the cards; append the matches to that message so a
    // reload renders them. A plain answer / draft is a normal text turn.
    const finalReply = session._reranked ? withNotes(reply, session) : reply;
    session.transcript.push(
      session._reranked
        ? { role: "assistant", content: finalReply, ts: new Date().toISOString(), recommendations: session.recommendations }
        : { role: "assistant", content: finalReply, ts: new Date().toISOString() }
    );
    await persistSession(session);
    const result = {
      session,
      nextQuestion: null,
      assistantMessage: finalReply,
      recommendations: session.recommendations,
      mode: "agent",
      reranked: !!session._reranked,
      draft: session._draft ?? null,
    };
    session._reranked = false;
    session._draft = null;
    return result;
  }

  // Scripted-question path. Answers only ever arrive as STRUCTURED chip answers:
  // the client renders every question as tappable controls and the free-text
  // composer stays hidden until the matches exist (see ChatWindow), so there is
  // no free-text-during-questions path and no LLM anywhere in this phase.
  if (answer) {
    session.transcript.push({
      role: "user",
      content: answerToLabel(answer),
      ts: new Date().toISOString(),
      // Lets a reloaded transcript keep the per-answer "Edit" affordance.
      questionId: answer.questionId,
    });
    // With a client snapshot the prefs were already adopted above; without one
    // (a bare answer post) apply it here.
    if (!preferences) {
      const applied = applyAnswer(session.preferences, session.weights, answer);
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
