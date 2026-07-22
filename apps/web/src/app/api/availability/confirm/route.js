/*
 * "Still available?" confirmation landing (signed links from the email in
 * lib/availabilityCheck.js). No login: the signed token IS the authorization
 * (emailed to the landlord, HMAC-verified, short expiry — same trust model as
 * a password-reset link).
 *
 * TWO STEPS, on purpose. The email's Yes/No links are GET requests, and
 * corporate mail-security scanners (Defender Safe Links, Mimecast, Proofpoint,
 * Gmail/Outlook prefetch) auto-fetch every URL in an inbound email. A GET that
 * hid or relisted a listing would be triggered by those bots with no human
 * involved. So:
 *   GET  /api/availability/confirm?token&answer=yes|no  -> renders a page with a
 *        Confirm button (READ-ONLY, safe for scanners to fetch)
 *   POST /api/availability/confirm  (token+answer in the form body)            -> mutates:
 *        yes -> listing stays/returns live, verification stamp refreshed
 *        no  -> listing hidden from search (never deleted; relist from dashboard)
 * Either answer closes any open review-queue rows. Writes go through the
 * audit-safe RPCs, attributed to the listing's primary landlord (system actor
 * when the listing has none). Idempotent — re-submitting is safe.
 */
export const dynamic = "force-dynamic";
import supabase from "@/lib/supabase";
import { verifyAvailabilityToken } from "@/lib/availabilityCheck";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
const ACTION_PATH = "/api/availability/confirm";

function shell(inner, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Availability — Proximity</title></head>
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
<p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 20px">${body}</p>
<a href="https://useproximity.org/dashboard/landlord" style="display:inline-block;padding:10px 20px;background:#E82027;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">Go to your dashboard</a>`,
    status
  );
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Resolve token+answer to the target listing (shared by GET and POST). Returns
// { listing, actorId, label } or a Response to return directly.
async function resolve(token, answer) {
  const verified = verifyAvailabilityToken(token);
  if (!verified || (answer !== "yes" && answer !== "no")) {
    return {
      error: message({
        status: 400,
        title: "This link has expired",
        body: "No worries, you can update availability anytime from your landlord dashboard.",
      }),
    };
  }
  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, address, unavailable, deleted_at, listing_landlords(user_id, is_primary)")
    .eq("id", verified.listingId)
    .maybeSingle();
  if (!listing || listing.deleted_at) {
    return { error: message({ status: 404, title: "Listing not found", body: "This listing no longer exists on Proximity." }) };
  }
  const ll = listing.listing_landlords ?? [];
  const actorId = (ll.find((x) => x.is_primary) ?? ll[0])?.user_id ?? SYSTEM_USER_ID;
  return { listing, actorId, label: listing.title || listing.address || "your listing" };
}

// Step 1: render a confirm page. NO writes — safe for mail scanners to fetch.
export async function GET(req) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const answer = url.searchParams.get("answer");
  const r = await resolve(token, answer);
  if (r.error) return r.error;

  const yes = answer === "yes";
  const verb = yes ? "still available" : "leased / off the market";
  const cta = yes ? "Yes, it's still available" : "Confirm it's leased";
  const btnColor = yes ? "#16a34a" : "#4b5563";
  return shell(
    `<h1 style="font-size:20px;color:#0A0A0A;margin:0 0 12px">One more tap</h1>
<p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 8px">Confirm that <strong>${esc(r.label)}</strong> is <strong>${verb}</strong>.</p>
<p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0 0 20px">${yes ? "Students will see availability confirmed by you today." : "It will be hidden from search. Nothing is deleted, and you can relist anytime from your dashboard."}</p>
<form method="POST" action="${ACTION_PATH}">
  <input type="hidden" name="token" value="${esc(token)}">
  <input type="hidden" name="answer" value="${esc(answer)}">
  <button type="submit" style="display:inline-block;padding:12px 24px;background:${btnColor};color:#fff;border:0;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer">${cta}</button>
</form>`
  );
}

// Step 2: perform the mutation. Only a real human clicking the button reaches here.
export async function POST(req) {
  let token, answer;
  const ctype = req.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    ({ token, answer } = await req.json().catch(() => ({})));
  } else {
    const form = await req.formData().catch(() => null);
    token = form?.get("token");
    answer = form?.get("answer");
  }

  const r = await resolve(token, answer);
  if (r.error) return r.error;
  const { listing, actorId, label } = r;

  const wantUnavailable = answer === "no";
  if (Boolean(listing.unavailable) !== wantUnavailable) {
    const { error } = await supabase.rpc("rpc_pms_apply", {
      p_user_id: actorId,
      p_listing_id: listing.id,
      p_listing_updates: { unavailable: wantUnavailable },
    });
    if (error) {
      console.error("[availability confirm]", listing.id, error.message);
      return message({
        status: 500,
        title: "Something went wrong",
        body: "We couldn't save that just now. Please try again, or update it from your dashboard.",
      });
    }
  }

  if (answer === "yes") {
    await supabase.rpc("rpc_pms_mark_verified", {
      p_user_id: actorId,
      p_listing_id: listing.id,
      p_source: "landlord-email",
    });
  }

  await supabase
    .from("pms_review_queue")
    .update({
      status: answer === "yes" ? "resolved_kept" : "resolved_hidden",
      resolved_by: actorId === SYSTEM_USER_ID ? null : actorId,
      resolved_at: new Date().toISOString(),
    })
    .eq("listing_id", listing.id)
    .eq("status", "open");

  return answer === "yes"
    ? message({ title: "Thanks, it stays live", body: `${esc(label)} now shows students availability confirmed by you today.` })
    : message({ title: "Marked as leased", body: `${esc(label)} is hidden from search. Nothing was deleted, and you can relist it anytime from your dashboard.` });
}
