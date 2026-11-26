import supabase from "@/lib/supabase";

/*
 * The shared "Proximity" landlord account.
 *
 * A student reviewing an address nobody has listed yet gets a stub property
 * created for them (/api/reviewReferral), and that stub needs a landlord row so
 * the review has something to hang off. It gets this account — which is why
 * those properties read "Listed by Proximity" on the detail panel: getListing
 * resolves the display owner from listing_landlords.
 *
 * It is a PLACEHOLDER, not an owner. Nobody signs in as it, and the moment a
 * real landlord turns up at that address it should step aside — see
 * claimUnclaimedProperty in ./ownership.js.
 */
export const PROXIMITY_PLACEHOLDER_EMAIL = "info@useproximity.org";

/**
 * Look up (or lazily create) the placeholder landlord account.
 *
 * Created on demand rather than seeded because a fresh database — a new dev
 * snapshot, a preview branch — would otherwise 500 the first review at an
 * unknown address.
 *
 * Returns null only if both the lookup and the insert fail; callers treat that
 * as "no placeholder", never as "everyone".
 */
export async function resolveProximityLandlordId() {
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", PROXIMITY_PLACEHOLDER_EMAIL)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: role } = await supabase
    .from("roles")
    .select("id")
    .eq("name", "landlord")
    .maybeSingle();

  const { data: created } = await supabase
    .from("users")
    .insert({
      email: PROXIMITY_PLACEHOLDER_EMAIL,
      name: "Proximity",
      role_id: role?.id ?? null,
      profile_complete: true,
    })
    .select("id")
    .maybeSingle();

  return created?.id ?? null;
}
