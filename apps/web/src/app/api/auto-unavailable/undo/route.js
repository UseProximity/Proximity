/*
 * One-click "Undo — relist" landing for auto-unavailable hides (links come from
 * the daily review email in lib/autoUnavailable.js; recipients are internal only).
 *
 * TWO STEPS, on purpose — the same scanner-safety model as the availability
 * confirm flow: corporate mail scanners auto-fetch every link in an email, so a
 * GET must never mutate.
 *   GET  ?token=...  -> READ-ONLY confirm page (safe for scanners)
 *   POST (token in form body) -> restores exactly what the action hid, via the
 *        audited rpc_pms_apply, then re-checks the public API.
 *
 * Single-use: the token references one auto_unavailable_actions row, and the
 * row must still be status 'applied' when redeemed — a second click lands on a
 * friendly "already relisted" page and changes nothing. Expired/tampered tokens
 * are refused. Nothing here can delete a listing or touch a check-in column.
 */
export const dynamic = "force-dynamic";
import supabase from "@/lib/supabase";
import { SYSTEM_USER_ID, verifyUndoToken, verifyVisible } from "@/lib/autoUnavailable";

const ACTION_PATH = "/api/auto-unavailable/undo";

function shell(inner, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relist — Proximity</title></head>
<body style="font-family:Inter,sans-serif;background:#fafafa;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="max-width:440px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;margin:16px;text-align:center">
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

// Resolve token -> { action, label } or { error: Response }.
async function resolve(token) {
  const verified = verifyUndoToken(token);
  if (!verified) {
    return {
      error: message({
        status: 400,
        title: "This link has expired",
        body: "You can still relist the listing from the admin dashboard (Hide toggle).",
      }),
    };
  }
  const { data: action } = await supabase
    .from("auto_unavailable_actions")
    .select("id, listing_id, scope, status, listings(id, title, address, deleted_at)")
    .eq("id", verified.actionId)
    .maybeSingle();
  if (!action || !action.listings || action.listings.deleted_at) {
    return { error: message({ status: 404, title: "Not found", body: "This action or its listing no longer exists." }) };
  }
  if (action.status !== "applied") {
    return {
      error: message({
        title: "Already relisted",
        body: `${esc(action.listings.title || action.listings.address || "This listing")} was already restored — nothing else to do.`,
      }),
    };
  }
  return { action, label: action.listings.title || action.listings.address || "this listing" };
}

// Step 1: read-only confirm page.
export async function GET(req) {
  const token = new URL(req.url).searchParams.get("token");
  const r = await resolve(token);
  if (r.error) return r.error;
  const what = r.action.scope?.units?.length
    ? `${r.action.scope.units.length} hidden unit type(s) of <strong>${esc(r.label)}</strong>`
    : `<strong>${esc(r.label)}</strong>`;
  return shell(
    `<h1 style="font-size:20px;color:#0A0A0A;margin:0 0 12px">One more tap</h1>
<p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 20px">Relist ${what} so students can see it again?</p>
<form method="POST" action="${ACTION_PATH}">
  <input type="hidden" name="token" value="${esc(token)}">
  <button type="submit" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;border:0;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer">Yes, relist it</button>
</form>`
  );
}

// Step 2: restore exactly what the action hid. Only a human click reaches here.
export async function POST(req) {
  let token;
  const ctype = req.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    ({ token } = await req.json().catch(() => ({})));
  } else {
    const form = await req.formData().catch(() => null);
    token = form?.get("token");
  }

  const r = await resolve(token);
  if (r.error) return r.error;
  const { action, label } = r;

  const args = { p_user_id: SYSTEM_USER_ID, p_listing_id: action.listing_id };
  if (action.scope?.units?.length) {
    // Restore exactly the offerings this action withdrew — the ids were recorded
    // in scope at hide time. Without them a relist would revive every withdrawn
    // lease on the unit, including ones another landlord pulled for their own
    // reasons and this action never touched.
    args.p_unit_updates = action.scope.units.map((u) => ({
      id: u.id,
      available: true,
      lease_ids: u.leaseIds ?? null,
    }));
  } else {
    args.p_listing_updates = { unavailable: false };
  }
  const { error } = await supabase.rpc("rpc_pms_apply", args);
  if (error) {
    console.error("[auto-unavailable undo]", action.id, error.message);
    return message({
      status: 500,
      title: "Something went wrong",
      body: "The relist didn't save. Try again, or use the admin dashboard's Hide toggle.",
    });
  }

  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${req.headers.get("host")}`;
  const verify = await verifyVisible(action.listing_id, action.scope, baseUrl);

  await supabase
    .from("auto_unavailable_actions")
    .update({ status: "undone", undone_at: new Date().toISOString(), undo_verify_result: verify })
    .eq("id", action.id)
    .eq("status", "applied");

  return message({
    title: "Relisted",
    body: `${esc(label)} is visible to students again (${esc(verify)}). This report won't re-hide it — only a new landlord report can.`,
  });
}
