/*
 * Public landing page for a landlord's shareable review-invite link:
 *   /review-invite/<landlordId>
 *
 * Validates the landlord id server-side and pre-loads their listings so the
 * tenant can pick which property they're reviewing from a dropdown (no address
 * search required). Reviews submit through the existing /api/submitReview
 * endpoint and auto-publish (legitimacy=true). Not indexed.
 */

import { Suspense } from "react";
import { notFound } from "next/navigation";
import supabase from "@/lib/supabase";
import ReviewInviteClient from "./ReviewInviteClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Review your apartment | Proximity",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LANDLORD_ROLES = new Set(["landlord", "super", "admin"]);

export default async function ReviewInvitePage({ params }) {
  const { landlordId } = await params;

  // Invalid id, missing user, or non-landlord all resolve to the friendly 404
  // view in not-found.js — keeps HTTP semantics honest while showing custom UI.
  if (!UUID_RE.test(landlordId || "")) notFound();

  const { data: landlord } = await supabase
    .from("users")
    .select("id, name, roles!role_id(name)")
    .eq("id", landlordId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!landlord) notFound();
  if (!LANDLORD_ROLES.has(landlord.roles?.name)) notFound();

  /*
   * Everywhere this landlord has something a student could review — which is
   * not the same as the properties they own.
   *
   * A landlord who attached an offering to someone else's building owns the
   * lease, not the listing record, so listing_landlords alone reported they had
   * no listings at all and the invite dead-ended. Their tenants have just as
   * much to review.
   */
  const [{ data: ownedRows }, { data: leasedRows }] = await Promise.all([
    supabase.from("listing_landlords").select("listing_id").eq("user_id", landlord.id),
    supabase
      .from("unit_leases")
      .select("id, listing_units!unit_id(listing_id, deleted_at)")
      .eq("owner_id", landlord.id),
  ]);

  const ownedIds = [
    ...new Set([
      ...(ownedRows ?? []).map((r) => r.listing_id),
      ...(leasedRows ?? [])
        .map((r) => r.listing_units)
        .filter((u) => u?.listing_id && !u.deleted_at)
        .map((u) => u.listing_id),
    ]),
  ];

  let listings = [];
  if (ownedIds.length > 0) {
    const { data: listingRows } = await supabase
      .from("listings")
      .select("id, title, address, deleted_at, unavailable, created_at")
      .in("id", ownedIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    listings = (listingRows ?? []).map((l) => ({
      id: l.id,
      title: l.title ?? null,
      address: l.address ?? null,
    }));
  }

  return (
    <Suspense fallback={null}>
      <ReviewInviteClient
        landlord={{ id: landlord.id, name: landlord.name || "this landlord" }}
        listings={listings}
      />
    </Suspense>
  );
}
