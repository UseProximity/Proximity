import { fetchAll } from "@/lib/analytics/db";
import { gaBreakdown } from "@/lib/analytics/ga";
import { weeklyCounts, periodTotals } from "@/lib/analytics/periods";
import {
  NO_PREFERENCE,
  LEASE_OPTIONS,
  COMMUTE_MODES,
  PROMPTS,
  slowestMode,
  isOpenEnded,
  promptSentence,
  standingChips,
} from "@/lib/findYourPlace/options";
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
import { EVENT_PREFIX, CLIENT_EVENTS } from "@/lib/findYourPlace/events";

const FYP_EVENT_TYPES = [...CLIENT_EVENTS, "search_failed"].map((name) => `${EVENT_PREFIX}${name}`);

/*
 * Find Your Place: the three-page flow (basics, then anything else in their own
 * words, then the top four matches) that replaced the Proxy chat on the web on
 * 2026-11-15. Shared with partners on the sandbox, so everything here is a
 * total, a share or a trend: never a name, a typed message or a listing.
 *
 * One search is one row in matchmaking_chat_sessions, marked by
 * preferences._fyp. Going back and searching again updates the same row
 * (`_fyp.runs` counts the searches), and Start over makes a new one. The row is
 * written when matches are found, so a student who leaves on page 1 or 2 has
 * no row: those drop-offs come from Google Analytics. Rows without _fyp are the
 * Proxy chat, which the mobile app still uses; they get their own small block.
 *
 * The moments that leave no row (leaving a page, a failed search, the homepage
 * popup) are recorded in our own `events` table as fyp_* rows
 * (lib/findYourPlace/events.js), from 2026-11-17 on.
 */

const COMPLETED = "recommendations_ready";
const NOT_SURE = "No preference";
const CLOSE = "Close match";

const isFyp = (s) => !!s.preferences?._fyp;
const fyp = (s) => s.preferences?._fyp ?? {};
const answers = (s) => fyp(s).answers ?? {};
const parsed = (s) => fyp(s).parsed ?? {};
const recs = (s) => (Array.isArray(s.recommendations) ? s.recommendations : []);

const STAGE_LABELS = {
  basics: "Page 1: the basics",
  preferences: "Page 2: their own words",
  loading: "Waiting for matches to load",
  error: "After a search failed",
  matches: "Page 3: matches",
};
const STAGE_ORDER = Object.values(STAGE_LABELS);
const stageLabel = (v) => STAGE_LABELS[v] ?? null;
const FAIL_LABELS = {
  cap: "Hit the signed-out search limit",
  busy: "Too many searches from one network",
  invalid: "Answers needed another look",
  error: "Something went wrong",
};
const IN_APP_NOTE = "Recorded by Proximity itself (not Google Analytics) since November 17, 2026, so it counts every visitor; weeks before that show nothing.";

// ─── Labelling answers ───────────────────────────────────────────────────────────

function groupSize(a) {
  if (a.group === NOT_SURE) return NOT_SURE;
  const n = parseInt(a.group, 10);
  if (!Number.isFinite(n)) return null;
  return n >= 5 ? "5 or more" : n === 1 ? "Just me" : `${n} people`;
}
const GROUP_ORDER = ["Just me", "2 people", "3 people", "4 people", "5 or more", NOT_SURE];

function budgetBucket(a) {
  if (a.budget === NOT_SURE) return NOT_SURE;
  const max = Number(a.budget);
  if (!max) return null;
  if (max < 800) return "Under $800";
  if (max < 1000) return "$800 to $999";
  if (max < 1200) return "$1,000 to $1,199";
  if (max < 1500) return "$1,200 to $1,499";
  return "$1,500 or more";
}
const BUDGET_ORDER = ["Under $800", "$800 to $999", "$1,000 to $1,199", "$1,200 to $1,499", "$1,500 or more", NOT_SURE];

function leaseLength(a) {
  if (!a.lease) return null;
  if (a.lease === NOT_SURE) return NOT_SURE;
  const known = LEASE_OPTIONS.find((o) => o.id === a.lease);
  return known ? known.label : "Another length";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function moveInMonth(a) {
  if (!a.moveIn) return null;
  if (a.moveIn === NOT_SURE) return NOT_SURE;
  return MONTHS[Number(a.moveIn.slice(5, 7)) - 1] ?? null;
}
const MONTH_ORDER = [...MONTHS.slice(7), ...MONTHS.slice(0, 7), NOT_SURE];

const modeLabel = (id) => COMMUTE_MODES.find((m) => m.id === id)?.label ?? id;
const commuteModes = (a) => (a.modes ?? []).map(modeLabel);

// The follow-up limit, about the slowest mode they picked ("Walk, 15 min").
function commuteLimit(a) {
  const mode = slowestMode(a.modes ?? []);
  if (!mode || typeof a.commuteMax !== "number") return null;
  return isOpenEnded(mode, a.commuteMax) ? `${mode.label}, no limit` : `${mode.label}, ${a.commuteMax} min`;
}

// Page 2 ideas that still stand in the box when they searched (a reworded or
// deleted sentence no longer counts, the same rule the page itself uses).
function ideasPicked(s) {
  const { chips = {}, text = "" } = fyp(s);
  const standing = standingChips(text, chips);
  return PROMPTS.flatMap((prompt) => {
    const ids = standing[prompt.id] ?? [];
    return prompt.options.filter((o) => ids.includes(o.id)).map((o) => `${prompt.label}: ${o.label}`);
  });
}

// Words of their own on page 2: what is left once every picked idea's sentence
// is taken out of the box.
function wroteOwnWords(s) {
  const { chips = {}, text = "" } = fyp(s);
  let rest = text;
  for (const prompt of PROMPTS) {
    const sentence = promptSentence(prompt, chips[prompt.id] ?? []);
    if (sentence) rest = rest.replace(sentence, "");
  }
  return rest.replace(/[\s.,!]+/g, "").length >= 3;
}
const skippedPage2 = (s) => !(fyp(s).text ?? "").trim();

// What the matcher understood from page 2 (typed words and picked ideas alike).
const AREA_LABELS = { "The Loop": "Delmar Loop" };
const AMENITY_LABELS = {
  laundry: "In-unit laundry",
  parking: "Parking",
  air_conditioning: "Air conditioning",
  storage: "Storage",
  dishwasher: "Dishwasher",
  gym: "Gym",
  pool: "Pool",
  study_room: "Study spaces",
  mailroom: "Mailroom",
  pets_allowed: "Pets allowed",
};
const areas = (s) => (parsed(s).areas ?? []).map((a) => AREA_LABELS[a] ?? a);
const amenities = (s) => (parsed(s).amenities ?? []).map((k) => AMENITY_LABELS[k] ?? k);
const furnishing = (s) => ({ yes: "Furnished", no: "Unfurnished" })[parsed(s).furnished] ?? null;

// ─── Loader ─────────────────────────────────────────────────────────────────────

export default async function loadMatchmaking(period) {
  const [rows, guestRows, eventRows] = await Promise.all([
    fetchAll(
      "matchmaking_chat_sessions",
      "id, user_id, visitor_id, status, created_at, expired_at, preferences, recommendations",
      (q) => q.gte("created_at", period.prevStart)
    ),
    fetchAll("users", "id", (q) => q.eq("email", "guest@proximity.test")),
    fetchAll("events", "id, user_id, event_type, metadata, created_at", (q) =>
      q.in("event_type", FYP_EVENT_TYPES).gte("created_at", period.prevStart)
    ),
  ]);
  // The shared guest account is a house test login, not a student.
  const guestId = guestRows[0]?.id;
  const sessions = rows.filter((s) => !guestId || s.user_id !== guestId);

  const events = eventRows.filter((e) => !guestId || e.user_id !== guestId);
  const ofEvent = (name) => events.filter((e) => e.event_type === `fyp_${name}`);
  const nowEvents = (name) => ofEvent(name).filter((e) => within(e.created_at, period.start));
  const meta = (e) => e.metadata ?? {};

  const searches = sessions.filter(isFyp);
  const chats = sessions.filter((s) => !isFyp(s));
  const current = searches.filter((s) => within(s.created_at, period.start));
  // An unclaimed signed-out search past its 30-day window keeps its row (so the
  // counts hold) but not its answers or matches; anything read from those skips it.
  const readable = current.filter((s) => !s.expired_at);

  const signedInPeople = (from, to) =>
    new Set(searches.filter((s) => s.user_id && !s.visitor_id && within(s.created_at, from, to)).map((s) => s.user_id)).size;
  // visitor_id is only ever set on searches that started signed out; an expired
  // one has lost it but still has no account. A claimed one is a signed-out
  // search whose visitor then signed up or signed in on that browser.
  const startedSignedOut = searches.filter((s) => s.visitor_id || !s.user_id);
  const signedOut = periodTotals(period, startedSignedOut);
  const claimed = periodTotals(period, startedSignedOut.filter((s) => s.user_id));
  const share = (test) => pct(readable.filter(test).length, readable.length);

  const blocks = await Promise.all([
    safeBlock("At a glance", () =>
      block("At a glance", {
        description:
          "One search is one trip to the matches page. Going back to edit and searching again counts as the same search; Start over makes a new one.",
        tiles: [
          { label: "Searches", ...periodTotals(period, searches) },
          {
            label: "Signed-in students who searched",
            current: signedInPeople(period.start),
            previous: signedInPeople(period.prevStart, period.start),
            hint: "Distinct accounts. Searches that started signed out are counted separately.",
          },
          {
            label: "Searches started signed out",
            ...signedOut,
            hint: "Visitors see their matches without an account; opening or contacting one asks them to sign in.",
          },
          {
            label: "Signed-out searches that turned into accounts",
            current: pct(claimed.current, signedOut.current),
            previous: pct(claimed.previous, signedOut.previous),
            format: "percent",
            hint: "Share of signed-out searches whose visitor then signed up or signed in on that browser, which moves the search into the account.",
          },
          {
            label: "Searches per visit",
            current: average(readable.map((s) => Number(fyp(s).runs) || 1)),
            hint: "How often a student edited their answers and searched again before leaving.",
          },
          {
            label: "Wrote in their own words",
            current: share(wroteOwnWords),
            format: "percent",
            hint: "Searches where page 2 had something typed beyond the ideas they tapped.",
          },
          {
            label: "Skipped page 2",
            current: share(skippedPage2),
            format: "percent",
            hint: "Searches with nothing on page 2: no words and no ideas picked.",
          },
        ],
        trends: [
          {
            title: "Searches per week",
            source: DB,
            series: [
              { label: "All searches", values: weeklyCounts(period, searches) },
              { label: "Started signed out", values: weeklyCounts(period, startedSignedOut) },
            ],
          },
        ],
      })
    ),

    gaBlock("Funnel", async () =>
      block("Funnel", {
        description: "How far visitors get, from opening Find Your Place to contacting a landlord.",
        tables: [
          await gaStepsTable(period, "Find Your Place funnel", [
            { event: "Find Your Place Opened", label: "Opened Find Your Place" },
            { event: "Find Your Place Basics Done", label: "Finished page 1 (the basics)" },
            { event: "Find Your Place Matches Shown", label: "Saw their matches" },
            { event: "Find Your Place Listing Clicked", label: "Opened a match" },
            { event: "Find Your Place Contact Clicked", label: "Clicked Contact on a match" },
          ]),
          await gaStepsTable(
            period,
            "Signing in to see a match",
            [
              { event: "Find Your Place Wall Shown", label: "Signed out, clicked a match" },
              { event: "Find Your Place Wall Clicked", label: "Chose to sign in or sign up" },
              { event: "Find Your Place Matches Claimed", label: "Came back signed in" },
            ],
            { sequential: true }
          ),
        ],
        notes: [GA_FUNNEL_NOTE],
      })
    ),

    safeBlock("Where people stop", () => {
      const opened = periodTotals(period, ofEvent("opened"));
      const exits = ofEvent("exited");
      const left = periodTotals(period, exits);
      const exitsNow = nowEvents("exited");
      const searchesNow = current.length;
      return block("Where people stop", {
        description:
          "Visits that ended before any matches were on screen, and the page they were on. Someone who comes back to matches they already have is not counted as leaving.",
        tiles: [
          { label: "Visits to Find Your Place", ...opened },
          {
            label: "Left before seeing matches",
            current: pct(left.current, opened.current),
            previous: pct(left.previous, opened.previous),
            format: "percent",
            hint: "Share of visits.",
          },
          {
            label: "Left while matches were loading",
            current: exitsNow.filter((e) => meta(e).stage === "loading").length,
            hint: "A search takes several seconds. These visitors asked for matches and left before they arrived.",
          },
          {
            label: "Went back to edit after seeing matches",
            current: pct(nowEvents("preferences_edited").filter((e) => meta(e).stage === "matches").length, searchesNow),
            format: "percent",
            hint: "Edit Preferences clicks with matches on screen, as a share of searches. Clicks while matches were still loading are not counted.",
          },
        ],
        distributions: [
          {
            title: "Left before seeing matches, by page",
            source: DB,
            rows: countValues(exitsNow, (e) => stageLabel(meta(e).stage), { order: STAGE_ORDER }),
          },
          {
            title: "Questions answered when leaving page 1",
            source: DB,
            rows: countValues(
              exitsNow.filter((e) => meta(e).stage === "basics"),
              (e) => (Number.isInteger(meta(e).answered) ? `${meta(e).answered} of 5` : null),
              { order: ["0 of 5", "1 of 5", "2 of 5", "3 of 5", "4 of 5", "5 of 5"] }
            ),
            note: "5 of 5 means every question was answered but they never clicked Next.",
          },
          {
            title: "Started over from",
            source: DB,
            rows: countValues(nowEvents("started_over"), (e) => stageLabel(meta(e).stage), { order: STAGE_ORDER }),
          },
        ],
        notes: [IN_APP_NOTE],
      });
    }),

    safeBlock("Searches that failed", () => {
      const failures = ofEvent("search_failed");
      const failedNow = nowEvents("search_failed");
      const attempts = readable.reduce((sum, s) => sum + (Number(fyp(s).runs) || 1), 0) + failedNow.length;
      const capped = failedNow.filter((e) => meta(e).reason === "cap").length;
      return block("Searches that failed", {
        description:
          "Times Show My Matches did not bring back matches. Recorded by the server, so it counts the mobile app too once it uses Find Your Place.",
        tiles: [
          { label: "Failed searches", ...periodTotals(period, failures) },
          {
            label: "Share of searches that failed",
            current: pct(failedNow.length, attempts),
            format: "percent",
          },
          { label: "Stopped by the signed-out limit", current: capped, hint: "Signed-out devices get 10 searches before being asked to sign in." },
          {
            label: "Signed in from the limit",
            current: pct(nowEvents("cap_sign_in").length, capped),
            format: "percent",
            hint: "Clicked Sign in to keep going, as a share of searches stopped by the limit.",
          },
          {
            label: "Failures on a retry",
            current: pct(failedNow.filter((e) => meta(e).retry).length, failedNow.length),
            format: "percent",
            hint: "Failed again after the student clicked Try again.",
          },
        ],
        trends: [{ title: "Failed searches per week", source: DB, series: [{ label: "Failed", values: weeklyCounts(period, failures) }] }],
        distributions: [
          { title: "Why it failed", source: DB, rows: countValues(failedNow, (e) => FAIL_LABELS[meta(e).reason] ?? null) },
        ],
        notes: [IN_APP_NOTE],
      });
    }),

    safeBlock("Homepage popup", () => {
      const shown = periodTotals(period, ofEvent("popup_shown"));
      const clicked = periodTotals(period, ofEvent("popup_clicked"));
      const fromPopup = readable.filter((s) => fyp(s).fromPopup).length;
      return block("Homepage popup", {
        description:
          "The homepage card that asks the group-size question. Picking a size opens Find Your Place with that answer filled in. It is not shown on a browser that already has matches.",
        tiles: [
          { label: "Times shown", ...shown },
          {
            label: "Picked a group size",
            current: pct(clicked.current, shown.current),
            previous: pct(clicked.previous, shown.previous),
            format: "percent",
            hint: "Share of times shown.",
          },
          {
            label: "Closed it",
            current: pct(nowEvents("popup_dismissed").length, shown.current),
            format: "percent",
          },
          {
            label: "Searches that started from it",
            current: fromPopup,
            hint: `Got as far as matches after starting in the popup: ${Math.round((pct(fromPopup, readable.length) ?? 0) * 100)}% of searches this period.`,
          },
        ],
        distributions: [
          {
            title: "Group size picked",
            source: DB,
            rows: countValues(nowEvents("popup_clicked"), (e) => meta(e).group ?? null, { order: ["1", "2", "3", "4", "5+"] }),
          },
        ],
        notes: [IN_APP_NOTE],
      });
    }),

    safeBlock("What students are looking for", () => {
      const dist = (title, pick, order) => ({ title, source: DB, rows: countValues(readable, pick, { order }) });
      return block("What students are looking for", {
        description:
          "Answers from every search this period. Questions that allow several picks count each pick.",
        distributions: [
          dist("Group size", (s) => groupSize(answers(s)), GROUP_ORDER),
          dist("Max rent per person", (s) => budgetBucket(answers(s)), BUDGET_ORDER),
          dist("Lease length", (s) => leaseLength(answers(s))),
          dist("Move-in month", (s) => moveInMonth(answers(s)), MONTH_ORDER),
          dist("How they get to campus", (s) => commuteModes(answers(s))),
          dist("Commute limit", (s) => commuteLimit(answers(s))),
        ],
      });
    }),

    safeBlock("Page 2: in their own words", () => {
      const dist = (title, pick) => ({ title, source: DB, rows: countValues(readable, pick) });
      return block("Page 2: in their own words", {
        description:
          "What students asked for beyond the basics. The first three charts are what the matcher understood from page 2, typed and tapped alike; the last is which suggested ideas were tapped.",
        distributions: [
          dist("Neighborhoods asked for", areas),
          dist("Furnishing", furnishing),
          dist("Amenities asked for", amenities),
          dist("Suggested ideas tapped", ideasPicked),
        ],
      });
    }),

    safeBlock("The matches", () => {
      const all = readable.flatMap(recs);
      const perListing = countValues(all, (r) => r.listing_id);
      const topFive = perListing.slice(0, 5).reduce((a, [, n]) => a + n, 0);
      const closeCount = (s) => recs(s).filter((r) => r.intention === CLOSE).length;
      return block("The matches", {
        description:
          "A top match fits every answer. A close match misses one or more of them and says what it misses; they fill the four cards when fewer than four places fit.",
        tiles: [
          { label: "Matches shown", current: all.length },
          { label: "Different listings shown", current: perListing.length },
          {
            label: "Share going to the 5 most-shown listings",
            current: pct(topFive, all.length),
            format: "percent",
            hint: "Lower means demand is spread across more listings.",
          },
          {
            label: "Searches with a close match",
            current: share((s) => closeCount(s) > 0),
            format: "percent",
            hint: "Fewer than four places fit everything they asked for.",
          },
          {
            label: "Searches where nothing fit everything",
            current: share((s) => recs(s).length > 0 && closeCount(s) === recs(s).length),
            format: "percent",
          },
          {
            label: "Searches with no matches at all",
            current: share((s) => s.status === COMPLETED && recs(s).length === 0),
            format: "percent",
            hint: "Even the close matches ran out, usually on group size, move-in month or sublease rules.",
          },
        ],
        distributions: [{ title: "Top and close matches", source: DB, rows: countValues(all, (r) => r.intention || "Other") }],
      });
    }),

    gaBlock("After the matches", async () => {
      const [positions, types, actions, browse] = await Promise.all([
        gaBreakdown(period, { dimension: "customEvent:position", events: ["Find Your Place Listing Clicked", "Find Your Place Contact Clicked"] }),
        gaBreakdown(period, { dimension: "customEvent:intention", events: ["Find Your Place Listing Clicked", "Find Your Place Contact Clicked"] }),
        gaBreakdown(period, {
          dimension: "eventName",
          events: ["Listing Opened", "Favorite Toggled", "Contact Submitted", "Waitlist Clicked"],
          match: { field: "customEvent:source", value: "matchmaking" },
        }),
        gaBreakdown(period, {
          dimension: "eventName",
          events: ["Find Your Place Matches Shown", "Find Your Place Browse Clicked", "Find Your Place Match Revisited"],
        }),
      ]);
      const actionLabels = {
        "Listing Opened": "Opened the listing",
        "Favorite Toggled": "Saved or unsaved it",
        "Contact Submitted": "Messaged the landlord",
        "Waitlist Clicked": "Joined a waitlist",
      };
      const browseLabels = {
        "Find Your Place Matches Shown": "Saw their matches",
        "Find Your Place Browse Clicked": "Clicked Browse All Matches",
        "Find Your Place Match Revisited": "Came back to a match another way",
      };
      return block("After the matches", {
        description:
          "What students do with their four cards. A match opened from the cards opens in browse, where saving, messaging and waitlists are counted as coming from Find Your Place.",
        distributions: [
          customDimensionDistribution("Which card they clicked", positions, (v) => `Card ${v}`),
          customDimensionDistribution("Top or close match clicked", types),
          customDimensionDistribution("What they did on a match's listing", actions, (v) => actionLabels[v] ?? v),
          {
            title: "Beyond the four cards",
            source: GA,
            rows: browse.map(([v, n]) => [browseLabels[v] ?? v, n]),
            note:
              "Came back to a match another way: opened, saved, messaged or waitlisted a listing they were shown, through browse, search or a link rather than the cards, on the same browser.",
          },
        ],
      });
    }),

    gaBlock("Where students come from", async () => {
      const [devices, channels, from] = await Promise.all([
        gaBreakdown(period, { dimension: "deviceCategory", event: "Find Your Place Opened" }),
        gaBreakdown(period, { dimension: "sessionDefaultChannelGroup", event: "Find Your Place Opened" }),
        gaBreakdown(period, { dimension: "customEvent:from", event: "Find Your Place Opened" }),
      ]);
      return block("Where students come from", {
        description: "Visitors who opened Find Your Place.",
        distributions: [
          { title: "Device", source: GA, rows: devices },
          { title: "How they reached the site", source: GA, rows: channels },
          customDimensionDistribution("Page they came from", from, (v) => (v === "direct" ? "Came straight to Find Your Place" : v)),
        ],
      });
    }),

    safeBlock("Proxy chat (mobile app)", () => {
      const started = periodTotals(period, chats);
      const done = periodTotals(period, chats.filter((s) => s.status === COMPLETED));
      return block("Proxy chat (mobile app)", {
        description:
          "The older chat that Find Your Place replaced on the web. The mobile app still uses it, and chats from before the switch are counted here too.",
        tiles: [
          { label: "Chats started", ...started },
          { label: "Chats that reached recommendations", ...done },
          {
            label: "Completion rate",
            current: pct(done.current, started.current),
            previous: pct(done.previous, started.previous),
            format: "percent",
          },
        ],
      });
    }),
  ]);

  return { blocks };
}
