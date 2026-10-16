/*
 * Daily cron: tell the team which conversations are waiting on a reply.
 *
 * A thread where the newest message is 3 days old and the other side has said
 * nothing since is emailed to the internal recipients (lib/chat/checkin.js),
 * in two sections: landlords who went quiet, students who went quiet. Each
 * entry carries the last messages from both people so the reader can judge
 * it without opening the dashboard.
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
  const stats = { staleFound: 0, alreadyAlerted: 0, alerted: 0, landlordsQuiet: 0, studentsQuiet: 0, emailed: false };

  try {
    const stale = await findStaleThreads(supabase, { now: startedAt, days: STALE_AFTER_DAYS });
    stats.staleFound = stale.length;

    // Drop every silence that has already been reported.
    let fresh = stale;
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
      const { html } = renderCheckinDigest({ items: fresh, baseUrl: getBaseUrl(), dryRun: true });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (fresh.length > 0) {
      const sent = await sendCheckinDigestEmail({
        to: recipients,
        items: fresh,
        baseUrl: getBaseUrl(),
        dryRun,
      });
      stats.emailed = !sent?.suppressed;

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
    }

    await logRun({ startedAt, ok: true, dryRun, stats });
    console.log(`[chat-checkin] stale=${stats.staleFound} new=${stats.alerted} emailed=${stats.emailed}`);

    return NextResponse.json({
      dryRun,
      ...stats,
      recipients,
      items: dryRun ? fresh : fresh.map((s) => ({ threadId: s.threadId, quietSide: s.quietSide, silentDays: s.silentDays })),
    });
  } catch (err) {
    console.error("[chat-checkin] failed:", err);
    await logRun({ startedAt, ok: false, dryRun, stats, error: String(err?.message ?? err) });
    return NextResponse.json({ error: "Chat check-in failed" }, { status: 500 });
  }
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
