/*
 * The scheduled jobs, for System > Scheduled jobs (Wyatt, 2026-11-14).
 *
 * Schedules come straight from apps/web/vercel.json, so this cannot drift from
 * what actually runs. Only the chat check-in keeps a real run log; for the rest
 * the page shows the newest trace the job leaves behind (a row it stamps, an
 * email it sends) and the open errors that name it. "No recent trace" is a
 * prompt to look, not proof the job is down: a job with nothing to do leaves
 * no trace.
 */
// vercel.json sits outside src/, where the @/ alias cannot reach.
import vercel from "../../../vercel.json";

const DAY = 86400000;

// What each job does, and where its newest trace can be read.
//   trace: [table, timestamp column, plain description, extra filter]
//   every: how often it should leave one, in days (null = only when there is work)
const JOBS = {
  "landlord-nudge": { does: "Emails new landlords who have not added a listing yet.", trace: ["sent_emails", "created_at", "last nudge email", (q) => q.eq("kind", "landlord_nudge")], every: null },
  "pms-sync": { does: "Syncs every connected property management system and emails a digest.", trace: ["pms_connections", "last_sync_at", "last PMS sync"], every: null },
  "seo-report": { does: "Pulls search data each Monday and opens a GitHub issue with opportunities.", trace: null, every: null },
  "purge-accounts": { does: "Removes accounts deleted more than 30 days ago and expires old visitor chats.", trace: null, every: null },
  "review-confirmations": { does: "Sends the confirmation email after someone leaves a review.", trace: ["listing_reviews", "confirmation_sent_at", "last confirmation sent"], every: null },
  "waitlist-nudge": { does: "Nudges people on a waitlist whose account cannot be used yet.", trace: ["waitlist_clicks", "nudge_sent_at", "last nudge sent"], every: null },
  "lease-check-cleanup": { does: "Deletes uploaded leases that are no longer needed.", trace: null, every: null },
  "chat-retention": { does: "Deletes old moderation records and expired sign-in links.", trace: null, every: null },
  "chat-checkin": { does: "Finds conversations that went quiet, sends reminders and emails the team a summary.", trace: ["chat_checkin_runs", "started_at", "last run", (q) => q.eq("kind", "checkin")], every: 1 },
  "chat-checkin-report": { does: "Emails the weekly conversations report each Monday.", trace: ["chat_checkin_runs", "started_at", "last run", (q) => q.eq("kind", "report")], every: 7 },
  "billing-review-clock": { does: "Moves charges from Pending to Approved after their 7 day review.", trace: ["charge_status_history", "created_at", "last automatic charge step", (q) => q.eq("actor_type", "system")], every: null },
  "billing-run": { does: "Bills landlords on the first Monday of the month and follows up on other days.", trace: ["billing_invoices", "created_at", "last invoice created"], every: null },
  "billing-overdue": { does: "Withdraws leases for overdue invoices, sends payment reminders and runs autopay.", trace: ["billing_invoices", "overdue_actioned_at", "last overdue action"], every: null },
  "import-jobs": { does: "Works through queued listing imports and restarts stuck ones.", trace: ["listing_import_jobs", "updated_at", "last import activity"], every: 2 },
  "agent-questions": { does: "Reminds landlords about unanswered questions and tour requests.", trace: ["listing_questions", "reminder_1_at", "last question reminder"], every: null },
  "agent-sync": { does: "Queues the daily website sync for every listing that is due.", trace: ["listing_source_monitors", "last_checked_at", "last page checked"], every: 2 },
  "agent-digest": { does: "Emails the team the daily agents digest.", trace: ["sent_emails", "created_at", "last digest email", (q) => q.eq("kind", "agent_digest")], every: 2 },
  "agent-knowledge": { does: "Queues the Monday read of every listing's website into what Proxy knows; each hourly run picks up listings not read yet this week.", trace: ["listing_import_jobs", "finished_at", "last website read", (q) => q.contains("target", { knowledge: true })], every: 7 },
};

// "0 14 * * 1" -> "Mondays at 2:00 PM UTC". Covers the shapes vercel.json uses.
export function describeSchedule(cron) {
  const [min, hour, , , dow] = String(cron).split(" ");
  if (min?.startsWith("*/")) return `Every ${min.slice(2)} minutes`;
  if (hour === "*") return `Every hour at :${String(min).padStart(2, "0")}`;
  const clock = (h) => `${((h + 11) % 12) + 1}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  const days = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  const when = dow !== "*" && days[Number(dow)] ? days[Number(dow)] : "Daily";
  // An hour range ("11-21"): every hour between the two (PR 447 review).
  const range = /^(\d+)-(\d+)$/.exec(hour ?? "");
  if (range) return `${when}, every hour from ${clock(Number(range[1]))} to ${clock(Number(range[2]))} UTC`;
  return `${when} at ${clock(Number(hour))} UTC`;
}

export async function loadScheduledJobs(db) {
  const crons = (vercel.crons ?? []).map((c) => ({ name: c.path.replace("/api/cron/", ""), cron: c.schedule }));
  const { data: errors } = await db.from("app_errors").select("where_label, message").is("resolved_at", null).or("where_label.ilike.%cron%,message.ilike.%cron%").limit(500);

  return Promise.all(crons.map(async ({ name, cron }) => {
    const job = JOBS[name] ?? { does: "No description yet.", trace: null, every: null };
    let lastAt = null;
    if (job.trace) {
      const [table, column, , filter] = job.trace;
      let q = db.from(table).select(column).not(column, "is", null).order(column, { ascending: false }).limit(1);
      if (filter) q = filter(q);
      const { data } = await q;
      lastAt = data?.[0]?.[column] ?? null;
    }
    // Whole name only: "cron/chat-checkin" must not also match "cron/chat-checkin-report".
    const names = new RegExp(`cron/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);
    const openErrors = (errors ?? []).filter((e) => names.test(`${e.where_label ?? ""} ${e.message ?? ""}`)).length;
    return {
      name,
      schedule: describeSchedule(cron),
      does: job.does,
      lastAt,
      lastFrom: job.trace ? (lastAt ? job.trace[2] : `No ${job.trace[2].replace(/^last /, "")} yet`) : "This job does not record its runs",
      stale: !!job.every && (!lastAt || Date.now() - Date.parse(lastAt) > job.every * DAY * 1.5),
      openErrors,
    };
  }));
}
