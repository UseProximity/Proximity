/*
 * Weekly cron (Mondays, see vercel.json): the chat check-in report.
 *
 * Builds lib/chat/checkinReport.js for the last 7 days and emails it to the
 * internal recipients: how the daily check-in performed, conversation
 * activity, and the AI read of where conversations led. Every run is logged
 * to chat_checkin_runs.
 *
 * Modes:
 *   ?dry_run=1  build the report, email it marked [DRY RUN], return the JSON.
 *   ?no_ai=1    skip the model calls (ops and activity only). Handy locally.
 *   ?html=1     with dry_run: return the email as HTML and send nothing.
 *
 * Off production, sendMailSafe redirects or suppresses the email.
 *
 * @auth cron
 */
export const dynamic = "force-dynamic";
// Up to a few dozen model calls at a few seconds each.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { resolveCheckinRecipients } from "@/lib/chat/checkin";
import { buildCheckinReport, sendCheckinReportEmail, renderCheckinReport, aiConfigured } from "@/lib/chat/checkinReport";

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const htmlPreview = dryRun && url.searchParams.get("html") === "1";
  const withAi = url.searchParams.get("no_ai") !== "1" && aiConfigured();
  const startedAt = new Date();
  const recipients = resolveCheckinRecipients();

  try {
    const report = await buildCheckinReport(supabase, { now: startedAt, withAi });
    if (htmlPreview) {
      const { html } = renderCheckinReport({ report, dryRun: true });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const sent = await sendCheckinReportEmail({ to: recipients, report, dryRun });
    const stats = {
      emailed: !sent?.suppressed,
      withAi,
      alerts: report.ops.alerts,
      activeThreads: report.totals.activeThreads,
      classified: report.ai?.classified ?? 0,
      unclassified: report.ai?.unclassified ?? 0,
      narrative: Boolean(report.ai?.narrative),
    };
    await logRun({ startedAt, ok: true, dryRun, stats });
    console.log(`[chat-checkin-report] threads=${stats.activeThreads} classified=${stats.classified} emailed=${stats.emailed}`);
    return NextResponse.json({ dryRun, recipients, ...stats, report });
  } catch (err) {
    console.error("[chat-checkin-report] failed:", err);
    await logRun({ startedAt, ok: false, dryRun, stats: {}, error: String(err?.message ?? err) });
    return NextResponse.json({ error: "Chat check-in report failed" }, { status: 500 });
  }
}

async function logRun({ startedAt, ok, dryRun, stats, error = null }) {
  const { error: logError } = await supabase.from("chat_checkin_runs").insert({
    kind: "report",
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    ok,
    dry_run: dryRun,
    stats,
    error,
  });
  if (logError) console.error("[chat-checkin-report] run log failed:", logError.message);
}
