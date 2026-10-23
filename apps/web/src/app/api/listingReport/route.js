/*
 * POST /api/listingReport { listingId, reason, details? }
 *
 * Reports a listing itself (its photos, text or contact details) for the team to look at.
 * Signed-in users only. The reported landlord is read from the listing here, never taken
 * from the client, and the reporter is not told who that is. A person cannot report a
 * listing they have a stake in. Reporting the same listing twice is a harmless no-op.
 *
 * Reports are a plain queue in listing_reports (service role only), like chat_reports and
 * review_reports.
 *
 * @auth user
 */
import { NextResponse } from "next/server";
import { LISTING_REPORT_REASONS, LISTING_REPORT_DETAILS_MAX } from "@proximity/shared";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { hasStakeInListing } from "@/lib/listings/ownership";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req) {
  try {
    // Web cookie or mobile Bearer token.
    const authUser = await getRequestUser(req);
    if (!authUser?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { listingId, reason } = body ?? {};
    if (typeof listingId !== "string" || !UUID_RE.test(listingId)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const reasonOption = LISTING_REPORT_REASONS.find((r) => r.value === reason);
    if (!reasonOption) {
      return NextResponse.json({ error: "Choose a reason for your report" }, { status: 400 });
    }

    let details = null;
    if (body.details !== undefined && body.details !== null) {
      if (typeof body.details !== "string") {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }
      details = body.details.trim() || null;
      if (details && details.length > LISTING_REPORT_DETAILS_MAX) {
        return NextResponse.json(
          { error: `Details must be ${LISTING_REPORT_DETAILS_MAX} characters or fewer` },
          { status: 400 }
        );
      }
    }

    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .select("id, deleted_at, listing_landlords(user_id, is_primary)")
      .eq("id", listingId)
      .maybeSingle();
    if (listingError) {
      console.error("[listingReport] listing lookup failed:", listingError.message);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
    if (!listing || listing.deleted_at) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (await hasStakeInListing(authUser.id, listingId)) {
      return NextResponse.json({ error: "You can't report your own listing" }, { status: 400 });
    }

    const landlords = listing.listing_landlords ?? [];
    const reportedUserId = (landlords.find((l) => l.is_primary) ?? landlords[0])?.user_id ?? null;

    const { error: insertError } = await supabase.from("listing_reports").insert({
      reporter_id: authUser.id,
      listing_id: listingId,
      reported_user_id: reportedUserId,
      reason,
      details,
    });

    // 23505 = already reported by this user. Treat as success.
    if (insertError?.code === "23505") {
      return NextResponse.json({ ok: true, alreadyReported: true });
    }
    if (insertError) {
      console.error("[listingReport] insert failed:", insertError.message);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[listingReport] unexpected error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
