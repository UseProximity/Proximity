export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { getOwnedListings } from "@/lib/listings/ownership";
import { canViewAs, resolveDashboardUserId } from "@/lib/users/viewAs";
import { getListingPreview } from "@/lib/listings/getListing";

/*
 * GET /api/landlord/listings/[listingId]/preview
 *
 * The listing as a student sees it, for the people who own it. The dashboard's
 * "View as Student" used to send a landlord to the public listing API, which
 * 404s a draft property, strips draft units and offerings out of a live one,
 * and counts every open as a student click in their own metrics. This route
 * answers the same question without those three problems.
 *
 * A DRAFT property renders as if it had been published this second: every
 * draft unit and offering in it included. That is the whole point of looking,
 * "what will students see when I press Publish?". A LIVE property renders
 * exactly as the public API does, drafts hidden, because that is what students
 * see today; the response says how many unpublished changes are being held
 * back so the strip can tell the landlord.
 *
 * Who may look: anyone with a stake here (property or lease ownership, the
 * same rule that puts it on their dashboard) and admins, who may also pass
 * ?viewAs=<landlordId> to see it as that landlord. An unowned id is a 404, not
 * a 403, so this route never confirms a listing exists to someone it isn't
 * for. No metric is recorded.
 *
 * @auth user
 */
export async function GET(req, { params }) {
  try {
    const { listingId } = await params;
    const user = await getRequestUser(req).catch(() => null);
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const targetUserId = resolveDashboardUserId({ user }, searchParams);
    const owned = await getOwnedListings(targetUserId);
    const ownership = owned.get(listingId) ?? null;
    if (!ownership && !canViewAs(user.role)) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // What is a draft here, read straight off the rows so the strip's counts
    // match the dashboard's, which reads the same columns.
    const { data: row, error } = await supabase
      .from("listings")
      .select(
        "id, published_at, listing_units(id, published_at, deleted_at, unit_leases(id, published_at, deleted_at))"
      )
      .eq("id", listingId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      console.error("[landlord preview] draft lookup failed:", error.message);
      return NextResponse.json({ error: "Couldn't load that listing" }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    const isDraft = row.published_at === null;
    const units = (row.listing_units ?? []).filter((u) => !u.deleted_at);
    const draftUnits = units.filter((u) => u.published_at === null).length;
    const draftLeases = units.flatMap((u) =>
      (u.unit_leases ?? []).filter((l) => !l.deleted_at && l.published_at === null)
    ).length;

    const listing = await getListingPreview(listingId, {
      currentUserId: user.id,
      includeDrafts: isDraft,
    });
    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...listing,
      preview: {
        isDraft,
        // On a draft property nothing is held back: it all renders as published.
        hiddenDraftUnits: isDraft ? 0 : draftUnits,
        hiddenDraftLeases: isDraft ? 0 : draftLeases,
        // Publishing is the owner's act. An admin looking on, or a landlord
        // holding only a lease here, sees the preview but not the button.
        canPublish: isDraft && ownership === "property" && targetUserId === user.id,
      },
    });
  } catch (err) {
    console.error("[landlord preview] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
