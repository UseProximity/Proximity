/*
 * The admin dashboard's record pages (Wyatt, 2026-11-12): everything Proximity
 * knows about one person or one listing, gathered in one read so the team does
 * not have to visit seven views to answer "what is going on with this landlord".
 *
 *   loadUserRecord(db, id)       profile, stage, listings, conversations, tours,
 *                                reviews, emails, search activity, what they changed
 *   loadUserBilling(db, id)      a landlord's agreement, payment and invoices
 *                                (super only; slow, so the page asks separately)
 *   loadListingRecord(db, id)    status, agent, website sync, conversations,
 *                                tours, questions, 30 day numbers, coverage
 *   searchRecords(db, q)         people and listings by name, email or address
 *
 * Every function takes the database client, so a page follows the dev/prod switch.
 */
import { stripSecrets } from "@/lib/security/secretColumns";
import { loadLandlordOverview } from "@/lib/billing/landlordOverview";
import { HIDDEN_RENT_MAX_AGE_DAYS } from "@/lib/listings/hiddenRents";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID.test(String(v ?? ""));

const TEST_EMAIL = /@proximity\.test$/i;
const rows = (r) => r?.data ?? [];
const listingLabel = (l) => (l ? l.title || l.address || null : null);

// What is live comes first on a landlord's record; deleted listings last.
const STATE_ORDER = ["published", "hidden", "draft", "deleted", "unknown"];

function listingState(l) {
  if (!l) return "unknown";
  if (l.deleted_at) return "deleted";
  if (!l.published_at) return "draft";
  if (l.unavailable) return "hidden";
  return "published";
}

const THREAD_SELECT = "id, listing_id, subject, created_at, updated_at, deleted_at, interested_user_id, landlord_id, visitor_id, thread_types!thread_type_id(name), listings!listing_id(id, title, address)";
const TOUR_SELECT = "id, listing_id, student_id, landlord_id, status, confirmed_slot, cancel_reason, thread_id, proxy_thread_id, created_at, last_activity_at, listings!listing_id(id, title, address)";

async function namesFor(db, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map();
  const { data } = await db.from("users").select("id, name, email").in("id", wanted);
  return new Map((data ?? []).map((u) => [u.id, { id: u.id, name: u.name ?? null, email: u.email ?? null }]));
}

const shapeThread = (t, people) => ({
  id: t.id,
  kind: t.thread_types?.name === "direct" ? "direct" : "proxy",
  listing: t.listings ? { id: t.listings.id, label: listingLabel(t.listings) } : null,
  student: t.interested_user_id ? people.get(t.interested_user_id) ?? { id: t.interested_user_id } : null,
  visitor: !t.interested_user_id && !!t.visitor_id,
  landlord: t.landlord_id ? people.get(t.landlord_id) ?? { id: t.landlord_id } : null,
  lastActivityAt: t.updated_at ?? t.created_at,
  deleted: !!t.deleted_at,
});

const shapeTour = (t, people) => ({
  id: t.id,
  status: t.status,
  listing: t.listings ? { id: t.listings.id, label: listingLabel(t.listings) } : null,
  student: people.get(t.student_id) ?? (t.student_id ? { id: t.student_id } : null),
  landlord: people.get(t.landlord_id) ?? (t.landlord_id ? { id: t.landlord_id } : null),
  confirmedSlot: t.confirmed_slot,
  cancelReason: t.cancel_reason,
  threadId: t.thread_id,
  proxyThreadId: t.proxy_thread_id,
  lastActivityAt: t.last_activity_at ?? t.created_at,
});

// changed_fields is { column: { old, new } }; the page lists the column names.
const fieldNames = (f) => (Array.isArray(f) ? f : f && typeof f === "object" ? Object.keys(f) : []).filter((k) => k !== "updated_at");
const shapeActivity = (a) => ({ id: a.id, table: a.table_name, recordId: a.record_id, event: a.event_type, fields: fieldNames(a.changed_fields), at: a.changed_at });

/*
 * Where someone is, worked out from what they have done. Never set by hand, so
 * it cannot drift from the truth (Wyatt, 2026-11-12).
 */
function landlordStage({ listings, hasPassword, user }) {
  const live = listings.filter((l) => l.state === "published").length;
  if (live) return { key: "live", label: "Live", detail: `${live} published listing${live === 1 ? "" : "s"}` };
  if (listings.some((l) => l.state === "hidden")) return { key: "hidden", label: "Listed, hidden", detail: "Has listings, none showing" };
  if (listings.some((l) => l.state === "draft")) return { key: "drafting", label: "Drafting", detail: "Has a draft, nothing published" };
  if (!hasPassword && !user.google_account && !user.apple_account) return { key: "invited", label: "Invited", detail: "Account made for them, no password yet" };
  return { key: "new", label: "New", detail: "Signed up, no listings" };
}

function studentStage({ user, tours, threads, sessions, interactions, reviews }) {
  if (tours.some((t) => t.status === "confirmed")) return { key: "touring", label: "Tour booked", detail: "Has a confirmed tour" };
  if (tours.length) return { key: "tour_requested", label: "Tour requested", detail: "Asked for a tour" };
  if (threads.some((t) => t.kind === "direct")) return { key: "talking", label: "In conversation", detail: "Messaging a landlord" };
  if (threads.length || sessions.total || interactions.saved || interactions.contacted) return { key: "searching", label: "Searching", detail: "Saving, matching or asking Proxy" };
  if (reviews.length) return { key: "reviewer", label: "Reviewer", detail: "Wrote a review, not searching" };
  if (!user.profile_complete) return { key: "incomplete", label: "Signed up", detail: "Profile not finished" };
  return { key: "browsing", label: "Browsing", detail: "Signed up, no activity yet" };
}

export async function loadUserRecord(db, id) {
  const { data: raw, error } = await db.from("users").select("*, roles!role_id(name)").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!raw) return null;
  const role = raw.roles?.name ?? "student";
  const hasPassword = !!raw.password_hash;
  const user = stripSecrets(raw);
  const emailFilter = raw.email ? `user_id.eq.${id},to_email.eq."${String(raw.email).replace(/"/g, "")}"` : `user_id.eq.${id}`;

  const [owned, threadRows, tourRows, reviewRows, emailRows, emailCount, sessionRows, sessionCount, searchCount, leaseChecks, interactionRows, activity] = await Promise.all([
    db.from("listing_landlords").select("listing_id, is_primary, claimed_at, listings!listing_id(id, title, address, published_at, deleted_at, unavailable, review_sandbox, min_rent, max_rent)").eq("user_id", id),
    db.from("chat_threads").select(THREAD_SELECT).or(`interested_user_id.eq.${id},landlord_id.eq.${id}`).order("updated_at", { ascending: false }).limit(40),
    db.from("tour_requests").select(TOUR_SELECT).or(`student_id.eq.${id},landlord_id.eq.${id}`).order("created_at", { ascending: false }).limit(40),
    db.from("listing_reviews").select("id, rating, comment, legitimacy, anonymous, deleted_at, created_at, listings!listing_id(id, title, address)").eq("user_id", id).order("created_at", { ascending: false }).limit(40),
    db.from("sent_emails").select("id, created_at, category, kind, subject, status, to_email").or(emailFilter).order("created_at", { ascending: false }).limit(15),
    db.from("sent_emails").select("id", { count: "exact", head: true }).or(emailFilter),
    db.from("matchmaking_chat_sessions").select("id, status, created_at, updated_at").eq("user_id", id).order("updated_at", { ascending: false }).limit(5),
    db.from("matchmaking_chat_sessions").select("id", { count: "exact", head: true }).eq("user_id", id),
    db.from("matchmaking_chat_sessions").select("id", { count: "exact", head: true }).eq("user_id", id).not("preferences->_fyp", "is", null),
    db.from("lease_checks").select("id, file_name, created_at, deleted_at").eq("user_id", id).order("created_at", { ascending: false }).limit(5),
    db.from("user_listing_interactions").select("interaction_types!interaction_type_id(name)").eq("user_id", id).limit(2000),
    db.from("action_log").select("id, table_name, record_id, event_type, changed_fields, changed_at").eq("changed_by_id", id).order("changed_at", { ascending: false }).limit(15),
  ]);

  const people = await namesFor(db, [...rows(threadRows).flatMap((t) => [t.interested_user_id, t.landlord_id]), ...rows(tourRows).flatMap((t) => [t.student_id, t.landlord_id])]);
  const listings = rows(owned).filter((o) => o.listings).map((o) => ({
    id: o.listings.id, label: listingLabel(o.listings), state: listingState(o.listings), primary: !!o.is_primary,
    test: !!o.listings.review_sandbox, minRent: o.listings.min_rent, maxRent: o.listings.max_rent, claimedAt: o.claimed_at,
  })).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || String(a.label).localeCompare(String(b.label), "en", { numeric: true }));
  const threads = rows(threadRows).map((t) => shapeThread(t, people));
  const tours = rows(tourRows).map((t) => shapeTour(t, people));
  const reviews = rows(reviewRows).map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, verified: !!r.legitimacy, anonymous: !!r.anonymous, deleted: !!r.deleted_at, createdAt: r.created_at, listing: r.listings ? { id: r.listings.id, label: listingLabel(r.listings) } : null }));
  const interactions = { saved: 0, contacted: 0, clicked: 0 };
  for (const i of rows(interactionRows)) {
    const name = i.interaction_types?.name;
    if (name in interactions) interactions[name] += 1;
  }
  // Find Your Place searches and mobile Proxy chats share the table; the
  // searches are the rows marked preferences._fyp.
  const total = sessionCount?.count ?? rows(sessionRows).length;
  const sessions = { total, searches: Math.min(searchCount?.count ?? 0, total), recent: rows(sessionRows).map((s) => ({ id: s.id, status: s.status, updatedAt: s.updated_at ?? s.created_at })) };

  const isLandlordish = role === "landlord" || listings.length > 0;
  const stage = isLandlordish
    ? landlordStage({ listings, hasPassword, user: raw })
    : role === "student" ? studentStage({ user: raw, tours, threads, sessions, interactions, reviews }) : null;

  return {
    user: { ...user, role },
    flags: { deleted: !!raw.deleted_at, incomplete: !raw.profile_complete, system: !!raw.is_system, test: !!raw.review_sandbox || TEST_EMAIL.test(raw.email ?? ""), billingOnly: raw.billing_only === true, hasPassword, unverified: raw.email_verified === false },
    stage,
    listings,
    threads,
    tours,
    reviews,
    emails: { total: emailCount?.count ?? rows(emailRows).length, recent: rows(emailRows).map((e) => ({ id: e.id, at: e.created_at, category: e.category, kind: e.kind, subject: e.subject, status: e.status, to: e.to_email })) },
    search: { sessions, interactions, leaseChecks: rows(leaseChecks).map((c) => ({ id: c.id, fileName: c.file_name, at: c.created_at, deleted: !!c.deleted_at })) },
    activity: rows(activity).map(shapeActivity),
  };
}

/* One landlord's row from the Billing overview, or null when they are not on it. */
export async function loadUserBilling(db, id) {
  const { allRows } = await loadLandlordOverview(db, {});
  const row = (allRows ?? []).find((r) => r.id === id);
  if (!row) return null;
  return {
    agreement: row.agreement, payment: row.payment, invoices: row.invoices, publishing: row.publishing, autopay: row.autopay ? true : false,
    payer: row.payer, paysForCount: row.paysForCount, hasLiveListing: row.hasLiveListing,
    coverage: { covered: row.coverage?.coveredCount ?? 0, uncovered: row.coverage?.uncovered?.length ?? 0, liveProperties: row.coverage?.liveProperties ?? 0 },
  };
}

export async function loadListingRecord(db, id, { isSuper = false } = {}) {
  const { data: listing, error } = await db.from("listings")
    .select("id, title, address, city, state, published_at, deleted_at, unavailable, review_sandbox, source_url, source_kind, property_key, contact_name, contact_email, created_at, updated_at")
    .eq("id", id).maybeSingle();
  if (error) throw error;
  if (!listing) return null;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [agent, factCount, monitors, threadRows, tourRows, questions, metrics, coverage, activity, hiddenRents] = await Promise.all([
    db.from("listing_agents").select("status, seeded_at, last_sync_at").eq("listing_id", id).maybeSingle(),
    db.from("listing_facts").select("id", { count: "exact", head: true }).eq("listing_id", id).eq("is_current", true),
    db.from("listing_source_monitors").select("id, source_url, source_kind, enabled, last_status, last_error, last_checked_at, consecutive_failures, next_check_at, muted_until").eq("listing_id", id),
    db.from("chat_threads").select(THREAD_SELECT).eq("listing_id", id).order("updated_at", { ascending: false }).limit(40),
    db.from("tour_requests").select(TOUR_SELECT).eq("listing_id", id).order("created_at", { ascending: false }).limit(40),
    db.from("listing_questions").select("status").eq("listing_id", id).limit(1000),
    db.from("listing_metrics_daily").select("count, metric_types!metric_type_id(name)").eq("listing_id", id).gte("recorded_date", since).limit(2000),
    isSuper ? db.from("agreement_coverage").select("id, user_id, status, covered_at, whole_building, units").eq("listing_id", id) : { data: [] },
    db.from("action_log").select("id, table_name, record_id, event_type, changed_fields, changed_at, changed_by_id").eq("table_name", "listings").eq("record_id", id).order("changed_at", { ascending: false }).limit(15),
    // Website prices kept hidden on unpriced leases (lib/listings/hiddenRents.js). Admins only.
    db.from("lease_hidden_rents").select("lease_id, rent, rent_is_per_person, seen_at, unit_leases!lease_id(rent, unavailable, listing_units!unit_id(name, bedrooms, bathrooms))").eq("listing_id", id).limit(200),
  ]);
  const hiddenFresh = Date.now() - HIDDEN_RENT_MAX_AGE_DAYS * 86400000;

  const people = await namesFor(db, [
    ...rows(threadRows).flatMap((t) => [t.interested_user_id, t.landlord_id]),
    ...rows(tourRows).flatMap((t) => [t.student_id, t.landlord_id]),
    ...rows(coverage).map((c) => c.user_id),
    ...rows(activity).map((a) => a.changed_by_id),
  ]);
  const numbers = { clicks: 0, saves: 0, contacts: 0 };
  for (const m of rows(metrics)) {
    const name = m.metric_types?.name;
    if (name in numbers) numbers[name] += Number(m.count ?? 0);
  }
  const questionCounts = {};
  for (const q of rows(questions)) questionCounts[q.status] = (questionCounts[q.status] ?? 0) + 1;

  return {
    listing: { ...listing, label: listingLabel(listing), state: listingState(listing), test: !!listing.review_sandbox },
    agent: agent?.data ? { status: agent.data.status, seededAt: agent.data.seeded_at, lastSyncAt: agent.data.last_sync_at, facts: factCount?.count ?? 0 } : null,
    monitors: rows(monitors).map((m) => ({ id: m.id, url: m.source_url, kind: m.source_kind, enabled: !!m.enabled, status: m.last_status, error: m.last_error, checkedAt: m.last_checked_at, failures: m.consecutive_failures ?? 0, nextCheckAt: m.next_check_at, mutedUntil: m.muted_until })),
    threads: rows(threadRows).map((t) => shapeThread(t, people)),
    tours: rows(tourRows).map((t) => shapeTour(t, people)),
    questions: questionCounts,
    numbers,
    coverage: isSuper ? rows(coverage).map((c) => ({ id: c.id, owner: people.get(c.user_id) ?? { id: c.user_id }, status: c.status, coveredAt: c.covered_at, wholeBuilding: !!c.whole_building, units: c.units ?? null })) : null,
    activity: rows(activity).map((a) => ({ ...shapeActivity(a), by: a.changed_by_id ? people.get(a.changed_by_id) ?? { id: a.changed_by_id } : null })),
    hiddenPrices: rows(hiddenRents)
      .map((h) => {
        const u = h.unit_leases?.listing_units;
        return {
          leaseId: h.lease_id,
          unit: u?.name || (u ? `${u.bedrooms ?? "?"} bed / ${u.bathrooms ?? "?"} bath` : "Unit"),
          rent: Number(h.rent),
          perPerson: h.rent_is_per_person,
          seenAt: h.seen_at,
          stale: new Date(h.seen_at).getTime() < hiddenFresh,
          // A public price now set by the landlord wins; the hidden one is unused.
          overridden: Number(h.unit_leases?.rent) > 0,
          withdrawn: !!h.unit_leases?.unavailable,
        };
      })
      .sort((a, b) => a.unit.localeCompare(b.unit, undefined, { numeric: true })),
  };
}

/* People and listings matching what was typed. A pasted id finds its record. */
export async function searchRecords(db, query) {
  const q = String(query ?? "").trim();
  if (q.length < 2) return { people: [], listings: [] };
  // Characters that mean something in a PostgREST filter are dropped.
  const safe = q.replace(/[,()%*\\"]/g, " ").trim();
  if (!safe) return { people: [], listings: [] };
  const like = `%${safe}%`;

  const [people, listings] = await Promise.all([
    (isUuid(q)
      ? db.from("users").select("id, name, email, deleted_at, roles!role_id(name)").eq("id", q)
      : db.from("users").select("id, name, email, deleted_at, roles!role_id(name)").or(`name.ilike.${like},email.ilike.${like},company_name.ilike.${like}`).order("created_at", { ascending: false }).limit(8)),
    (isUuid(q)
      ? db.from("listings").select("id, title, address, published_at, deleted_at, unavailable").eq("id", q)
      : db.from("listings").select("id, title, address, published_at, deleted_at, unavailable").or(`title.ilike.${like},address.ilike.${like}`).order("deleted_at", { ascending: true, nullsFirst: true }).limit(8)),
  ]);
  if (people.error) throw people.error;
  if (listings.error) throw listings.error;
  return {
    people: rows(people).map((u) => ({ id: u.id, name: u.name ?? null, email: u.email ?? null, role: u.roles?.name ?? "student", deleted: !!u.deleted_at })),
    listings: rows(listings).map((l) => ({ id: l.id, label: listingLabel(l), address: l.title ? l.address : null, state: listingState(l) })),
  };
}
