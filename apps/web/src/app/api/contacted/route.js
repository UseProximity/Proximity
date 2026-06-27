import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { upsertAsUser } from "@/lib/supabaseWithUser";

// POST /api/contacted — add a listing to the user's contacted list (idempotent)
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { listingId } = await req.json();
    if (!listingId) {
      return Response.json({ error: "listingId required" }, { status: 400 });
    }

    const userId = session.user.id;

    // Look up the contacted interaction type ID
    const { data: typeRow } = await supabase
      .from("interaction_types")
      .select("id")
      .eq("name", "contacted")
      .single();
    const contactedTypeId = typeRow?.id;

    if (!contactedTypeId) {
      return Response.json({ error: "Interaction type not found" }, { status: 500 });
    }

    // Upsert — idempotent, ignore conflict on duplicate
    const { error } = await upsertAsUser(supabase, {
      userId,
      table: "user_listing_interactions",
      data: { user_id: userId, listing_id: listingId, interaction_type_id: contactedTypeId },
      conflictCols: ["user_id", "listing_id", "interaction_type_id"],
      ignoreConflicts: true,
    });

    if (error) {
      console.error("Error saving contacted listing:", error);
      return Response.json({ error: "Failed to save" }, { status: 500 });
    }

    // Track contacts metric (fire-and-forget)
    supabase
      .rpc("increment_listing_metric", {
        p_listing_id: listingId,
        p_metric_name: "contacts",
      })
      .then(({ error: rpcErr }) => {
        if (rpcErr) console.error("[metrics] contact increment failed:", rpcErr.message);
      });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error saving contacted listing:", error);
    return Response.json({ error: "Failed to save" }, { status: 500 });
  }
}
