/*
 * The admin dashboard's plain lists (Wyatt, 2026-11-14): state the team could
 * only reach with raw SQL (reports and flags, email suppressions, import and
 * sync health, billing history, student activity, PMS, the activity log).
 * Each list is one entry here: a title, its columns, a loader and any actions.
 * One route (/api/admin/lists/[name]) and one page component serve them all,
 * so a new list is added in this file only.
 *
 *   load(db)            { rows, filters?, defaultFilter? }
 *   row                 { id, filter?, actions?: [key], cells: { column: cell } }
 *   cell                a string, or one of the shapes built by the helpers
 *                       below (person, listing, badge, date, link, lines)
 *   actions[key]        { label, confirm?, ownOnly?, run(db, id) }
 *                       ownOnly actions refuse when the dashboard is switched
 *                       to the other environment's database
 *
 * Lists show the newest LIMIT rows; the page says so when it is cut off.
 */
import { loadScheduledJobs } from "@/lib/admin/jobs";

const LIMIT = 500;
const rowsOf = (r) => {
  if (r?.error) throw r.error;
  return r?.data ?? [];
};

// ── cells ───────────────────────────────────────────────────────────────────
const person = (u, fallback = null) => (u ? { t: "person", id: u.id, label: u.name || u.email || "Unnamed account", sub: u.name ? u.email ?? null : null } : fallback);
const listing = (l) => (l ? { t: "listing", id: l.id, label: l.title || l.address || "Untitled listing" } : null);
const badge = (label, color = "gray") => (label == null ? null : { t: "badge", label: String(label).replace(/_/g, " "), color });
const date = (iso) => (iso ? { t: "date", at: iso } : null);
const link = (path, params, label) => ({ t: "link", path, params, label });
const lines = (text, sub = null) => (text == null && sub == null ? null : { t: "lines", text: text == null ? null : String(text), sub: sub == null ? null : String(sub) });
const money = (cents) => (cents == null ? null : `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const threadLink = (id, tab = "direct") => (id ? link("conversations", { tab, thread: id }, "Open conversation") : null);

// ── lookups ─────────────────────────────────────────────────────────────────
async function peopleBy(db, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  const map = new Map();
  for (let i = 0; i < wanted.length; i += 200) {
    const { data } = await db.from("users").select("id, name, email").in("id", wanted.slice(i, i + 200));
    for (const u of data ?? []) map.set(u.id, u);
  }
  return map;
}

async function listingsBy(db, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  const map = new Map();
  for (let i = 0; i < wanted.length; i += 200) {
    const { data } = await db.from("listings").select("id, title, address").in("id", wanted.slice(i, i + 200));
    for (const l of data ?? []) map.set(l.id, l);
  }
  return map;
}

/* Rows of `table` keyed by id, fetched 200 ids at a time so the request URL stays short. */
async function rowsById(db, table, select, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  const map = new Map();
  for (let i = 0; i < wanted.length; i += 200) {
    for (const row of rowsOf(await db.from(table).select(select).in("id", wanted.slice(i, i + 200)))) map.set(row.id, row);
  }
  return map;
}

const newest = (db, table, select, column = "created_at") => db.from(table).select(select).order(column, { ascending: false }).limit(LIMIT);

// Mark something looked at, or put it back in the queue.
const reviewActions = (table) => ({
  review: { label: "Mark reviewed", run: async (db, id) => rowsOf(await db.from(table).update({ reviewed_at: new Date().toISOString() }).eq("id", id).select("id")) },
  reopen: { label: "Reopen", run: async (db, id) => rowsOf(await db.from(table).update({ reviewed_at: null }).eq("id", id).select("id")) },
});
const REVIEW_FILTERS = { filters: [{ key: "open", label: "To review" }, { key: "reviewed", label: "Reviewed" }], defaultFilter: "open" };
const reviewState = (r) => ({ filter: r.reviewed_at ? "reviewed" : "open", actions: [r.reviewed_at ? "reopen" : "review"] });

const IMPORT_COLORS = { failed: "red", done: "green", running: "blue", queued: "amber", cancelled: "gray" };
const SYNC_BAD = new Set(["fetch_failed", "parse_failed", "gone", "url_stale"]);

export const LISTS = {
  // ── Safety ────────────────────────────────────────────────────────────────
  "chat-flags": {
    title: "Flagged and blocked messages",
    note: "Messages the safety filter flagged (sent, but marked) or blocked (never delivered).",
    columns: [["when", "When"], ["who", "Sender"], ["action", "What happened"], ["why", "Why"], ["excerpt", "Message"], ["listing", "Listing"], ["open", ""]],
    actions: reviewActions("chat_moderation_events"),
    async load(db) {
      const rows = rowsOf(await newest(db, "chat_moderation_events", "id, user_id, thread_id, listing_id, action, reasons, body_excerpt, created_at, reviewed_at"));
      const [people, listings] = await Promise.all([peopleBy(db, rows.map((r) => r.user_id)), listingsBy(db, rows.map((r) => r.listing_id))]);
      return {
        ...REVIEW_FILTERS,
        rows: rows.map((r) => ({
          id: r.id, ...reviewState(r),
          cells: { when: date(r.created_at), who: person(people.get(r.user_id), "Signed-out visitor"), action: badge(r.action === "block" ? "blocked" : "flagged", r.action === "block" ? "red" : "amber"), why: (Array.isArray(r.reasons) ? r.reasons : []).join(", ").replace(/_/g, " "), excerpt: r.body_excerpt, listing: listing(listings.get(r.listing_id)), open: threadLink(r.thread_id) },
        })),
      };
    },
  },
  "chat-reports": {
    title: "Reported conversations",
    note: "Reports people filed from a chat. Nothing emails the team about these, so this list is the only place they show.",
    columns: [["when", "When"], ["reporter", "Reported by"], ["reported", "About"], ["reason", "Reason"], ["excerpt", "Message"], ["open", ""]],
    actions: reviewActions("chat_reports"),
    async load(db) {
      const rows = rowsOf(await newest(db, "chat_reports", "id, reporter_id, reported_user_id, thread_id, reason, message_excerpt, created_at, reviewed_at"));
      const people = await peopleBy(db, rows.flatMap((r) => [r.reporter_id, r.reported_user_id]));
      return {
        ...REVIEW_FILTERS,
        rows: rows.map((r) => ({ id: r.id, ...reviewState(r), cells: { when: date(r.created_at), reporter: person(people.get(r.reporter_id)), reported: person(people.get(r.reported_user_id)), reason: badge(r.reason, "red"), excerpt: r.message_excerpt, open: threadLink(r.thread_id) } })),
      };
    },
  },
  "listing-reports": {
    title: "Reported listings",
    note: "Reports people filed against a listing. Nothing emails the team about these either.",
    columns: [["when", "When"], ["reporter", "Reported by"], ["listing", "Listing"], ["reason", "Reason"], ["details", "Details"]],
    actions: reviewActions("listing_reports"),
    async load(db) {
      const rows = rowsOf(await newest(db, "listing_reports", "id, reporter_id, listing_id, reason, details, created_at, reviewed_at"));
      const [people, listings] = await Promise.all([peopleBy(db, rows.map((r) => r.reporter_id)), listingsBy(db, rows.map((r) => r.listing_id))]);
      return {
        ...REVIEW_FILTERS,
        rows: rows.map((r) => ({ id: r.id, ...reviewState(r), cells: { when: date(r.created_at), reporter: person(people.get(r.reporter_id)), listing: listing(listings.get(r.listing_id)), reason: badge(r.reason, "red"), details: r.details } })),
      };
    },
  },
  "review-reports": {
    title: "Reported reviews",
    note: "Each report also emails the team. Take a review down from Reviews > Listing reviews.",
    columns: [["when", "When"], ["reporter", "Reported by"], ["review", "Review"], ["author", "Written by"], ["listing", "Listing"], ["open", ""]],
    async load(db) {
      const rows = rowsOf(await newest(db, "review_reports", "id, reporter_id, review_id, reported_user_id, created_at"));
      const reviews = await rowsById(db, "listing_reviews", "id, rating, comment, deleted_at, listing_id", rows.map((r) => r.review_id));
      const [people, listings] = await Promise.all([peopleBy(db, rows.flatMap((r) => [r.reporter_id, r.reported_user_id])), listingsBy(db, [...reviews.values()].map((v) => v.listing_id))]);
      return {
        rows: rows.map((r) => {
          const v = reviews.get(r.review_id);
          return { id: r.id, cells: { when: date(r.created_at), reporter: person(people.get(r.reporter_id)), review: v ? lines(`${v.rating} stars${v.deleted_at ? " (already removed)" : ""}`, v.comment) : "Review no longer exists", author: person(people.get(r.reported_user_id)), listing: listing(listings.get(v?.listing_id)), open: v ? link("reviews", { q: v.id }, "Open review") : null } };
        }),
      };
    },
  },
  "reply-reports": {
    title: "Reported landlord replies",
    note: "Reports against a landlord's reply to a review.",
    columns: [["when", "When"], ["reporter", "Reported by"], ["reply", "Reply"], ["author", "Written by"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "review_reply_reports", "id, reporter_id, reply_id, reported_user_id, created_at"));
      const replies = await rowsById(db, "listing_review_replies", "id, reply", rows.map((r) => r.reply_id));
      const people = await peopleBy(db, rows.flatMap((r) => [r.reporter_id, r.reported_user_id]));
      return { rows: rows.map((r) => ({ id: r.id, cells: { when: date(r.created_at), reporter: person(people.get(r.reporter_id)), reply: replies.get(r.reply_id)?.reply ?? "Reply no longer exists", author: person(people.get(r.reported_user_id)) } })) };
    },
  },
  "user-blocks": {
    title: "Blocks",
    note: "Who has blocked whom. A block hides the other person's messages and reviews from the blocker.",
    columns: [["when", "When"], ["blocker", "Blocked by"], ["blocked", "Blocked"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "user_blocks", "blocker_id, blocked_id, created_at"));
      const people = await peopleBy(db, rows.flatMap((r) => [r.blocker_id, r.blocked_id]));
      return { rows: rows.map((r) => ({ id: `${r.blocker_id}:${r.blocked_id}`, cells: { when: date(r.created_at), blocker: person(people.get(r.blocker_id)), blocked: person(people.get(r.blocked_id)) } })) };
    },
  },

  // ── Emailed replies that did not post ─────────────────────────────────────
  "held-replies": {
    title: "Held and refused email replies",
    note: "Replies sent by email that did not reach the chat. Held ones wait for someone to approve the sender; open the conversation to approve, decline or re-run.",
    columns: [["when", "When"], ["from", "From"], ["status", "Status"], ["why", "Why"], ["preview", "What they wrote"], ["open", ""]],
    async load(db) {
      const rows = rowsOf(await db.from("chat_inbound_emails").select("id, from_email, sender_name, thread_id, status, reason, body_preview, created_at")
        .in("status", ["held", "wrong_sender", "unauthenticated", "unknown_address", "rejected", "error"]).order("created_at", { ascending: false }).limit(LIMIT));
      return {
        filters: [{ key: "held", label: "Held for approval" }, { key: "refused", label: "Refused" }],
        defaultFilter: "held",
        rows: rows.map((r) => ({ id: r.id, filter: r.status === "held" ? "held" : "refused", cells: { when: date(r.created_at), from: lines(r.sender_name || r.from_email, r.sender_name ? r.from_email : null), status: badge(r.status, r.status === "held" ? "amber" : "red"), why: r.reason, preview: r.body_preview, open: threadLink(r.thread_id) } })),
      };
    },
  },

  // ── Email ─────────────────────────────────────────────────────────────────
  "email-suppressions": {
    title: "Suppressed addresses",
    note: "Addresses we no longer email at all, chat alerts included, because a message bounced or was marked as spam. Remove one only when you know the address works again.",
    columns: [["email", "Address"], ["reason", "Why"], ["detail", "Detail"], ["when", "Since"]],
    actions: { remove: { label: "Remove", confirm: "Start emailing this address again?", run: async (db, id) => rowsOf(await db.from("email_suppressions").delete().eq("email", id).select("email")) } },
    async load(db) {
      const rows = rowsOf(await newest(db, "email_suppressions", "email, reason, detail, created_at"));
      return { rows: rows.map((r) => ({ id: r.email, actions: ["remove"], cells: { email: r.email, reason: badge(r.reason, "red"), detail: r.detail, when: date(r.created_at) } })) };
    },
  },
  "email-unsubscribes": {
    title: "Unsubscribed from mass email",
    note: "People who used the unsubscribe link. They still get chat alerts and account emails. Remove one only at that person's request.",
    columns: [["email", "Address"], ["source", "How"], ["when", "Since"]],
    actions: { remove: { label: "Resubscribe", confirm: "Put this address back on mass emails? Only do this at their request.", run: async (db, id) => rowsOf(await db.from("mass_email_unsubscribes").delete().eq("email", id).select("email")) } },
    async load(db) {
      const rows = rowsOf(await newest(db, "mass_email_unsubscribes", "email, source, created_at"));
      return { rows: rows.map((r) => ({ id: r.email, actions: ["remove"], cells: { email: r.email, source: r.source === "one_click" ? "One click in their mail app" : "Unsubscribe link", when: date(r.created_at) } })) };
    },
  },

  // ── Imports and sync ──────────────────────────────────────────────────────
  "import-jobs": {
    title: "Listing imports and syncs",
    note: "Every time a page is read to build or refresh a listing: a landlord's import, or the daily website sync.",
    columns: [["when", "Started"], ["status", "Status"], ["step", "Step"], ["target", "Page"], ["who", "Landlord"], ["listing", "Listing"], ["error", "Error"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "listing_import_jobs", "id, user_id, listing_id, target, status, step, attempts, error, created_at"));
      const [people, listings] = await Promise.all([peopleBy(db, rows.map((r) => r.user_id)), listingsBy(db, rows.map((r) => r.listing_id))]);
      return {
        filters: [{ key: "failed", label: "Failed" }, { key: "active", label: "Running or queued" }, { key: "done", label: "Done" }, { key: "cancelled", label: "Cancelled" }],
        rows: rows.map((r) => ({
          id: r.id, filter: r.status === "failed" ? "failed" : r.status === "done" ? "done" : r.status === "cancelled" ? "cancelled" : "active",
          cells: { when: date(r.created_at), status: badge(r.status, IMPORT_COLORS[r.status]), step: lines(r.step, r.attempts > 1 ? `${r.attempts} attempts` : null), target: typeof r.target === "string" ? r.target : r.target?.url ?? null, who: person(people.get(r.user_id)), listing: listing(listings.get(r.listing_id)), error: r.error },
        })),
      };
    },
  },
  "sync-monitors": {
    title: "Websites being watched",
    note: "Each listing's source page and how its last check went. Turning one off stops the daily sync for that page.",
    columns: [["listing", "Listing"], ["url", "Page"], ["status", "Last check"], ["checked", "Checked"], ["next", "Next check"], ["error", "Error"]],
    actions: {
      disable: { label: "Turn off", confirm: "Stop syncing this page?", run: async (db, id) => rowsOf(await db.from("listing_source_monitors").update({ enabled: false }).eq("id", id).select("id")) },
      enable: { label: "Turn on", run: async (db, id) => rowsOf(await db.from("listing_source_monitors").update({ enabled: true }).eq("id", id).select("id")) },
    },
    async load(db) {
      const rows = rowsOf(await db.from("listing_source_monitors").select("id, listing_id, source_url, enabled, last_status, last_error, last_checked_at, consecutive_failures, next_check_at").order("consecutive_failures", { ascending: false }).order("last_checked_at", { ascending: false }).limit(1000));
      const listings = await listingsBy(db, rows.map((r) => r.listing_id));
      return {
        filters: [{ key: "failing", label: "Failing" }, { key: "ok", label: "Healthy" }, { key: "off", label: "Turned off" }],
        rows: rows.map((r) => {
          const failing = SYNC_BAD.has(r.last_status) || (r.consecutive_failures ?? 0) > 0;
          return {
            id: r.id, filter: !r.enabled ? "off" : failing ? "failing" : "ok", actions: [r.enabled ? "disable" : "enable"],
            cells: { listing: listing(listings.get(r.listing_id)), url: r.source_url, status: badge(r.enabled ? r.last_status ?? "not checked yet" : "off", !r.enabled ? "gray" : failing ? "red" : "green"), checked: date(r.last_checked_at), next: r.enabled ? date(r.next_check_at) : null, error: r.consecutive_failures > 0 ? `${r.consecutive_failures} in a row${r.last_error ? `: ${r.last_error}` : ""}` : r.last_error },
          };
        }),
      };
    },
  },
  "agent-questions": {
    title: "Questions sent to landlords",
    note: "Questions a student asked Proxy that it could not answer, so it asked the landlord.",
    columns: [["asked", "Asked"], ["listing", "Listing"], ["question", "Question"], ["status", "Status"], ["owner", "Landlord asked"], ["answer", "Answer"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "listing_questions", "id, listing_id, owner_id, status, question, asked_count, answer, answered_at, created_at"));
      const [people, listings] = await Promise.all([peopleBy(db, rows.map((r) => r.owner_id)), listingsBy(db, rows.map((r) => r.listing_id))]);
      const colors = { open: "amber", answered: "green", closed: "gray", unroutable: "red" };
      return {
        filters: [{ key: "open", label: "Waiting on the landlord" }, { key: "unroutable", label: "No one to ask" }, { key: "answered", label: "Answered" }, { key: "closed", label: "Closed" }],
        rows: rows.map((r) => ({ id: r.id, filter: r.status, cells: { asked: date(r.created_at), listing: listing(listings.get(r.listing_id)), question: lines(r.question, r.asked_count > 1 ? `asked ${r.asked_count} times` : null), status: badge(r.status === "unroutable" ? "no one to ask" : r.status, colors[r.status]), owner: person(people.get(r.owner_id)), answer: r.answer } })),
      };
    },
  },
  "agent-usage": {
    title: "Agent spend, last 30 days",
    note: "What the listing agents cost in model calls, by day and by kind of work.",
    columns: [["day", "Day"], ["kind", "Work"], ["calls", "Calls"], ["cost", "Cost"]],
    async load(db) {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const all = [];
      for (let from = 0; from < 20000; from += 1000) {
        const page = rowsOf(await db.from("listing_agent_usage").select("kind, cost_cents, created_at").gte("created_at", since).order("created_at", { ascending: false }).range(from, from + 999));
        all.push(...page);
        if (page.length < 1000) break;
      }
      const groups = new Map();
      for (const u of all) {
        const key = `${u.created_at.slice(0, 10)}|${u.kind}`;
        const g = groups.get(key) ?? { day: u.created_at.slice(0, 10), kind: u.kind, calls: 0, cents: 0 };
        g.calls += 1;
        g.cents += Number(u.cost_cents ?? 0);
        groups.set(key, g);
      }
      const total = all.reduce((n, u) => n + Number(u.cost_cents ?? 0), 0);
      return {
        summary: `${money(total)} across ${all.length.toLocaleString("en-US")} calls in the last 30 days.`,
        rows: [...groups.values()].sort((a, b) => b.day.localeCompare(a.day) || b.cents - a.cents).map((g) => ({ id: `${g.day}|${g.kind}`, cells: { day: g.day, kind: String(g.kind).replace(/_/g, " "), calls: String(g.calls), cost: money(g.cents) } })),
      };
    },
  },

  // ── Billing (super only) ──────────────────────────────────────────────────
  charges: {
    title: "All charges",
    note: "Every charge, whatever state it is in. A charge is confirmed by the team, reviewed by the landlord for 7 days, approved, put on the monthly invoice and then paid.",
    superOnly: true,
    columns: [["when", "Created"], ["landlord", "Landlord"], ["what", "For"], ["amount", "Amount"], ["status", "State"], ["listing", "Listing"], ["student", "Student"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "charges", "id, landlord_id, amount_cents, description, trigger_type, listing_id, student_id, created_by_type, is_test, status, created_at"));
      const [people, listings] = await Promise.all([peopleBy(db, rows.flatMap((r) => [r.landlord_id, r.student_id])), listingsBy(db, rows.map((r) => r.listing_id))]);
      const colors = { unconfirmed: "amber", pending: "blue", approved: "blue", invoiced: "purple", paid: "green", contested: "red", voided: "gray" };
      const labels = { unconfirmed: "to confirm", pending: "in 7 day review", approved: "approved, not billed yet", invoiced: "on an invoice", paid: "paid", contested: "contested", voided: "voided" };
      return {
        filters: [{ key: "unconfirmed", label: "To confirm" }, { key: "pending", label: "In review" }, { key: "approved", label: "Approved" }, { key: "invoiced", label: "Invoiced" }, { key: "paid", label: "Paid" }, { key: "contested", label: "Contested" }, { key: "voided", label: "Voided" }],
        rows: rows.map((r) => ({
          id: r.id, filter: r.status,
          cells: { when: date(r.created_at), landlord: person(people.get(r.landlord_id)), what: lines(String(r.trigger_type ?? "").replace(/_/g, " ") || "Charge", [r.description, r.created_by_type === "admin" ? "created by the team" : null, r.is_test ? "test charge" : null].filter(Boolean).join(" · ") || null), amount: money(r.amount_cents), status: badge(labels[r.status] ?? r.status, colors[r.status]), listing: listing(listings.get(r.listing_id)), student: person(people.get(r.student_id)) },
        })),
      };
    },
  },
  invoices: {
    title: "All invoices",
    note: "Every monthly invoice. The ones that need attention are also under Failed or overdue.",
    superOnly: true,
    columns: [["when", "Invoice date"], ["landlord", "Landlord"], ["period", "Period"], ["total", "Total"], ["status", "State"], ["how", "Collected by"], ["detail", "Detail"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "billing_invoices", "id, landlord_id, billing_period, status, total_cents, invoice_date, paid_at, failed_at, last_failure_message, disputed, collection_method, due_date, overdue_actioned_at, created_at"));
      const people = await peopleBy(db, rows.map((r) => r.landlord_id));
      const colors = { paid: "green", open: "amber", processing: "blue", failed: "red", void: "gray", uncollectible: "gray" };
      return {
        filters: [{ key: "open", label: "Open" }, { key: "processing", label: "Processing" }, { key: "failed", label: "Failed" }, { key: "paid", label: "Paid" }, { key: "void", label: "Void" }],
        rows: rows.map((r) => ({
          id: r.id, filter: r.status === "uncollectible" ? "void" : r.status,
          cells: {
            when: r.invoice_date ? date(`${r.invoice_date}T12:00:00Z`) : date(r.created_at), landlord: person(people.get(r.landlord_id)), period: r.billing_period, total: money(r.total_cents),
            status: badge(`${r.status}${r.disputed ? ", disputed" : ""}${r.overdue_actioned_at && r.status !== "paid" ? ", leases withdrawn" : ""}`, r.disputed ? "red" : colors[r.status]),
            how: r.collection_method === "charge_automatically" ? "Autopay" : "Invoice sent",
            detail: r.status === "paid" && r.paid_at ? lines("Paid", new Date(r.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })) : r.last_failure_message ?? (r.due_date ? `Due ${r.due_date}` : null),
          },
        })),
      };
    },
  },
  "charge-history": {
    title: "Charge history",
    note: "Every step each charge has taken, who moved it and any note left.",
    superOnly: true,
    columns: [["when", "When"], ["landlord", "Landlord"], ["charge", "Charge"], ["change", "Change"], ["by", "By"], ["note", "Note"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "charge_status_history", "id, charge_id, from_status, to_status, actor_type, actor_user_id, note, created_at"));
      const charges = await rowsById(db, "charges", "id, landlord_id, amount_cents, description, is_test", rows.map((r) => r.charge_id));
      const people = await peopleBy(db, [...rows.map((r) => r.actor_user_id), ...[...charges.values()].map((c) => c.landlord_id)]);
      return {
        rows: rows.map((r) => {
          const c = charges.get(r.charge_id);
          return { id: r.id, cells: { when: date(r.created_at), landlord: person(people.get(c?.landlord_id)), charge: c ? lines(`${money(c.amount_cents)}${c.is_test ? " (test)" : ""}`, c.description) : null, change: `${r.from_status ? `${r.from_status} to ` : ""}${r.to_status}`.replace(/_/g, " "), by: r.actor_user_id ? person(people.get(r.actor_user_id), r.actor_type) : r.actor_type === "system" ? "Automatic" : r.actor_type, note: r.note } };
        }),
      };
    },
  },
  "stripe-events": {
    title: "Stripe events",
    note: "Every event Stripe sent us. One with an error, or received but never processed, means a payment update may have been missed.",
    superOnly: true,
    columns: [["when", "Received"], ["type", "Event"], ["mode", "Mode"], ["processed", "Processed"], ["error", "Error"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "stripe_webhook_events", "stripe_event_id, type, livemode, received_at, processed_at, error", "received_at"));
      return {
        filters: [{ key: "problem", label: "Problems" }, { key: "ok", label: "Processed" }],
        rows: rows.map((r) => ({ id: r.stripe_event_id, filter: r.error || !r.processed_at ? "problem" : "ok", cells: { when: date(r.received_at), type: lines(r.type, r.stripe_event_id), mode: badge(r.livemode ? "live" : "test", r.livemode ? "green" : "gray"), processed: r.processed_at ? date(r.processed_at) : badge("not processed", "red"), error: r.error } })),
      };
    },
  },
  "payer-requests": {
    title: "Listings waiting on an authorized signer",
    note: "A landlord whose bills are paid by someone else asked to publish; the signer has to approve the paperwork first.",
    superOnly: true,
    columns: [["when", "Asked"], ["landlord", "Landlord"], ["listing", "Listing"], ["status", "Status"], ["kind", "Document"], ["resolved", "Resolved"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "payer_publish_requests", "id, landlord_id, listing_id, status, document_kind, created_at, resolved_at"));
      const [people, listings] = await Promise.all([peopleBy(db, rows.map((r) => r.landlord_id)), listingsBy(db, rows.map((r) => r.listing_id))]);
      const colors = { waiting: "amber", approved: "green", published: "green", declined: "red", cancelled: "gray" };
      return {
        filters: [{ key: "waiting", label: "Waiting" }, { key: "done", label: "Resolved" }],
        rows: rows.map((r) => ({ id: r.id, filter: r.status === "waiting" ? "waiting" : "done", cells: { when: date(r.created_at), landlord: person(people.get(r.landlord_id)), listing: listing(listings.get(r.listing_id)), status: badge(r.status, colors[r.status]), kind: r.document_kind, resolved: date(r.resolved_at) } })),
      };
    },
  },
  "autopay-history": {
    title: "Autopay sign-ups",
    note: "Each time a landlord turned autopay on, and when and why it ended.",
    superOnly: true,
    columns: [["when", "Turned on"], ["landlord", "Landlord"], ["state", "State"], ["failures", "Failed tries"], ["why", "Why it ended"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "autopay_authorizations", "id, user_id, authorized_at, consecutive_failures, revoked_at, revoked_reason, created_at"));
      const people = await peopleBy(db, rows.map((r) => r.user_id));
      return { rows: rows.map((r) => ({ id: r.id, cells: { when: date(r.authorized_at ?? r.created_at), landlord: person(people.get(r.user_id)), state: r.revoked_at ? badge("ended", "gray") : badge("on", "green"), failures: String(r.consecutive_failures ?? 0), why: r.revoked_at ? r.revoked_reason : null } })) };
    },
  },
  "license-history": {
    title: "License disclosure history",
    note: "Every answer a landlord has given to the real estate license question, newest first.",
    superOnly: true,
    columns: [["when", "When"], ["landlord", "Landlord"], ["answer", "Licensed?"], ["agent", "Agent and company"], ["number", "License number"], ["source", "Given"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "landlord_license_disclosure_history", "id, user_id, is_licensee, agent_name, company_name, company_phone, license_number, source, created_at"));
      const people = await peopleBy(db, rows.map((r) => r.user_id));
      return { rows: rows.map((r) => ({ id: r.id, cells: { when: date(r.created_at), landlord: person(people.get(r.user_id)), answer: badge(r.is_licensee ? "licensed" : "not licensed", r.is_licensee ? "blue" : "gray"), agent: lines(r.agent_name, [r.company_name, r.company_phone].filter(Boolean).join(", ") || null), number: r.license_number, source: r.source === "signing" ? "While signing" : "On their profile" } })) };
    },
  },

  // ── Student activity ──────────────────────────────────────────────────────
  "matchmaking-sessions": {
    title: "Find Your Place searches",
    note: "Each Find Your Place search (saved once matches are found), plus the mobile app's Proxy chats, which share the table until the app moves to Find Your Place.",
    columns: [["when", "Last active"], ["who", "Who"], ["kind", "Kind"], ["status", "Got to"], ["started", "Started"]],
    async load(db) {
      // `fyp` is the Find Your Place marker, present (if emptied, once a
      // signed-out search expires) only on search rows.
      const rows = rowsOf(await newest(db, "matchmaking_chat_sessions", "id, user_id, visitor_id, status, created_at, updated_at, expired_at, fyp:preferences->_fyp", "updated_at"));
      const people = await peopleBy(db, rows.map((r) => r.user_id));
      const colors = { recommendations_ready: "green", swiping: "blue", in_progress: "amber", abandoned: "gray" };
      const chatStatus = { recommendations_ready: "Got recommendations", swiping: "Swiping", in_progress: "In progress", abandoned: "Abandoned" };
      const isSearch = (r) => r.fyp != null;
      return {
        filters: [{ key: "search", label: "Find Your Place" }, { key: "chat", label: "Proxy chat (mobile)" }],
        rows: rows.map((r) => {
          const search = isSearch(r);
          const runs = Number(r.fyp?.runs) || 1;
          return {
            id: r.id,
            filter: search ? "search" : "chat",
            cells: {
              when: date(r.updated_at ?? r.created_at),
              who: person(people.get(r.user_id), "Signed-out visitor"),
              kind: search ? lines("Find Your Place", runs > 1 ? `searched ${runs} times` : null) : "Proxy chat (mobile)",
              status: search ? badge("Got matches", "green") : badge(chatStatus[r.status] ?? r.status, colors[r.status]),
              started: date(r.created_at),
            },
          };
        }),
      };
    },
  },
  "lease-checks": {
    title: "Lease checks",
    note: "Leases people uploaded to be checked.",
    columns: [["when", "When"], ["who", "Who"], ["file", "File"], ["matched", "Matched listing"], ["state", "State"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "lease_checks", "id, user_id, file_name, page_count, matched_listing_id, created_at, deleted_at"));
      const [people, listings] = await Promise.all([peopleBy(db, rows.map((r) => r.user_id)), listingsBy(db, rows.map((r) => r.matched_listing_id))]);
      return { rows: rows.map((r) => ({ id: r.id, cells: { when: date(r.created_at), who: person(people.get(r.user_id), "Signed-out visitor"), file: lines(r.file_name, r.page_count ? `${r.page_count} pages` : null), matched: listing(listings.get(r.matched_listing_id)), state: r.deleted_at ? badge("deleted", "gray") : badge("kept", "green") } })) };
    },
  },
  waitlist: {
    title: "Waitlist sign-ups",
    note: "People who asked to be told when a listing opens up.",
    columns: [["when", "When"], ["who", "Who"], ["contact", "Contact"], ["listing", "Listing"], ["nudged", "Nudge sent"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "waitlist_clicks", "id, listing_id, user_id, name, email, phone, nudge_sent_at, created_at"));
      const [people, listings] = await Promise.all([peopleBy(db, rows.map((r) => r.user_id)), listingsBy(db, rows.map((r) => r.listing_id))]);
      return { rows: rows.map((r) => ({ id: r.id, cells: { when: date(r.created_at), who: person(people.get(r.user_id), r.name || "No account"), contact: lines(r.email, r.phone), listing: listing(listings.get(r.listing_id)), nudged: date(r.nudge_sent_at) } })) };
    },
  },

  // ── PMS (beta) ────────────────────────────────────────────────────────────
  "pms-connections": {
    title: "PMS connections",
    note: "Landlords who connected their property management system (beta).",
    columns: [["landlord", "Landlord"], ["provider", "System"], ["status", "Status"], ["synced", "Last sync"], ["result", "Result"], ["error", "Error"]],
    async load(db) {
      const rows = rowsOf(await db.from("pms_connections").select("id, user_id, provider, status, last_sync_at, last_sync_status, last_sync_error, deleted_at, created_at").order("created_at", { ascending: false }).limit(LIMIT));
      const people = await peopleBy(db, rows.map((r) => r.user_id));
      const colors = { active: "green", error: "red", disconnected: "gray" };
      return { rows: rows.map((r) => ({ id: r.id, cells: { landlord: person(people.get(r.user_id)), provider: r.provider, status: badge(r.deleted_at ? "removed" : r.status, r.deleted_at ? "gray" : colors[r.status]), synced: date(r.last_sync_at), result: r.last_sync_status, error: r.last_sync_error } })) };
    },
  },
  "pms-queue": {
    title: "PMS changes held for review",
    note: "Changes a PMS sync would not apply by itself. Until now these could only be released from an emailed link.",
    columns: [["when", "When"], ["listing", "Listing"], ["reason", "Why held"], ["status", "Status"], ["resolved", "Resolved"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "pms_review_queue", "id, listing_id, reason, status, resolved_at, created_at"));
      const listings = await listingsBy(db, rows.map((r) => r.listing_id));
      return { filters: [{ key: "open", label: "Open" }, { key: "done", label: "Resolved" }], rows: rows.map((r) => ({ id: r.id, filter: r.status === "open" ? "open" : "done", cells: { when: date(r.created_at), listing: listing(listings.get(r.listing_id)), reason: badge(r.reason, "amber"), status: badge(r.status, r.status === "open" ? "amber" : "gray"), resolved: date(r.resolved_at) } })) };
    },
  },
  "pms-requests": {
    title: "PMS systems landlords asked for",
    note: "Landlords who named a system we do not support yet. Nothing else reads these.",
    columns: [["when", "When"], ["landlord", "Landlord"], ["provider", "System they use"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "pms_integration_requests", "id, user_id, provider_name, created_at"));
      const people = await peopleBy(db, rows.map((r) => r.user_id));
      return { rows: rows.map((r) => ({ id: r.id, cells: { when: date(r.created_at), landlord: person(people.get(r.user_id)), provider: r.provider_name } })) };
    },
  },
  "pms-events": {
    title: "PMS sync events",
    note: "What each PMS sync saw and did, newest first.",
    columns: [["when", "When"], ["listing", "Listing"], ["unit", "Unit"], ["result", "Result"], ["rent", "Rent seen"]],
    async load(db) {
      const rows = rowsOf(await newest(db, "pms_sync_events", "id, listing_id, external_unit_id, observed_rent, applied, result, created_at"));
      const listings = await listingsBy(db, rows.map((r) => r.listing_id));
      const bad = new Set(["error", "held", "flagged"]);
      return { rows: rows.map((r) => ({ id: r.id, cells: { when: date(r.created_at), listing: listing(listings.get(r.listing_id)), unit: r.external_unit_id, result: badge(r.result, bad.has(r.result) ? "red" : r.applied ? "green" : "gray"), rent: r.observed_rent == null ? null : `$${Number(r.observed_rent).toLocaleString("en-US")}` } })) };
    },
  },

  // ── System ────────────────────────────────────────────────────────────────
  activity: {
    title: "Activity log",
    note: "The audit trail: who changed what, across people, listings, chats, billing and email. Search to narrow it.",
    columns: [["when", "When"], ["who", "Who"], ["event", "Did"], ["what", "To"], ["fields", "Fields changed"], ["open", ""]],
    async load(db) {
      const rows = rowsOf(await newest(db, "action_log", "id, table_name, record_id, event_type, changed_by_id, changed_by_source, changed_fields, changed_at", "changed_at"));
      const people = await peopleBy(db, rows.map((r) => r.changed_by_id));
      const verbs = { INSERT: "added", UPDATE: "changed", DELETE: "removed" };
      const tables = [...new Set(rows.map((r) => r.table_name))].sort();
      return {
        filters: tables.map((t) => ({ key: t, label: t.replace(/_/g, " ") })),
        rows: rows.map((r) => {
          const fields = (Array.isArray(r.changed_fields) ? r.changed_fields : r.changed_fields && typeof r.changed_fields === "object" ? Object.keys(r.changed_fields) : []).filter((k) => k !== "updated_at");
          return {
            id: r.id, filter: r.table_name,
            cells: {
              when: date(r.changed_at), who: person(people.get(r.changed_by_id), r.changed_by_source || "The system"), event: verbs[String(r.event_type).toUpperCase()] ?? String(r.event_type).toLowerCase(),
              what: lines(r.table_name.replace(/_/g, " "), r.record_id), fields: fields.slice(0, 8).join(", ").replace(/_/g, " ") + (fields.length > 8 ? ` and ${fields.length - 8} more` : ""),
              open: r.table_name === "users" && r.record_id ? link(`people/${r.record_id}`, null, "Open person") : r.table_name === "listings" && r.record_id ? link(`listings/${r.record_id}`, null, "Open listing") : null,
            },
          };
        }),
      };
    },
  },
  "scheduled-jobs": {
    title: "Scheduled jobs",
    note: "The background jobs that run on a timer. Most do not record each run, so this shows the last trace each one left and any open errors that name it.",
    columns: [["job", "Job"], ["schedule", "Runs"], ["does", "What it does"], ["last", "Last trace"], ["health", "Health"]],
    async load(db) {
      const jobs = await loadScheduledJobs(db);
      return {
        rows: jobs.map((j) => ({
          id: j.name,
          cells: {
            job: j.name, schedule: j.schedule, does: j.does,
            last: j.lastAt ? { t: "lines", text: null, sub: j.lastFrom, at: j.lastAt } : lines(null, j.lastFrom),
            health: j.openErrors ? badge(`${j.openErrors} open error${j.openErrors === 1 ? "" : "s"}`, "red") : j.stale ? badge("no recent trace", "amber") : j.lastAt ? badge("ok", "green") : badge("not recorded", "gray"),
          },
        })),
      };
    },
  },
};
