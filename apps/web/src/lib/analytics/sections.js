import { fetchAll, countRows, lookupIds } from "@/lib/analytics/db";
import { gaConfigured, gaEventUsers, gaTraffic } from "@/lib/analytics/ga";
import { gscConfigured, fetchGscWindows } from "@/lib/seo/gsc";
import { weeklyCounts, periodTotals, sum } from "@/lib/analytics/periods";

/*
 * One loader per /analytics section. Every loader returns the same plain shape, which the
 * page renders without knowing what the numbers mean:
 *
 *   {
 *     tiles:  [{ label, current, previous?, format?: "number" | "percent" | "days", hint? }],
 *     trends: [{ title, source, series: [{ label, values: number[] }] }],   one value per week
 *     tables: [{ title, source, columns: [{ label, format? }], rows: [[...]] }],
 *             (a cell may be { value, format } to override its column's format)
 *     notes:  [string],
 *   }
 *
 * Totals and trends only: no names, emails or per-account rows ever leave this file.
 * Google Analytics parts fail soft (a note instead of numbers) so a GA outage or missing
 * access never hides the database numbers.
 */

const DB = "Database";
const GA = "Google Analytics (live site)";

/*
 * One source of truth per number, so the page never shows two different counts of the same
 * thing:
 *   - Totals (how many chats, reviews, lease checks, contacts) come from the database, which
 *     records every one.
 *   - Google Analytics is used only for what the database cannot see: steps that leave no row
 *     (opened matchmaking, clicked a recommendation) shown as drop-off between steps, and
 *     site traffic. GA misses visitors who block tracking, so its counts run lower; a GA
 *     funnel is read as percentages, not as a second total.
 *   - Vercel Analytics receives the same events but is not read here: it counts visitors
 *     differently, and showing both would put two disagreeing numbers on one page.
 */
const GA_FUNNEL_NOTE =
  "Funnels come from Google Analytics, which only sees visitors who allow tracking, so its counts run lower than the database totals above. Read funnels as drop-off between steps; use the database numbers for totals.";
const DAY = 24 * 60 * 60 * 1000;

const since = (period) => (q) => q.gte("created_at", period.prevStart);
const totals = (period, rows, field) => periodTotals(period, rows, field);
const pct = (part, whole) => (whole ? part / whole : null);
// True when ts falls in [from, to). Compared as dates, not strings: timestamps come back
// with mixed precision and offsets.
const within = (ts, from, to) => {
  const t = new Date(ts).getTime();
  return t >= new Date(from).getTime() && (!to || t < new Date(to).getTime());
};

function gaNote(err) {
  if (!gaConfigured()) {
    return "Google Analytics is not connected yet, so funnel and traffic numbers from the live site are hidden.";
  }
  console.error("[analytics] GA read failed:", err?.message);
  return "Google Analytics could not be reached just now, so its numbers are hidden. The database numbers above are unaffected.";
}

/** GA events as a weekly trend plus a "users who did this" funnel table. */
async function gaFunnel(period, title, steps) {
  const users = await gaEventUsers(period, steps.map((s) => s.event));
  const first = users[steps[0].event];
  return {
    table: {
      title,
      source: GA,
      columns: [
        { label: "Step" },
        { label: "Visitors", format: "number" },
        { label: "% of first step", format: "percent" },
      ],
      rows: steps.map((s) => [s.label, users[s.event], pct(users[s.event], first)]),
    },
  };
}

// ─── Overview ──────────────────────────────────────────────────────────────────

async function overview(period) {
  const [roles, users, liveListings, listingReviews, dormReviews] = await Promise.all([
    lookupIds("roles"),
    fetchAll("users", "id, created_at, role_id", since(period)),
    countRows("listings", (q) => q.is("deleted_at", null).eq("unavailable", false).is("paused_at", null)),
    countRows("listing_reviews", (q) => q.is("deleted_at", null)),
    countRows("dorm_reviews", (q) => q.is("deleted_at", null)),
  ]);
  const ofRole = (name) => users.filter((u) => u.role_id === roles[name]);
  const students = ofRole("student");
  const landlords = ofRole("landlord");
  const t = totals(period, users);

  return {
    tiles: [
      { label: "New accounts", ...t },
      { label: "New student accounts", ...totals(period, students) },
      { label: "New landlord accounts", ...totals(period, landlords) },
      { label: "Live listings today", current: liveListings },
      { label: "Published reviews (all time)", current: listingReviews + dormReviews },
    ],
    trends: [
      {
        title: "New accounts per week",
        source: DB,
        series: [
          { label: "Students", values: weeklyCounts(period, students) },
          { label: "Landlords", values: weeklyCounts(period, landlords) },
        ],
      },
    ],
    tables: [],
    notes: [],
  };
}

// ─── Matchmaking ───────────────────────────────────────────────────────────────

const MATCHMAKING_STEPS = [
  { event: "Matchmaking Opened", label: "Opened matchmaking" },
  { event: "Proxy Chat Started", label: "Started a chat" },
  { event: "Proxy Question Answered", label: "Answered a question" },
  { event: "Proxy Recommendations Shown", label: "Saw recommendations" },
  { event: "Proxy Listing Clicked", label: "Clicked a recommended listing" },
  { event: "Proxy Contact Email Sent", label: "Contacted a landlord from chat" },
];

async function matchmaking(period) {
  const [sessions, formSaves, guestRows] = await Promise.all([
    fetchAll("matchmaking_chat_sessions", "id, user_id, status, created_at", since(period)),
    fetchAll("matchmaking_preferences", "id, created_at", since(period)),
    fetchAll("users", "id", (q) => q.eq("email", "guest@proximity.test")),
  ]);
  // Signed-out chats are stored under one shared guest account (see matchmaking/chat).
  const guestId = guestRows[0]?.id;
  const completed = sessions.filter((s) => s.status === "recommendations_ready");
  const started = totals(period, sessions);
  const done = totals(period, completed);
  const signedIn = (from, to) =>
    new Set(
      sessions
        .filter((s) => s.user_id && s.user_id !== guestId && within(s.created_at, from, to))
        .map((s) => s.user_id)
    ).size;

  const section = {
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
        hint: "Signed-out chats are not counted here because they share one guest account.",
      },
      { label: "Preference form saves", ...totals(period, formSaves), hint: "The older form-based matchmaking flow." },
    ],
    trends: [
      {
        title: "Matchmaking chats per week",
        source: DB,
        series: [
          { label: "Started", values: weeklyCounts(period, sessions) },
          { label: "Reached recommendations", values: weeklyCounts(period, completed) },
        ],
      },
    ],
    tables: [],
    notes: [],
  };

  try {
    section.tables.push((await gaFunnel(period, "Matchmaking funnel", MATCHMAKING_STEPS)).table);
    section.notes.push(GA_FUNNEL_NOTE);
  } catch (err) {
    section.notes.push(gaNote(err));
  }
  return section;
}

// ─── Landlord flow ─────────────────────────────────────────────────────────────

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function listingHealth() {
  const [listings, images, units, leases] = await Promise.all([
    fetchAll("listings", "id, last_verified_at", (q) =>
      q.is("deleted_at", null).eq("unavailable", false).is("paused_at", null)
    ),
    fetchAll("listing_images", "id, listing_id"),
    fetchAll("listing_units", "id, listing_id", (q) => q.is("deleted_at", null)),
    fetchAll("unit_leases", "id, unit_id, rent", (q) => q.is("deleted_at", null).eq("unavailable", false)),
  ]);
  const withPhotos = new Set(images.map((i) => i.listing_id));
  const unitListing = new Map(units.map((u) => [u.id, u.listing_id]));
  // rent 0 or null means "unknown" (see the legacy-lease cleanup), not free.
  const priced = new Set(leases.filter((l) => Number(l.rent) > 0).map((l) => unitListing.get(l.unit_id)));
  const fresh = Date.now() - 60 * DAY;
  const n = listings.length;
  const share = (test) => pct(listings.filter(test).length, n);
  return {
    title: "Listing quality today",
    source: DB,
    columns: [{ label: "Measure" }, { label: "Value" }],
    // Cells carry their own format here because one column mixes a count and shares.
    rows: [
      ["Live listings", { value: n, format: "number" }],
      ["With at least one photo", { value: share((l) => withPhotos.has(l.id)), format: "percent" }],
      ["With a known rent", { value: share((l) => priced.has(l.id)), format: "percent" }],
      [
        "Availability confirmed in the last 60 days",
        { value: share((l) => l.last_verified_at && new Date(l.last_verified_at).getTime() >= fresh), format: "percent" },
      ],
    ],
  };
}

async function landlord(period) {
  const roles = await lookupIds("roles");
  const types = await lookupIds("interaction_types");
  const [landlords, ownerships, listings, interactions, waitlist, checkins, health] = await Promise.all([
    fetchAll("users", "id, created_at", (q) => q.eq("role_id", roles.landlord)),
    fetchAll("listing_landlords", "id, user_id, created_at"),
    fetchAll("listings", "id, created_at, source_kind", since(period)),
    fetchAll("user_listing_interactions", "id, interaction_type_id, created_at", since(period)),
    fetchAll("waitlist_clicks", "id, created_at", since(period)),
    fetchAll("checkin_response_events", "id, choice, created_at", since(period)),
    listingHealth(),
  ]);

  // First listing per landlord account, for activation and time-to-first-listing.
  const firstListing = new Map();
  for (const o of ownerships) {
    const prev = firstListing.get(o.user_id);
    if (!prev || new Date(o.created_at) < new Date(prev)) firstListing.set(o.user_id, o.created_at);
  }
  const landlordIds = new Set(landlords.map((l) => l.id));
  const firsts = [...firstListing]
    .filter(([id]) => landlordIds.has(id))
    .map(([, created_at]) => ({ created_at }));

  const cohort = (from, to) => landlords.filter((l) => within(l.created_at, from, to));
  const activation = (group) => pct(group.filter((l) => firstListing.has(l.id)).length, group.length);
  const current = cohort(period.start);
  const previous = cohort(period.prevStart, period.start);
  const daysToFirst = current
    .filter((l) => firstListing.has(l.id))
    .map((l) => Math.max(0, (new Date(firstListing.get(l.id)) - new Date(l.created_at)) / DAY));

  const contacts = interactions.filter((i) => i.interaction_type_id === types.contacted);
  const saves = interactions.filter((i) => i.interaction_type_id === types.saved);

  const countBy = (rows, key) => {
    const m = new Map();
    for (const r of rows) {
      if (!within(r.created_at, period.start)) continue;
      const k = r[key] || "not recorded";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };

  return {
    tiles: [
      { label: "New landlord accounts", current: current.length, previous: previous.length },
      {
        label: "Landlords who added a listing",
        current: activation(current),
        previous: activation(previous),
        format: "percent",
        hint: "Of the landlord accounts created in this period, the share that own at least one listing.",
      },
      {
        label: "Median days from sign-up to first listing",
        current: median(daysToFirst),
        format: "days",
        hint: "For landlords who signed up in this period and have added a listing.",
      },
      { label: "Listings added", ...totals(period, listings) },
      { label: "Contacts sent to landlords", ...totals(period, contacts) },
    ],
    trends: [
      {
        title: "Landlord supply per week",
        source: DB,
        series: [
          { label: "New landlord accounts", values: weeklyCounts(period, landlords) },
          { label: "Landlords' first listing", values: weeklyCounts(period, firsts) },
          { label: "Listings added", values: weeklyCounts(period, listings) },
        ],
      },
      {
        title: "Student demand sent to landlords per week",
        source: DB,
        series: [
          { label: "Contacts", values: weeklyCounts(period, contacts) },
          { label: "Saves", values: weeklyCounts(period, saves) },
          { label: "Waitlist sign-ups", values: weeklyCounts(period, waitlist) },
        ],
      },
      {
        title: "Availability check-in responses per week",
        source: DB,
        series: [{ label: "Responses", values: weeklyCounts(period, checkins) }],
      },
    ],
    tables: [
      health,
      {
        title: "How listings were added (this period)",
        source: DB,
        columns: [{ label: "Source" }, { label: "Listings", format: "number" }],
        rows: countBy(listings, "source_kind"),
      },
      {
        title: "Check-in answers (this period)",
        source: DB,
        columns: [{ label: "Answer" }, { label: "Responses", format: "number" }],
        rows: countBy(checkins, "choice"),
      },
    ],
    notes: [
      "The add-listing form does not record its individual steps yet, so this shows finished listings, not where landlords drop off.",
    ],
  };
}

// ─── Listing engagement ────────────────────────────────────────────────────────

async function engagement(period) {
  const metricTypes = await lookupIds("metric_types");
  const daily = await fetchAll(
    "listing_metrics_daily",
    "id, recorded_date, count, metric_type_id",
    (q) => q.gte("recorded_date", period.prevStart.slice(0, 10))
  );
  const ofType = (name) => daily.filter((d) => d.metric_type_id === metricTypes[name]);
  const weight = (r) => r.count;
  const series = (name) => weeklyCounts(period, ofType(name), "recorded_date", weight);
  const tile = (label, name) => ({ label, ...periodTotals(period, ofType(name), "recorded_date", weight) });

  return {
    tiles: [tile("Listing views", "clicks"), tile("Saves", "saves"), tile("Contacts", "contacts")],
    trends: [
      {
        title: "Listing engagement per week",
        source: DB,
        series: [
          { label: "Views", values: series("clicks") },
          { label: "Saves", values: series("saves") },
          { label: "Contacts", values: series("contacts") },
        ],
      },
    ],
    tables: [],
    notes: [],
  };
}

// ─── Reviews ───────────────────────────────────────────────────────────────────

// The /review flow (QR codes and invites). "Review Submitted" is a different flow (the review
// box on a listing page) and is not a step here.
const REVIEW_STEPS = [
  { event: "qr_review_start", label: "Opened the review page from a QR code" },
  { event: "review_account_started", label: "Started creating an account" },
  { event: "review_submitted", label: "Submitted a review" },
];

async function reviews(period) {
  const [listingReviews, dormReviews, invites] = await Promise.all([
    fetchAll("listing_reviews", "id, created_at", since(period)),
    fetchAll("dorm_reviews", "id, created_at", since(period)),
    fetchAll("review_invites", "id, sent_at, used_at", (q) => q.gte("sent_at", period.prevStart)),
  ]);
  const usedInvites = invites.filter((i) => i.used_at);
  const section = {
    tiles: [
      { label: "Apartment reviews", ...totals(period, listingReviews) },
      { label: "Dorm reviews", ...totals(period, dormReviews) },
      { label: "Review invites sent", ...periodTotals(period, invites, "sent_at") },
      { label: "Invites used", ...periodTotals(period, usedInvites, "used_at") },
    ],
    trends: [
      {
        title: "Reviews per week",
        source: DB,
        series: [
          { label: "Apartment reviews", values: weeklyCounts(period, listingReviews) },
          { label: "Dorm reviews", values: weeklyCounts(period, dormReviews) },
        ],
      },
    ],
    tables: [],
    notes: [],
  };
  try {
    section.tables.push((await gaFunnel(period, "Review funnel (QR code flow)", REVIEW_STEPS)).table);
    section.notes.push(GA_FUNNEL_NOTE);
  } catch (err) {
    section.notes.push(gaNote(err));
  }
  return section;
}

// ─── Lease check ───────────────────────────────────────────────────────────────

const LEASE_STEPS = [
  { event: "Lease Check Started", label: "Started a lease check" },
  { event: "Lease Check Auth Prompted", label: "Asked to sign in" },
  { event: "Lease Check Completed", label: "Got a result" },
  { event: "Lease Check Questions Copied", label: "Copied the questions" },
  { event: "Lease Check Failed", label: "Hit an error" },
];

async function leaseCheck(period) {
  const checks = await fetchAll("lease_checks", "id, created_at", since(period));
  const section = {
    tiles: [{ label: "Lease checks saved", ...totals(period, checks) }],
    trends: [
      {
        title: "Lease checks per week",
        source: DB,
        series: [{ label: "Lease checks", values: weeklyCounts(period, checks) }],
      },
    ],
    tables: [],
    notes: [],
  };
  try {
    section.tables.push((await gaFunnel(period, "Lease check funnel", LEASE_STEPS)).table);
    section.notes.push(GA_FUNNEL_NOTE);
  } catch (err) {
    section.notes.push(gaNote(err));
  }
  return section;
}

// ─── Traffic ───────────────────────────────────────────────────────────────────

async function traffic(period) {
  const section = { tiles: [], trends: [], tables: [], notes: [] };
  try {
    const t = await gaTraffic(period);
    section.tiles.push(
      { label: "Visitors", ...t.visitors },
      { label: "Visits", ...t.sessionTotals },
      { label: "Page views", ...t.pageViewTotals }
    );
    section.trends.push({
      title: "Traffic per week",
      source: GA,
      series: [
        { label: "Visits", values: t.sessions },
        { label: "Page views", values: t.pageViews },
      ],
    });
  } catch (err) {
    section.notes.push(gaNote(err));
  }

  if (gscConfigured()) {
    try {
      const gsc = await fetchGscWindows();
      const add = (rows, key) => sum(rows.map((r) => r[key]));
      section.tables.push({
        title: `Google search, last 28 days (${gsc.currentRange.start} to ${gsc.currentRange.end})`,
        source: "Google Search Console",
        columns: [
          { label: "Measure" },
          { label: "Last 28 days", format: "number" },
          { label: "28 days before", format: "number" },
        ],
        rows: [
          ["Clicks from Google", add(gsc.current, "clicks"), add(gsc.previous, "clicks")],
          ["Times shown in Google", add(gsc.current, "impressions"), add(gsc.previous, "impressions")],
        ],
      });
    } catch (err) {
      console.error("[analytics] GSC read failed:", err?.message);
      section.notes.push("Google Search Console could not be reached just now.");
    }
  }
  section.notes.push(
    "Traffic comes from Google Analytics only. Vercel Analytics counts visitors differently, so its numbers will not match these; treat this page as the reference."
  );
  return section;
}

export const SECTION_LOADERS = {
  overview,
  matchmaking,
  landlord,
  engagement,
  reviews,
  leaseCheck,
  traffic,
};
