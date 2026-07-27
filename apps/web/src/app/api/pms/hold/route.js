/*
 * PMS swing-guard hold release page (signed links from the sync digest email
 * in lib/email.js). No login: the HMAC-signed token IS the authorization,
 * same trust model as /api/availability/confirm.
 *
 * TWO STEPS, on purpose (mail scanners auto-fetch every link in an email):
 *   GET  /api/pms/hold?token=...  -> renders the hold's details with a
 *        Release button (READ-ONLY, safe for scanners to fetch)
 *   POST /api/pms/hold (token+action in the form body) -> mutates:
 *        release -> hold status 'approved'; the connection is re-synced
 *                   immediately, and the approval is consumed by that run
 *        keep    -> hold status 'dismissed'; the guard keeps suppressing
 *                   (a new hold reopens while the condition persists)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;
import supabase from "@/lib/supabase";
import { verifyHoldToken } from "@/lib/pms/holdToken";
import { syncConnection } from "@/lib/pms/sync";
import { isApiProvider } from "@/lib/pms/index.js";

const ACTION_PATH = "/api/pms/hold";

function shell(inner, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PMS sync hold — Proximity</title></head>
<body style="font-family:Inter,sans-serif;background:#fafafa;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="max-width:460px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;margin:16px;text-align:center">
<div style="color:#E82027;font-weight:800;letter-spacing:.08em;font-size:14px;margin-bottom:16px">PROXIMITY</div>
${inner}
</div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

function message({ title, body, status = 200 }) {
  return shell(
    `<h1 style="font-size:20px;color:#0A0A0A;margin:0 0 12px">${title}</h1>
<p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0">${body}</p>`,
    status
  );
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Resolve a token to its open hold + connection, or a ready-to-return error page.
async function resolve(token) {
  const verified = verifyHoldToken(token);
  if (!verified) {
    return { error: message({ status: 400, title: "This link has expired", body: "If the hold is still open, tomorrow's digest email will include a fresh link." }) };
  }
  const { data: hold } = await supabase
    .from("pms_review_queue")
    .select("id, connection_id, reason, status, detail, created_at")
    .eq("id", verified.holdId)
    .maybeSingle();
  if (!hold || hold.reason !== "swing_guard_hold") {
    return { error: message({ status: 404, title: "Hold not found", body: "This hold no longer exists." }) };
  }
  if (hold.status !== "open") {
    return { error: message({ title: "Already handled", body: `This hold was already ${hold.status === "approved" ? "released" : "closed"}. Nothing more to do.` }) };
  }
  const { data: connection } = await supabase
    .from("pms_connections")
    .select("id, user_id, provider, nango_connection_id, credential_meta, radius_auto_include_km, sync_price, auto_apply, status")
    .eq("id", hold.connection_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!connection || !isApiProvider(connection.provider)) {
    return { error: message({ status: 404, title: "Connection not found", body: "The PMS connection behind this hold was disconnected." }) };
  }
  const { data: owner } = await supabase.from("users").select("name, email").eq("id", connection.user_id).maybeSingle();
  return { hold, connection, ownerLabel: owner?.name || owner?.email || "this landlord" };
}

function describe(detail) {
  if (detail?.intendedDelists != null) {
    return `The sync wants to take ${detail.intendedDelists} of ${detail.totalListings} synced listing${detail.totalListings === 1 ? "" : "s"} off the site because their PMS shows every unit occupied.`;
  }
  if (detail?.missing != null) {
    return `${detail.missing} of ${detail.tracked} tracked units disappeared from the PMS at once${detail.new ? `, and ${detail.new} new ones appeared` : ""}.`;
  }
  return "The sync saw an unusually large portfolio change.";
}

// Step 1: render the hold with a Release button. NO writes — scanner-safe.
export async function GET(req) {
  const token = new URL(req.url).searchParams.get("token");
  const r = await resolve(token);
  if (r.error) return r.error;
  const { hold, connection, ownerLabel } = r;
  return shell(
    `<h1 style="font-size:20px;color:#0A0A0A;margin:0 0 12px">Sync held for review</h1>
<p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 8px">
  <strong style="text-transform:capitalize">${esc(connection.provider)}</strong> connection for
  <strong>${esc(ownerLabel)}</strong>, held ${esc(new Date(hold.created_at).toLocaleDateString())}.
</p>
<p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 8px">${esc(describe(hold.detail))}</p>
<p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 20px">
  Real mass changes happen (end-of-semester lease-ups). If this looks right, release the hold
  and the changes apply immediately. If it looks like a glitch, keep holding: students keep
  seeing the listings, nothing is hidden.
</p>
<form method="POST" action="${ACTION_PATH}" style="display:inline-block;margin-right:8px">
  <input type="hidden" name="token" value="${esc(token)}">
  <input type="hidden" name="action" value="release">
  <button type="submit" style="padding:10px 20px;background:#E82027;color:#fff;border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer">Release and apply</button>
</form>
<form method="POST" action="${ACTION_PATH}" style="display:inline-block">
  <input type="hidden" name="token" value="${esc(token)}">
  <input type="hidden" name="action" value="keep">
  <button type="submit" style="padding:10px 20px;background:#fff;color:#0A0A0A;border:1px solid #d1d5db;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer">Keep holding</button>
</form>`
  );
}

// Step 2: mutate on an explicit form POST only.
export async function POST(req) {
  const form = await req.formData().catch(() => null);
  const token = form?.get("token");
  const action = form?.get("action");
  if (action !== "release" && action !== "keep") {
    return message({ status: 400, title: "Something went wrong", body: "This request was missing its action. Use the buttons from the email link." });
  }
  const r = await resolve(token);
  if (r.error) return r.error;
  const { hold, connection } = r;

  if (action === "keep") {
    await supabase.from("pms_review_queue").update({ status: "dismissed", resolved_at: new Date().toISOString() }).eq("id", hold.id);
    return message({ title: "Hold kept", body: "Nothing was applied. If the situation persists, tomorrow's sync will reopen the hold and the digest will include a fresh link." });
  }

  await supabase.from("pms_review_queue").update({ status: "approved", resolved_at: new Date().toISOString() }).eq("id", hold.id);
  try {
    const result = await syncConnection(connection, { dryRun: !connection.auto_apply });
    const parts = [];
    if (result.delisted) parts.push(`${result.delisted} delisted`);
    if (result.relisted) parts.push(`${result.relisted} relisted`);
    if (result.updated) parts.push(`${result.updated} updated`);
    if (result.created) parts.push(`${result.created} created`);
    return message({
      title: "Hold released",
      body: `The sync re-ran immediately: ${parts.length ? parts.join(", ") : "no changes were needed"}. The approval was single-use; the guards are back on for future runs.`,
    });
  } catch (err) {
    console.error("[pms/hold] release re-sync failed:", err?.message);
    return message({
      title: "Hold released",
      body: "The approval is saved, but the immediate re-sync hit an error; tonight's scheduled sync will apply the changes instead.",
    });
  }
}
