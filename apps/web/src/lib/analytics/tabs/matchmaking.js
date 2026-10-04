import { fetchAll } from "@/lib/analytics/db";
import { gaBreakdown } from "@/lib/analytics/ga";
import { weeklyCounts, periodTotals } from "@/lib/analytics/periods";
import { QUESTION_PLAN, UNSURE, isAnswered } from "@/lib/matchmaking/questionScript";
import {
  DB,
  GA,
  GA_FUNNEL_NOTE,
  block,
  safeBlock,
  gaBlock,
  gaStepsTable,
  customDimensionDistribution,
  pct,
  average,
  within,
  countValues,
} from "@/lib/analytics/blocks";

/*
 * Matchmaking (the Proxy chat). Shared with partners on the sandbox, so everything here is a
 * total, a share or a trend: never a name, a chat message or a listing.
 */

const COMPLETED = "recommendations_ready";

const QUESTION_LABELS = {
  name_confirm: "Name check (first question)",
  group_size: "Group size",
  budget: "Budget",
  area: "Neighborhoods",
  lease_term: "Lease length",
  move_in_window: "Move-in month",
  furnished: "Furnished",
  priorities: "Priorities",
  top_priority: "Top priority",
  extras: "Anything else",
  narrowing: "Trade-off questions",
  recommendations: "Viewing recommendations",
  post_contact_offer: "After the contact offer",
  contact_sent: "After contacting landlords",
};
const STAGE_ORDER = [...QUESTION_PLAN.map((q) => QUESTION_LABELS[q.id]), "Trade-off questions"];

const FUNNEL_STEPS = [
  { event: "Matchmaking Opened", label: "Opened matchmaking" },
  { event: "Proxy Chat Started", label: "Started a chat" },
  { event: "Proxy Question Answered", label: "Answered a question" },
  { event: "Proxy Recommendations Shown", label: "Saw recommendations" },
  { event: "Proxy Listing Clicked", label: "Clicked a recommended listing" },
  { event: "Proxy Contact Email Sent", label: "Contacted a landlord from chat" },
];

const NOT_SURE = "Not sure / no preference";

// ─── Normalising stored answers ──────────────────────────────────────────────────
// Answers were saved in slightly different shapes as the chat evolved (lease length as a
// list, older move-in labels), so each is mapped onto one label set before counting.

const isUnsure = (v) => v === UNSURE || v === "No preference" || v === "none" || v === "Not sure";
const list = (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);

function budgetBucket(p) {
  const max = Number(p.budget_max);
  if (!max) return p._budget_unsure || p.budget_max === null ? NOT_SURE : null;
  if (max < 800) return "Under $800";
  if (max < 1000) return "$800 to $999";
  if (max < 1200) return "$1,000 to $1,199";
  if (max < 1500) return "$1,200 to $1,499";
  return "$1,500 or more";
}
const BUDGET_ORDER = ["Under $800", "$800 to $999", "$1,000 to $1,199", "$1,200 to $1,499", "$1,500 or more", NOT_SURE];

function groupSize(p) {
  const v = p.group_size;
  if (v === null || v === undefined) return null;
  if (isUnsure(v)) return NOT_SURE;
  if (v === "Studio") return "Studio (just me)";
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return null;
  return n >= 5 ? "5 or more" : n === 1 ? "1 (just me)" : `${n} people`;
}
const GROUP_ORDER = ["Studio (just me)", "1 (just me)", "2 people", "3 people", "4 people", "5 or more", NOT_SURE];

const leaseTerms = (p) => list(p.lease_term).map((v) => (isUnsure(v) ? NOT_SURE : v));

function moveInMonth(p) {
  const v = p.move_in_month;
  if (!v) return null;
  if (isUnsure(v)) return NOT_SURE;
  // Older chats saved "August" followed by a dash label, newer ones "August (start of the
  // year)"; both count as "August". \u2014 is the dash character used in the old label.
  return String(v).split(/[\s(\u2014-]/)[0];
}
const MONTH_ORDER = [
  "August", "September", "October", "November", "December", "January",
  "February", "March", "April", "May", "June", "July", NOT_SURE,
];

const furnished = (p) => (p.furnished ? (isUnsure(p.furnished) ? NOT_SURE : p.furnished) : null);

const PRIORITY_ALIASES = { price: "Good value" };
const priorityLabel = (v) => (isUnsure(v) ? NOT_SURE : PRIORITY_ALIASES[v] ?? v);

// With only one priority picked, the chat skips "which matters most": that pick is the top.
function topPriority(p) {
  if (p.top_priority) return priorityLabel(p.top_priority);
  const picks = list(p.priorities);
  return picks.length === 1 ? priorityLabel(picks[0]) : null;
}

const areas = (p) => list(p.area).map((v) => (isUnsure(v) ? NOT_SURE : v));

/** Where an unfinished chat stopped: the first question it has not answered yet. */
function stoppedAt(p) {
  const next = QUESTION_PLAN.find((q) => !isAnswered(q, p));
  return next ? QUESTION_LABELS[next.id] : "Trade-off questions";
}

// ─── Loader ─────────────────────────────────────────────────────────────────────

export default async function loadMatchmaking(period) {
  // Transcripts are read only to count the student's own messages; their text never leaves
  // this function. If chat volume grows into the thousands per period, move this count into
  // a SQL view.
  const [sessions, formSaves, guestRows] = await Promise.all([
    fetchAll(
      "matchmaking_chat_sessions",
      "id, user_id, status, created_at, preferences, recommendations, transcript",
      (q) => q.gte("created_at", period.prevStart)
    ),
    fetchAll("matchmaking_preferences", "id, created_at", (q) => q.gte("created_at", period.prevStart)),
    fetchAll("users", "id", (q) => q.eq("email", "guest@proximity.test")),
  ]);
  // Signed-out chats are stored under one shared guest account (see api/matchmaking/chat).
  const guestId = guestRows[0]?.id;

  const current = sessions.filter((s) => within(s.created_at, period.start));
  const completed = sessions.filter((s) => s.status === COMPLETED);
  const currentCompleted = current.filter((s) => s.status === COMPLETED);
  const currentUnfinished = current.filter((s) => s.status !== COMPLETED);
  const prefs = (s) => s.preferences ?? {};

  const started = periodTotals(period, sessions);
  const done = periodTotals(period, completed);
  const signedIn = (from, to) =>
    new Set(
      sessions
        .filter((s) => s.user_id && s.user_id !== guestId && within(s.created_at, from, to))
        .map((s) => s.user_id)
    ).size;
  const studentMessages = (s) => (s.transcript ?? []).filter((m) => m?.role === "user").length;
  const recs = (s) => (Array.isArray(s.recommendations) ? s.recommendations : []);

  const blocks = await Promise.all([
    safeBlock("At a glance", () =>
      block("At a glance", {
        tiles: [
          { label: "Chats started", ...started },
          { label: "Chats that reached recommendations", ...done },
          {
            label: "Completion rate",
            current: pct(done.current, started.current),
            previous: pct(done.previous, started.previous),
            format: "percent",
            hint: "Chats that reached recommendations, divided by chats started.",
          },
          {
            label: "Signed-in students who chatted",
            current: signedIn(period.start),
            previous: signedIn(period.prevStart, period.start),
            hint: "Signed-out chats share one guest account, so they are not counted here.",
          },
          {
            label: "Messages per finished chat",
            current: average(currentCompleted.map(studentMessages)),
            hint: "Average number of answers and messages a student sent in chats that reached recommendations.",
          },
          {
            label: "Listings recommended per chat",
            current: average(currentCompleted.map((s) => recs(s).length)),
          },
          {
            label: "Preference form saves",
            ...periodTotals(period, formSaves),
            hint: "The older form-based matchmaking flow, before the chat.",
          },
        ],
        trends: [
          {
            title: "Chats per week",
            source: DB,
            series: [
              { label: "Started", values: weeklyCounts(period, sessions) },
              { label: "Reached recommendations", values: weeklyCounts(period, completed) },
            ],
          },
        ],
      })
    ),

    gaBlock("Funnel", async () =>
      block("Funnel", {
        description: "How far visitors get, from opening matchmaking to contacting a landlord.",
        tables: [await gaStepsTable(period, "Matchmaking funnel", FUNNEL_STEPS)],
        notes: [GA_FUNNEL_NOTE],
      })
    ),

    safeBlock("Where unfinished chats stop", async () => {
      const exits = await gaBreakdown(period, {
        dimension: "customEvent:stage",
        event: "Proxy Chat Exited",
      }).catch(() => null);
      return block("Where unfinished chats stop", {
        description:
          "The question a chat was waiting on when the student stopped. The database view covers every saved chat; the Google Analytics view also catches visitors who left before a chat was saved.",
        tiles: [
          { label: "Unfinished chats this period", current: currentUnfinished.length },
          {
            label: "Stopped at the first question",
            current: pct(
              currentUnfinished.filter((s) => stoppedAt(prefs(s)) === QUESTION_LABELS.name_confirm).length,
              currentUnfinished.length
            ),
            format: "percent",
          },
        ],
        distributions: [
          {
            title: "Last question reached (unfinished chats)",
            source: DB,
            rows: countValues(currentUnfinished, (s) => stoppedAt(prefs(s)), { order: STAGE_ORDER }),
          },
          ...(exits
            ? [customDimensionDistribution("Where visitors left the chat", exits, (v) => QUESTION_LABELS[v] ?? v)]
            : []),
        ],
      });
    }),

    safeBlock("What students are looking for", () => {
      const answered = current.filter((s) => Object.keys(prefs(s)).length > 2);
      const dist = (title, pick, order) => {
        const rows = countValues(answered, (s) => pick(prefs(s)), { order });
        return { title, source: DB, rows };
      };
      return block("What students are looking for", {
        description:
          "Answers from every chat started this period, finished or not. Questions that allow several picks count each pick.",
        distributions: [
          dist("Max rent per person", budgetBucket, BUDGET_ORDER),
          dist("Group size", groupSize, GROUP_ORDER),
          dist("Lease length", leaseTerms),
          dist("Move-in month", moveInMonth, MONTH_ORDER),
          dist("Furnished", furnished),
          dist("Top priority", topPriority),
          dist("All priorities picked", (p) => list(p.priorities).map(priorityLabel)),
          dist("Neighborhoods", areas),
        ],
      });
    }),

    safeBlock("What Proxy recommends", () => {
      const all = currentCompleted.flatMap(recs);
      const perListing = countValues(all, (r) => r.listing_id);
      const topFive = perListing.slice(0, 5).reduce((a, [, n]) => a + n, 0);
      return block("What Proxy recommends", {
        tiles: [
          { label: "Recommendations shown", current: all.length },
          { label: "Different listings recommended", current: perListing.length },
          {
            label: "Share going to the 5 most-recommended listings",
            current: pct(topFive, all.length),
            format: "percent",
            hint: "Lower means demand is spread across more listings.",
          },
        ],
        distributions: [
          {
            title: "Recommendation types",
            source: DB,
            rows: countValues(all, (r) => r.intention || "Other"),
          },
        ],
      });
    }),

    gaBlock("Where students come from", async () => {
      const [devices, channels, from] = await Promise.all([
        gaBreakdown(period, { dimension: "deviceCategory", event: "Matchmaking Opened" }),
        gaBreakdown(period, { dimension: "sessionDefaultChannelGroup", event: "Matchmaking Opened" }),
        gaBreakdown(period, { dimension: "customEvent:from", event: "Matchmaking Opened" }),
      ]);
      return block("Where students come from", {
        description: "Visitors who opened matchmaking.",
        distributions: [
          { title: "Device", source: GA, rows: devices },
          { title: "How they reached the site", source: GA, rows: channels },
          customDimensionDistribution("Page they came from", from, (v) => (v === "direct" ? "Came straight to matchmaking" : v)),
        ],
      });
    }),

    gaBlock("After recommendations", async () => {
      const [positions, types, actions] = await Promise.all([
        gaBreakdown(period, { dimension: "customEvent:position", event: "Proxy Listing Clicked" }),
        gaBreakdown(period, { dimension: "customEvent:intention", event: "Proxy Listing Clicked" }),
        gaBreakdown(period, {
          dimension: "eventName",
          events: ["Listing Opened", "Favorite Toggled", "Contact Submitted", "Waitlist Clicked"],
          match: { field: "customEvent:source", value: "matchmaking" },
        }),
      ]);
      const actionLabels = {
        "Listing Opened": "Opened a recommended listing",
        "Favorite Toggled": "Saved or unsaved it",
        "Contact Submitted": "Contacted the landlord from the listing",
        "Waitlist Clicked": "Joined a waitlist",
      };
      return block("After recommendations", {
        description: "What students do with the listings Proxy shows them.",
        distributions: [
          customDimensionDistribution("Which card they clicked", positions, (v) => `Card ${v}`),
          customDimensionDistribution("Type of card clicked", types),
          customDimensionDistribution("Listing actions that came from matchmaking", actions, (v) => actionLabels[v] ?? v),
        ],
      });
    }),
  ]);

  return { blocks };
}
