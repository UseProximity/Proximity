/*
 * Daily cron: tell the team which conversations are waiting on a reply.
 *
 * A thread where the newest message is 3 days old and the other side has said
 * nothing since is emailed to the internal recipients (lib/chat/checkin.js),
 * in two sections: landlords who went quiet, students who went quiet. Each
 * entry carries the last messages from both people so the reader can judge
 * it without opening the dashboard.
 *
 * The same run sends the quiet person one reminder (Wyatt, 2026-10-16): the
 * normal message alert again, with a line on top saying the other side is
 * still waiting. Skipped when the silence started more than
 * REMINDER_MAX_AGE_DAYS ago, the listing is unavailable, or either person has
 * blocked the other. The outcome is stored on the alert row (reminder_status).
 * Dry runs send no reminders; the JSON says which would have gone out.
 *
 * The same email carries the delivery audit (lib/chat/deliveryAudit.js, Wyatt,
 * 2026-10-23): every message since the last run that the other side was not
 * emailed about, every alert email not confirmed delivered, and every emailed
 * reply that was not posted. The email goes out when there is a silence to
 * report or the audit found a problem.
 *
 * Each silence is reported once. chat_checkin_alerts remembers which
 * unanswered message a thread was alerted on; the same message is never sent
 * again, but a newer message that then goes unanswered is. Every run, success
 * or failure, is logged to chat_checkin_runs for the weekly report.
 *
 * Modes:
 *   ?dry_run=1  compute and return the digest as JSON, send the email marked
 *               [DRY RUN], write nothing that would stop a later real run.
 *   ?html=1     with dry_run: return the email as HTML instead of JSON and
 *               send nothing. For checking the layout.
 *   ?audit_since=<ISO date>  with dry_run: start the delivery audit there
 *               instead of at the last run, to look back over a longer stretch.
 *
 * Off production, sendMailSafe redirects the email to OUTREACH_TEST_RECIPIENT
 * or suppresses it, so staging and local never reach the real inboxes.
 *
 * @auth cron
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { sendReplyReminder } from "@/lib/chat/notifyEmail";
import { assertThreadNotBlocked } from "@/lib/chat/safety";
import { unavailableListingIds, silenceIsTooOld } from "@/lib/chat/followups";
import { auditChatDelivery, auditHasProblems } from "@/lib/chat/deliveryAudit";
import {
  findStaleThreads,
  sendCheckinDigestEmail,
  renderCheckinDigest,
  resolveCheckinRecipients,
  STALE_AFTER_DAYS,
} from "@/lib/chat/checkin";

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const htmlPreview = dryRun && url.searchParams.get("html") === "1";
  const startedAt = new Date();
  const recipients = resolveCheckinRecipients();
  const stats = { staleFound: 0, alreadyAlerted: 0, alerted: 0, landlordsQuiet: 0, studentsQuiet: 0, emailed: false, reminders: {} };

  try {
    // Before anything is sent, so this run's reminders are not in its own window.
    let audit;
    try {
      const auditSince = dryRun ? Date.parse(url.searchParams.get("audit_since") ?? "") : NaN;
      audit = await auditChatDelivery(supabase, {
        now: startedAt,
        since: Number.isFinite(auditSince) ? new Date(auditSince) : undefined,
      });
      stats.audit = audit.stats;
    } catch (err) {
      console.error("[chat-checkin] delivery audit failed:", err);
      audit = { error: String(err?.message ?? err) };
      stats.audit = { error: audit.error };
    }
    const auditFlagged = Boolean(audit.error) || auditHasProblems(audit);

    const stale = await findStaleThreads(supabase, { now: startedAt, days: STALE_AFTER_DAYS });
    stats.staleFound = stale.length;

    // Drop every silence that has already been reported.
    let fresh = stale;
    let outcomes = [];
    if (stale.length > 0) {
      const { data: prior, error } = await supabase
        .from("chat_checkin_alerts")
        .select("thread_id, last_message_id")
        .eq("dry_run", false)
        .in("thread_id", stale.map((s) => s.threadId));
      if (error) throw new Error(`alert lookup failed: ${error.message}`);
      const seen = new Set((prior ?? []).map((a) => `${a.thread_id}|${a.last_message_id}`));
      fresh = stale.filter((s) => !seen.has(`${s.threadId}|${s.lastMessage.id}`));
      stats.alreadyAlerted = stale.length - fresh.length;
    }

    stats.landlordsQuiet = fresh.filter((s) => s.quietSide === "landlord").length;
    stats.studentsQuiet = fresh.filter((s) => s.quietSide === "student").length;

    if (htmlPreview) {
      const { html } = renderCheckinDigest({ items: fresh, audit, baseUrl: getBaseUrl(), dryRun: true });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (fresh.length > 0 || auditFlagged) {
      const sent = await sendCheckinDigestEmail({
        to: recipients,
        items: fresh,
        audit,
        baseUrl: getBaseUrl(),
        dryRun,
      });
      stats.emailed = !sent?.suppressed;
    }

    if (fresh.length > 0) {
      const rows = fresh.map((s) => ({
        thread_id: s.threadId,
        last_message_id: s.lastMessage.id,
        quiet_side: s.quietSide,
        silent_since: s.silentSince,
        recipients,
        dry_run: dryRun,
      }));
      const { error: insertError } = await supabase.from("chat_checkin_alerts").insert(rows);
      if (insertError) throw new Error(`alert insert failed: ${insertError.message}`);
      stats.alerted = fresh.length;

      outcomes = await sendReminders(fresh, { now: startedAt, dryRun });
      for (const o of outcomes) stats.reminders[o.status] = (stats.reminders[o.status] ?? 0) + 1;
      if (!dryRun) {
        for (const o of outcomes) {
          const { error: updateError } = await supabase
            .from("chat_checkin_alerts")
            .update({ reminder_status: o.status, reminder_sent_at: o.status === "sent" ? new Date().toISOString() : null })
            .eq("thread_id", o.threadId)
            .eq("last_message_id", o.messageId)
            .eq("dry_run", false);
          if (updateError) console.error("[chat-checkin] reminder status update failed:", updateError.message);
        }
      }
    }

    await logRun({ startedAt, ok: true, dryRun, stats });
    console.log(`[chat-checkin] stale=${stats.staleFound} new=${stats.alerted} emailed=${stats.emailed}`);

    return NextResponse.json({
      dryRun,
      ...stats,
      recipients,
      ...(dryRun ? { audit } : {}),
      items: (() => {
        const reminderOf = new Map(outcomes.map((o) => [o.threadId, o.status]));
        return fresh.map((s) => ({
          ...(dryRun ? s : { threadId: s.threadId, quietSide: s.quietSide, silentDays: s.silentDays }),
          reminder: reminderOf.get(s.threadId) ?? null,
        }));
      })(),
    });
  } catch (err) {
    console.error("[chat-checkin] failed:", err);
    await logRun({ startedAt, ok: false, dryRun, stats, error: String(err?.message ?? err) });
    return NextResponse.json({ error: "Chat check-in failed" }, { status: 500 });
  }
}

/*
 * One reminder per fresh silence, to the side we are waiting on. In a dry run
 * nothing is sent and the status says what would have happened ("would_send").
 */
async function sendReminders(items, { now, dryRun }) {
  const unavailable = await unavailableListingIds(items.map((s) => s.listing?.id));
  const out = [];
  for (const s of items) {
    const waitingId = s.quietSide === "landlord" ? s.student.id : s.landlord.id;
    let status;
    if (silenceIsTooOld(s.silentSince, now)) status = "too_old";
    else if (s.listing?.id && unavailable.has(s.listing.id)) status = "listing_unavailable";
    else if (!(await assertThreadNotBlocked(s.threadId, waitingId)).ok) status = "blocked";
    else if (dryRun) status = "would_send";
    else status = await sendReplyReminder({ threadId: s.threadId, senderId: waitingId, baseUrl: getBaseUrl() });
    out.push({ threadId: s.threadId, messageId: s.lastMessage.id, status });
  }
  return out;
}

async function logRun({ startedAt, ok, dryRun, stats, error = null }) {
  const { error: logError } = await supabase.from("chat_checkin_runs").insert({
    kind: "checkin",
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    ok,
    dry_run: dryRun,
    stats,
    error,
  });
  if (logError) console.error("[chat-checkin] run log failed:", logError.message);
}
