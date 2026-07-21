/*
 * One-click availability confirmation — the landing endpoint for the signed
 * links in the "still available?" email (lib/availabilityCheck.js).
 *
 * GET /api/availability/confirm?token=...&answer=yes|no
 *
 * No login: the signed token IS the authorization (emailed to the landlord,
 * 30-day expiry, HMAC-verified — same trust model as a password-reset link).
 *   yes -> listing stays/returns live, verification stamp refreshed
 *   no  -> listing hidden from search (never deleted; relist from dashboard)
 * Either answer closes any open review-queue rows for the listing. Writes go
 * through the audit-safe RPCs attributed to the listing's primary landlord
 * (system actor when the listing has no account-holding landlord).
 * Idempotent — clicking twice is safe. Responds with a small branded page.
 */
export const dynamic = "force-dynamic";
import supabase from "@/lib/supabase";
import { verifyAvailabilityToken } from "@/lib/availabilityCheck";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

function page({ title, body, status = 200 }) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Proximity</title></head>
<body style="font-family:Inter,sans-serif;background:#fafafa;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="max-width:420px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;margin:16px;text-align:center">
<div style="color:#E82027;font-weight:800;letter-spacing:.08em;font-size:14px;margin-bottom:16px">PROXIMITY</div>
<h1 style="font-size:20px;color:#0A0A0A;margin:0 0 12px">${title}</h1>
<p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 20px">${body}</p>
<a href="https://useproximity.org/dashboard/landlord" style="display:inline-block;padding:10px 20px;background:#E82027;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">Go to your dashboard</a>
</div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req) {
  const url = new URL(req.url);
  const answer = url.searchParams.get("answer");
  const verified = verifyAvailabilityToken(url.searchParams.get("token"));

  if (!verified || (answer !== "yes" && answer !== "no")) {
    return page({
      status: 400,
      title: "This link has expired",
      body: "No worries — you can update availability anytime from your landlord dashboard.",
    });
  }

  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, address, unavailable, deleted_at, listing_landlords(user_id, is_primary)")
    .eq("id", verified.listingId)
    .maybeSingle();
  if (!listing || listing.deleted_at) {
    return page({
      status: 404,
      title: "Listing not found",
      body: "This listing no longer exists on Proximity.",
    });
  }

  const ll = listing.listing_landlords ?? [];
  const actorId = (ll.find((x) => x.is_primary) ?? ll[0])?.user_id ?? SYSTEM_USER_ID;
  const label = listing.title || listing.address || "your listing";

  const wantUnavailable = answer === "no";
  if (Boolean(listing.unavailable) !== wantUnavailable) {
    const { error } = await supabase.rpc("rpc_pms_apply", {
      p_user_id: actorId,
      p_listing_id: listing.id,
      p_listing_updates: { unavailable: wantUnavailable },
    });
    if (error) {
      console.error("[availability confirm]", listing.id, error.message);
      return page({
        status: 500,
        title: "Something went wrong",
        body: "We couldn't save that just now. Please try again, or update it from your dashboard.",
      });
    }
  }

  if (answer === "yes") {
    // Freshness stamp: the landlord just confirmed it, first-hand.
    await supabase.rpc("rpc_pms_mark_verified", {
      p_user_id: actorId,
      p_listing_id: listing.id,
      p_source: "landlord-email",
    });
  }

  // Either answer resolves any open review-queue rows for this listing.
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
    ? page({
        title: "Thanks — it stays live",
        body: `${label} now shows students availability confirmed by you today.`,
      })
    : page({
        title: "Marked as leased",
        body: `${label} is hidden from search. Nothing was deleted — relist it anytime from your dashboard.`,
      });
}
