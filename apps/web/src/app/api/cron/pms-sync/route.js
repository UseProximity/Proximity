export const dynamic = "force-dynamic";
export const maxDuration = 300;
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getBaseUrl, sendPmsSyncDigestEmail } from "@/lib/email";
import { isApiProvider } from "@/lib/pms/index.js";
import { syncConnection } from "@/lib/pms/sync.js";
import { holdReleaseUrl } from "@/lib/pms/holdToken.js";
import { pmsAlertRecipients } from "@/lib/pms/alerts.js";

/*
 * Daily PMS sync driver. The actual reconcile logic lives in lib/pms/sync.js
 * (shared with the post-confirm immediate first sync and the hold release
 * page). This route authenticates the cron, loops the active connections,
 * and sends the admin digest.
 */

// New connections get every applied change reported by email for this many
// days, so a human watches the integration find its feet without any manual
// dry-run ceremony. After the window: only problems are emailed.
const WATCH_DAYS = Number(process.env.PMS_WATCH_DAYS) || 21;

// Pilot mode: also email on a completely uneventful run. Normally silence means
// "nothing worth your attention", but while health-checking a new integration
// silence is ambiguous — it reads the same as a cron that never fired. With this
// set, every run reports, including "synced, no changes".
const DIGEST_ALWAYS = process.env.PMS_DIGEST_ALWAYS === "1";

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: connections } = await supabase
    .from("pms_connections")
    .select("id, user_id, provider, nango_connection_id, credential_meta, radius_auto_include_km, sync_price, auto_apply, status, created_at")
    .eq("status", "active")
    .is("deleted_at", null);

  const summary = [];
  for (const connection of connections ?? []) {
    // Scrape/aggregator providers have no API connector — their signal-only
    // path lives elsewhere (review queue). API connections always sync; with
    // auto_apply=false the sync observes and logs instead of writing.
    if (!isApiProvider(connection.provider)) continue;
    try {
      const result = await syncConnection(connection, { dryRun: !connection.auto_apply });
      summary.push({ provider: connection.provider, userId: connection.user_id, createdAt: connection.created_at, ...result });
    } catch (err) {
      console.error("[pms-sync]", connection.id, err?.message);
      await supabase
        .from("pms_connections")
        .update({ last_sync_at: new Date().toISOString(), last_sync_status: "error", last_sync_error: (err?.message || "sync failed").slice(0, 500) })
        .eq("id", connection.id);
      summary.push({ provider: connection.provider, userId: connection.user_id, createdAt: connection.created_at, connectionId: connection.id, status: "error", error: err?.message });
    }
  }

  await sendDigest(summary, req);

  return NextResponse.json({ synced: summary.length, summary });
}

// Human-in-the-loop notification: one email per run when there is anything a
// human should see. Always: errors, guard holds (with a one-click release
// link), suppressed delists, dry-run observations. During a connection's
// first WATCH_DAYS: every applied change, so new integrations are watched.
async function sendDigest(summary, req) {
  const noteworthy = [];
  for (const s of summary) {
    const changes = (s.created ?? 0) + (s.updated ?? 0) + (s.delisted ?? 0) + (s.relisted ?? 0);
    const ageDays = s.createdAt ? (Date.now() - new Date(s.createdAt).getTime()) / 86400_000 : Infinity;
    if (s.status === "error") {
      noteworthy.push({ ...s, hold: true, note: `Sync failed: ${escapeHtml(s.error || "unknown error")}. The connection may need reconnecting.` });
    } else if (s.status === "held") {
      noteworthy.push({ ...s, hold: true, note: "Held by the swing guard: too much of the portfolio changed at once. Nothing was applied." });
    } else if (s.heldDelists) {
      noteworthy.push({ ...s, hold: true, note: `${s.heldDelists} delist${s.heldDelists === 1 ? "" : "s"} suppressed and held for review (mass delist or degraded pull). Other updates applied normally.` });
    } else if (s.status === "dry_run" && changes > 0) {
      noteworthy.push({ ...s, note: `Dry run: ${changes} intended change${changes === 1 ? "" : "s"} recorded, nothing applied.` });
    } else if (changes > 0 && ageDays <= WATCH_DAYS) {
      const parts = [];
      if (s.created) parts.push(`${s.created} created`);
      if (s.updated) parts.push(`${s.updated} updated`);
      if (s.delisted) parts.push(`${s.delisted} delisted`);
      if (s.relisted) parts.push(`${s.relisted} relisted`);
      noteworthy.push({ ...s, note: `New-connection watch (day ${Math.ceil(ageDays)} of ${WATCH_DAYS}): applied ${parts.join(", ")}.` });
    }

    // A run can succeed and still have done less than it should — e.g. AppFolio's
    // rent_roll columns not matching any spelling we know, so no lease end dates
    // were read. Always report these, independent of the watch window, since they
    // are exactly the mismatches a new integration exists to surface.
    for (const w of s.warnings ?? []) {
      noteworthy.push({ ...s, note: `Warning: ${escapeHtml(w)}` });
    }
  }
  // Tracked before the all-clear filler is added below, so the calm subject is
  // used only when there was genuinely nothing to report.
  let allClear = false;

  if (!noteworthy.length) {
    if (!DIGEST_ALWAYS) return;
    allClear = true;
    // All-clear report. Sent from the same path as a real digest so the pilot is
    // exercising the actual delivery route, not a special case that could pass
    // while the real one is broken.
    if (!summary.length) {
      noteworthy.push({ note: "Sync ran. No active API-backed connections to sync." });
    } else {
      for (const s of summary) {
        noteworthy.push({ ...s, note: "Synced, no changes." });
      }
    }
  }

  try {
    const baseUrl = getBaseUrl(req);

    // Attach a one-click release link to every held item's open review row.
    for (const n of noteworthy) {
      if (!n.hold || n.status === "error") continue;
      const { data: openHold } = await supabase
        .from("pms_review_queue")
        .select("id")
        .eq("connection_id", n.connectionId)
        .eq("reason", "swing_guard_hold")
        .eq("status", "open")
        .maybeSingle();
      if (openHold) {
        n.note += ` <a href="${holdReleaseUrl(openHold.id, baseUrl)}" style="color:#E82027;font-weight:600">Review and release this hold</a>`;
      }
    }

    const userIds = [...new Set(noteworthy.map((n) => n.userId).filter(Boolean))];
    const { data: landlords } = userIds.length
      ? await supabase.from("users").select("id, name, email").in("id", userIds)
      : { data: [] };
    const nameById = new Map((landlords ?? []).map((u) => [u.id, u.name || u.email]));

    // Shared with the onboarding reports so the two audiences can't drift.
    const recipients = await pmsAlertRecipients();
    if (!recipients.length) return;

    await sendPmsSyncDigestEmail({
      to: recipients.join(", "),
      items: noteworthy.map((n) => ({
        provider: n.provider,
        landlord: nameById.get(n.userId) || "",
        note: n.note,
      })),
      baseUrl,
      allClear,
    });
  } catch (err) {
    // The digest is best-effort; a mail failure must never fail the sync run.
    console.error("[pms-sync] digest email failed:", err?.message);
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
