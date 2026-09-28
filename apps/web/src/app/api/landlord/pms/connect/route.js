export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getConnector, isApiProvider } from "@/lib/pms/index.js";
import { deleteNangoConnection } from "@/lib/pms/nango.js";

async function requireLandlordOrSuper() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!["landlord", "super"].includes(session.user.role)) return null;
  return session;
}

/*
 * DELETE /api/landlord/pms/connect?connectionId=… — disconnect a PMS.
 * Soft-deletes our row, deletes the Nango connection (destroying the stored
 * credential at the source), and detaches synced listings: they KEEP their
 * current availability but drop the verified badge and stop auto-updating.
 */
export async function DELETE(req) {
  const session = await requireLandlordOrSuper();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get("connectionId");
  if (!connectionId) return NextResponse.json({ error: "connectionId is required" }, { status: 400 });

  const { data: connection } = await supabase
    .from("pms_connections")
    .select("id, user_id, provider, nango_connection_id")
    .eq("id", connectionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!connection || connection.user_id !== session.user.id) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  if (connection.nango_connection_id && isApiProvider(connection.provider)) {
    await deleteNangoConnection({
      connectionId: connection.nango_connection_id,
      providerConfigKey: getConnector(connection.provider).providerConfigKey,
    });
  }

  // Detach listings: keep them live, drop the badge + stop syncing.
  const { data: syncedListings } = await supabase
    .from("listings")
    .select("id")
    .eq("pms_connection_id", connection.id);
  for (const l of syncedListings ?? []) {
    await supabase.rpc("rpc_pms_apply", {
      p_user_id: session.user.id,
      p_listing_id: l.id,
      p_listing_updates: { pms_connection_id: null },
    });
  }

  await supabase
    .from("pms_connections")
    .update({ status: "disconnected", deleted_at: new Date().toISOString() })
    .eq("id", connection.id);

  return NextResponse.json({ ok: true, detachedListings: (syncedListings ?? []).length });
}
