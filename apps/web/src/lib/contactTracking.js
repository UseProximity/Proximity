import supabase from "@/lib/supabase";
import { upsertAsUser } from "@/lib/supabaseWithUser";

/*
 * Single source of truth for recording that a student contacted a listing.
 * Used by POST /api/contacted (browse page) and the matchmaking chat's
 * contact_owners action so both flows mark up the same contact numbers:
 * the user's contacted list (user_listing_interactions) and the listing's
 * "contacts" metric (landlord dashboard + matchmaking saturation signal).
 */
export async function recordListingContact({ userId, listingId }) {
  // Look up the contacted interaction type ID
  const { data: typeRow } = await supabase
    .from("interaction_types")
    .select("id")
    .eq("name", "contacted")
    .single();
  const contactedTypeId = typeRow?.id;

  if (!contactedTypeId) {
    return { error: new Error("Interaction type not found") };
  }

  // Upsert — idempotent, ignore conflict on duplicate
  const { error } = await upsertAsUser(supabase, {
    userId,
    table: "user_listing_interactions",
    data: { user_id: userId, listing_id: listingId, interaction_type_id: contactedTypeId },
    conflictCols: ["user_id", "listing_id", "interaction_type_id"],
    ignoreConflicts: true,
  });

  if (error) return { error };

  // Track contacts metric (fire-and-forget)
  supabase
    .rpc("increment_listing_metric", {
      p_listing_id: listingId,
      p_metric_name: "contacts",
    })
    .then(({ error: rpcErr }) => {
      if (rpcErr) console.error("[metrics] contact increment failed:", rpcErr.message);
    });

  return { error: null };
}
