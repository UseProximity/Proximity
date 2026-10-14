/*
 * Weekly chat check-in report (Wyatt, 2026-10-13).
 *
 * Two halves, one email, sent by api/cron/chat-checkin-report to the same
 * internal recipients as the daily digest.
 *
 *   1. How the daily check-in performed: runs and failures, alerts sent by
 *      side, and how many of the people we flagged came back and replied.
 *      Read from chat_checkin_runs and chat_checkin_alerts.
 *
 *   2. Where conversations lead. Every thread with a message in the window is
 *      read by Claude and classified: still talking in the app, a tour or an
 *      application step, moved to email, phone or an outside portal, or gone
 *      quiet. A second call turns the classifications plus the moderation
 *      flag counts into a short narrative on whether people are staying on
 *      Proximity or drifting off it, with a few suggestions.
 *
 * The model sees message text and first names only. Email addresses and
 * phone numbers written INTO messages are part of what it is asked to spot,
 * so those are left as written. Any thread the model cannot classify is
 * counted as "unclassified" rather than dropped, so the totals always add up.
 *
 * API key: CHAT_CHECKIN_KEY, falling back to ANTHROPIC_API_KEY. A dedicated
 * key keeps this job's spend attributable, as with the other chat features.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { sendMailSafe } from "@/lib/outreach";
import {
  loadConversations,
  fetchAll,
  checkinTransporter,
  esc,
  fmtWhen,
  wrapHtml,
  sectionHtml,
  STALE_AFTER_DAYS,
} from "@/lib/chat/checkin";

export const REPORT_WINDOW_DAYS = 7;
export const CHECKIN_REPORT_MODEL = "claude-opus-5-5";

// How many threads are classified at once. Keeps the run inside maxDuration
// without hammering the API.
const CLASSIFY_CONCURRENCY = 4;
// A transcript is cut to its newest messages and each body to this length.
const TRANSCRIPT_MAX_MESSAGES = 60;
const TRANSCRIPT_BODY_CHARS = 800;

let _client = null;
function getClient() {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.CHAT_CHECKIN_KEY || process.env.ANTHROPIC_API_KEY,
    });
  }
  return _client;
}

export function aiConfigured() {
  return Boolean(process.env.CHAT_CHECKIN_KEY || process.env.ANTHROPIC_API_KEY);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export const STAGES = [
  "awaiting_first_reply",
  "ongoing_in_app",
  "tour_or_visit_arranged",
  "application_or_lease_step",
  "moved_off_platform",
  "declined_or_unavailable",
  "went_quiet",
];

export const STAGE_LABELS = {
  awaiting_first_reply: "Waiting on a first reply",
  ongoing_in_app: "Talking in the app",
  tour_or_visit_arranged: "Tour or visit arranged",
  application_or_lease_step: "Application or lease step",
  moved_off_platform: "Moved off Proximity",
  declined_or_unavailable: "Declined or unavailable",
  went_quiet: "Went quiet",
  unclassified: "Could not classify",
};

const CHANNELS = ["none", "email", "phone_or_text", "external_portal_or_link", "social_or_messaging_app", "in_person", "other"];

export const CHANNEL_LABELS = {
  none: "none",
  email: "email",
  phone_or_text: "phone or text",
  external_portal_or_link: "outside portal or link",
  social_or_messaging_app: "social or messaging app",
  in_person: "in person",
  other: "other",
};

const ThreadSchema = z.object({
  stage: z.enum(STAGES),
  offPlatform: z.object({
    happened: z.boolean(),
    channel: z.enum(CHANNELS),
    initiatedBy: z.enum(["landlord", "student", "both", "none"]),
  }),
  keptOnProximity: z.boolean(),
  summary: z.string(),
});

const NarrativeSchema = z.object({
  headline: z.string(),
  narrative: z.string(),
  recommendations: z.array(z.string()),
});

const CLASSIFY_SYSTEM = `You read one conversation between a student looking for off-campus housing and a landlord, held on Proximity, a housing marketplace for WashU students. Proximity wants conversations to stay in its own chat, where both people are protected, rather than moving to email, phone, text, social apps or an outside application portal.

Classify where the conversation currently stands and whether it moved, or was invited to move, off Proximity.

stage, pick one:
- awaiting_first_reply: only one person has written so far.
- ongoing_in_app: both have written and they are still talking here, nothing arranged yet.
- tour_or_visit_arranged: a showing, tour or visit was proposed and accepted, or a time was set.
- application_or_lease_step: an application, lease, deposit or signing step is under way.
- moved_off_platform: the conversation was taken to another channel (an address, number, link or app was shared and accepted, or someone said to continue elsewhere) and that is where it now lives.
- declined_or_unavailable: the listing is gone, or one person clearly said no.
- went_quiet: both have written, the last message is unanswered, and nothing was arranged.

offPlatform.happened is true if anyone shared contact details, an outside link or app, or asked to continue elsewhere, even if the other person did not take it up. channel is where they pointed to. initiatedBy is who first pushed to leave.

keptOnProximity is true if anyone chose to keep talking here despite an invitation to leave, or no such invitation was made.

summary: one or two plain sentences on what happened, no names beyond first names, no email addresses or phone numbers.`;

function transcriptFor(c) {
  const msgs = c.allMessages.slice(-TRANSCRIPT_MAX_MESSAGES);
  const first = (name) => String(name ?? "").trim().split(/\s+/)[0] || "Unknown";
  const lines = msgs.map((m) => {
    const who =
      m.sender_id === c.landlord.id
        ? `Landlord (${first(c.landlord.name)})`
        : m.sender_id === c.student.id
          ? `Student (${first(c.student.name)})`
          : "System";
    let body = String(m.body ?? "").trim();
    if (!body && m.message_type === "attachment") body = "[sent an attachment]";
    if (body.length > TRANSCRIPT_BODY_CHARS) body = `${body.slice(0, TRANSCRIPT_BODY_CHARS)} [cut]`;
    return `[${fmtWhen(m.created_at)}] ${who}: ${body}`;
  });
  const omitted = c.allMessages.length - msgs.length;
  return `${omitted > 0 ? `(${omitted} earlier messages not shown)\n` : ""}${lines.join("\n")}`;
}

async function classifyOne(c) {
  const base = { threadId: c.thread.id, listing: c.listing?.title || c.thread.subject || "(no listing)" };
  try {
    const response = await getClient().messages.parse({
      model: CHECKIN_REPORT_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low", format: zodOutputFormat(ThreadSchema) },
      system: [{ type: "text", text: CLASSIFY_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Listing: ${base.listing}\nMessages in the thread: ${c.allMessages.length}\n\nConversation:\n${transcriptFor(c)}`,
        },
      ],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return { ...base, stage: "unclassified", offPlatform: null, keptOnProximity: null, summary: null };
    }
    return { ...base, ...response.parsed_output };
  } catch (error) {
    console.error("[chat-checkin-report] classify failed", c.thread.id, error?.message ?? error);
    return { ...base, stage: "unclassified", offPlatform: null, keptOnProximity: null, summary: null, error: String(error?.message ?? error) };
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function narrate({ classifications, moderation, totals, window }) {
  const counts = {};
  for (const c of classifications) counts[c.stage] = (counts[c.stage] ?? 0) + 1;
  const offPlatform = classifications.filter((c) => c.offPlatform?.happened);
  const byChannel = {};
  for (const c of offPlatform) byChannel[c.offPlatform.channel] = (byChannel[c.offPlatform.channel] ?? 0) + 1;
  const byInitiator = {};
  for (const c of offPlatform) byInitiator[c.offPlatform.initiatedBy] = (byInitiator[c.offPlatform.initiatedBy] ?? 0) + 1;

  const input = {
    window,
    totals,
    stageCounts: counts,
    offPlatform: { threads: offPlatform.length, byChannel, byInitiator },
    keptOnProximity: classifications.filter((c) => c.keptOnProximity === true).length,
    moderationFlags: moderation,
    threadSummaries: classifications.map((c) => ({ stage: c.stage, summary: c.summary })).filter((c) => c.summary),
  };

  const response = await getClient().messages.parse({
    model: CHECKIN_REPORT_MODEL,
    max_tokens: 2048,
    output_config: { effort: "medium", format: zodOutputFormat(NarrativeSchema) },
    system: `You write a short weekly note for the three people who run Proximity, a WashU off-campus housing marketplace with its own landlord and student chat. They want to know where conversations lead: do they stay in Proximity's chat, or do people move to email, phone, text or outside portals, and is anyone encouraging them to stay. Write plainly, in the second person, with numbers where they help. No em dashes. headline: one sentence. narrative: three to six sentences. recommendations: up to three concrete, small things to try next week, or an empty list if the data is too thin to say.`,
    messages: [{ role: "user", content: `This week's data as JSON:\n${JSON.stringify(input, null, 2)}` }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  return response.parsed_output;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/*
 * Build the whole report for the window ending at `now`.
 *
 * `withAi: false` skips both model calls (the ops half still comes through),
 * which the cron uses when no API key is configured.
 */
export async function buildCheckinReport(supabase, { now = new Date(), days = REPORT_WINDOW_DAYS, withAi = true } = {}) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  const [runs, alerts, moderationEvents, recentMessages] = await Promise.all([
    fetchAll(
      supabase
        .from("chat_checkin_runs")
        .select("id, kind, started_at, finished_at, ok, dry_run, stats, error")
        .eq("kind", "checkin")
        .eq("dry_run", false)
        .gte("started_at", sinceIso)
        .order("started_at", { ascending: true })
    ),
    fetchAll(
      supabase
        .from("chat_checkin_alerts")
        .select("id, thread_id, last_message_id, quiet_side, silent_since, sent_at")
        .eq("dry_run", false)
        .gte("sent_at", sinceIso)
    ),
    fetchAll(
      supabase
        .from("chat_moderation_events")
        .select("id, thread_id, action, reasons, created_at")
        .gte("created_at", sinceIso)
    ),
    fetchAll(
      supabase
        .from("chat_messages")
        .select("thread_id, created_at")
        .is("deleted_at", null)
        .gte("created_at", sinceIso)
    ),
  ]);

  // Threads touched this week, plus every thread we alerted on so recovery can be judged.
  const activeIds = new Set(recentMessages.map((m) => m.thread_id));
  const alertIds = new Set(alerts.map((a) => a.thread_id));
  const conversations = await loadConversations(supabase, { threadIds: [...new Set([...activeIds, ...alertIds])] });
  const byThread = new Map(conversations.map((c) => [c.thread.id, c]));

  // Did the quiet side come back after we flagged them?
  let recovered = 0;
  const recoveredBySide = { landlord: 0, student: 0 };
  for (const a of alerts) {
    const c = byThread.get(a.thread_id);
    if (!c) continue;
    const quietId = a.quiet_side === "landlord" ? c.landlord.id : c.student.id;
    const sentAt = new Date(a.sent_at).getTime();
    const cameBack = c.messages.some((m) => m.sender_id === quietId && new Date(m.created_at).getTime() > sentAt);
    if (cameBack) {
      recovered += 1;
      recoveredBySide[a.quiet_side] += 1;
    }
  }

  const ops = {
    runs: runs.length,
    failedRuns: runs.filter((r) => !r.ok).length,
    lastRunAt: runs.length ? runs[runs.length - 1].started_at : null,
    lastRunOk: runs.length ? runs[runs.length - 1].ok : null,
    errors: runs.filter((r) => !r.ok).map((r) => ({ at: r.started_at, error: r.error })),
    alerts: alerts.length,
    alertsBySide: {
      landlord: alerts.filter((a) => a.quiet_side === "landlord").length,
      student: alerts.filter((a) => a.quiet_side === "student").length,
    },
    recovered,
    recoveredBySide,
  };

  const moderation = { total: moderationEvents.length, flagged: 0, blocked: 0, byReason: {} };
  for (const e of moderationEvents) {
    if (e.action === "block") moderation.blocked += 1;
    else moderation.flagged += 1;
    for (const r of e.reasons ?? []) moderation.byReason[r] = (moderation.byReason[r] ?? 0) + 1;
  }

  const active = conversations.filter((c) => activeIds.has(c.thread.id));
  const totals = {
    activeThreads: active.length,
    newThreads: active.filter((c) => new Date(c.thread.created_at) >= since).length,
    messages: recentMessages.length,
    threadsWithBothSides: active.filter((c) => {
      const s = new Set(c.messages.map((m) => m.sender_id));
      return s.has(c.landlord.id) && s.has(c.student.id);
    }).length,
  };

  let ai = null;
  if (withAi && active.length > 0) {
    const classifications = await mapLimit(active, CLASSIFY_CONCURRENCY, classifyOne);
    const stageCounts = {};
    for (const c of classifications) stageCounts[c.stage] = (stageCounts[c.stage] ?? 0) + 1;
    const offPlatform = classifications.filter((c) => c.offPlatform?.happened);
    let narrative = null;
    try {
      narrative = await narrate({
        classifications,
        moderation,
        totals,
        window: { since: sinceIso, until: now.toISOString(), days },
      });
    } catch (error) {
      console.error("[chat-checkin-report] narrative failed", error?.message ?? error);
    }
    ai = {
      model: CHECKIN_REPORT_MODEL,
      classified: classifications.filter((c) => c.stage !== "unclassified").length,
      unclassified: classifications.filter((c) => c.stage === "unclassified").length,
      stageCounts,
      offPlatformThreads: offPlatform.length,
      keptOnProximity: classifications.filter((c) => c.keptOnProximity === true).length,
      narrative,
      threads: classifications,
    };
  }

  return {
    window: { since: sinceIso, until: now.toISOString(), days },
    ops,
    totals,
    moderation,
    ai,
    staleAfterDays: STALE_AFTER_DAYS,
  };
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

const stat = (label, value) =>
  `<div style="display:inline-block;min-width:120px;margin:6px 12px 6px 0"><div style="font-size:22px;font-weight:800;color:#0A0A0A">${esc(value)}</div><div style="font-size:12px;color:#6b7280">${esc(label)}</div></div>`;

const row = (label, value) =>
  `<tr><td style="padding:4px 10px 4px 0;color:#4b5563;font-size:13px">${esc(label)}</td><td style="padding:4px 0;color:#111;font-size:13px;font-weight:600">${esc(value)}</td></tr>`;

function opsHtml(r) {
  const o = r.ops;
  const health =
    o.runs === 0
      ? `<div style="color:#E82027;font-weight:700;font-size:13px">The daily check-in did not run this week.</div>`
      : o.failedRuns > 0
        ? `<div style="color:#E82027;font-weight:700;font-size:13px">&#9888; ${o.failedRuns} of ${o.runs} runs failed.</div>`
        : `<div style="color:#16a34a;font-size:13px">&#10003; All ${o.runs} daily runs succeeded.</div>`;
  const errors = o.errors.length
    ? `<ul style="margin:6px 0 0;padding-left:18px;color:#4b5563;font-size:12px">${o.errors.map((e) => `<li>${esc(fmtWhen(e.at))}: ${esc(e.error ?? "unknown error")}</li>`).join("")}</ul>`
    : "";
  return `
    ${health}${errors}
    <div style="margin-top:8px">
      ${stat("alerts sent", o.alerts)}
      ${stat("landlords flagged", o.alertsBySide.landlord)}
      ${stat("students flagged", o.alertsBySide.student)}
      ${stat("came back after a flag", o.recovered)}
    </div>
    <div style="color:#6b7280;font-size:12px">Came back: ${o.recoveredBySide.landlord} landlord${o.recoveredBySide.landlord === 1 ? "" : "s"}, ${o.recoveredBySide.student} student${o.recoveredBySide.student === 1 ? "" : "s"}. A thread is flagged after ${r.staleAfterDays} days without a reply, once per silence.</div>`;
}

function activityHtml(r) {
  const t = r.totals;
  const m = r.moderation;
  const reasons = Object.entries(m.byReason).sort((a, b) => b[1] - a[1]);
  return `
    <div>
      ${stat("active threads", t.activeThreads)}
      ${stat("new this week", t.newThreads)}
      ${stat("messages", t.messages)}
      ${stat("both sides wrote", t.threadsWithBothSides)}
    </div>
    <table style="border-collapse:collapse;margin-top:6px">
      ${row("Moderation flags", `${m.flagged} delivered with a flag, ${m.blocked} blocked`)}
      ${reasons.map(([k, v]) => row(`  ${k.replace(/_/g, " ")}`, v)).join("")}
    </table>`;
}

function aiHtml(r) {
  if (!r.ai) {
    return `<div style="color:#6b7280;font-size:13px">${r.totals.activeThreads === 0 ? "No conversations had activity this week, so there is nothing to analyse." : "AI analysis skipped: no API key configured (CHAT_CHECKIN_KEY or ANTHROPIC_API_KEY)."}</div>`;
  }
  const a = r.ai;
  const n = a.narrative;
  const stages = Object.entries(a.stageCounts).sort((x, y) => y[1] - x[1]);
  const offs = a.threads.filter((t) => t.offPlatform?.happened);
  return `
    ${n ? `<div style="font-weight:700;color:#0A0A0A;font-size:15px">${esc(n.headline)}</div><p style="color:#111;font-size:14px;line-height:1.5;margin:6px 0 0">${esc(n.narrative)}</p>` : `<div style="color:#6b7280;font-size:13px">The narrative could not be generated this week; the per-thread read is below.</div>`}
    ${n?.recommendations?.length ? `<div style="font-weight:700;font-size:13px;margin-top:10px">Try next week</div><ul style="margin:4px 0 0;padding-left:18px;color:#111;font-size:13px;line-height:1.5">${n.recommendations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <div style="margin-top:10px">
      ${stat("stayed on Proximity", a.keptOnProximity)}
      ${stat("moved or invited off", a.offPlatformThreads)}
      ${stat("classified", a.classified)}
      ${a.unclassified ? stat("could not classify", a.unclassified) : ""}
    </div>
    <table style="border-collapse:collapse;margin-top:4px">
      ${stages.map(([k, v]) => row(STAGE_LABELS[k] ?? k, v)).join("")}
    </table>
    ${offs.length ? `<div style="font-weight:700;font-size:13px;margin-top:12px">Threads that moved or were invited off Proximity</div>${offs.map((t) => `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin:6px 0"><div style="font-weight:600;font-size:13px;color:#0A0A0A">${esc(t.listing)} <span style="color:#6b7280;font-weight:400">&middot; ${esc(STAGE_LABELS[t.stage] ?? t.stage)} &middot; via ${esc(CHANNEL_LABELS[t.offPlatform.channel] ?? t.offPlatform.channel)}, first pushed by ${esc(t.offPlatform.initiatedBy)}</span></div><div style="font-size:13px;color:#4b5563;margin-top:2px">${esc(t.summary ?? "")}</div></div>`).join("")}` : ""}
    <div style="font-weight:700;font-size:13px;margin-top:14px">Every thread this week (${a.threads.length})</div>
    ${a.threads.map((t) => `<div style="padding:6px 0;border-bottom:1px solid #f3f4f6"><div style="font-size:13px;font-weight:600;color:#0A0A0A">${esc(t.listing)} <span style="color:#6b7280;font-weight:400">&middot; ${esc(STAGE_LABELS[t.stage] ?? t.stage)}</span></div><div style="font-size:12px;color:#4b5563">${esc(t.summary ?? t.error ?? "")}</div></div>`).join("")}
    <div style="color:#9ca3af;font-size:11px;margin-top:8px">Read by ${esc(a.model)}. Classifications are a model's judgement and worth a spot check.</div>`;
}

export function renderCheckinReport({ report, dryRun = false }) {
  const until = fmtWhen(report.window.until);
  const inner = `
    <h2 style="color:#111;font-size:18px;margin:0 0 6px">${dryRun ? "[DRY RUN] " : ""}Weekly chat report</h2>
    <p style="color:#4b5563;font-size:14px;margin:0">The ${report.window.days} days ending ${esc(until)} (Central time).</p>
    ${sectionHtml("How the daily check-in did", opsHtml(report))}
    ${sectionHtml("Conversation activity", activityHtml(report))}
    ${sectionHtml("Where conversations led", aiHtml(report), "#E82027")}
  `;
  return {
    subject: `${dryRun ? "[DRY RUN] " : ""}Weekly chat report: ${report.ops.alerts} alert${report.ops.alerts === 1 ? "" : "s"}, ${report.totals.activeThreads} active thread${report.totals.activeThreads === 1 ? "" : "s"}`,
    html: wrapHtml(inner),
  };
}

export async function sendCheckinReportEmail({ to, report, dryRun = false }) {
  const { subject, html } = renderCheckinReport({ report, dryRun });
  return sendMailSafe(checkinTransporter, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to,
    replyTo: "info@useproximity.org",
    subject,
    html,
  });
}
