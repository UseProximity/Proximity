export const dynamic = "force-dynamic";
export const maxDuration = 300;
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getBaseUrl, sendPmsSyncDigestEmail } from "@/lib/email";
import { isApiProvider } from "@/lib/pms/index.js";
import { syncConnection } from "@/lib/pms/sync.js";
import { holdReleaseUrl } from "@/lib/pms/holdToken.js";

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
  }
  if (!noteworthy.length) return;

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

    let recipients = process.env.PMS_ALERT_EMAIL ? [process.env.PMS_ALERT_EMAIL] : [];
    if (!recipients.length) {
      const { data: supers } = await supabase
        .from("users")
        .select("email, roles!inner(name)")
        .eq("roles.name", "super")
        .not("email", "is", null);
      recipients = (supers ?? []).map((u) => u.email);
    }
    if (!recipients.length) return;

    await sendPmsSyncDigestEmail({
      to: recipients.join(", "),
      items: noteworthy.map((n) => ({
        provider: n.provider,
        landlord: nameById.get(n.userId) || "",
        note: n.note,
      })),
      baseUrl,
    });
  } catch (err) {
    // The digest is best-effort; a mail failure must never fail the sync run.
    console.error("[pms-sync] digest email failed:", err?.message);
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
