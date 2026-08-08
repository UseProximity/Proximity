export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { appEnv } from "@/lib/appEnv";
import { pmsPreviewOnly } from "@/lib/pms/alerts.js";

async function requireLandlordOrSuper() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!["landlord", "super"].includes(session.user.role)) return null;
  return session;
}

// GET /api/landlord/pms/links — the landlord's PMS connections + what they sync.
export async function GET() {
  const session = await requireLandlordOrSuper();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: connections, error } = await supabase
    .from("pms_connections")
    .select("id, provider, status, credential_meta, last_sync_at, last_sync_status, last_sync_error, created_at")
    .eq("user_id", session.user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (connections ?? []).map((c) => c.id);
  let links = [];
  if (ids.length) {
    const { data } = await supabase
      .from("pms_links")
      .select("id, connection_id, external_property_id, external_unit_id, external_label, listing_id, include, origin, link_status")
      .in("connection_id", ids);
    links = data ?? [];
  }

  const listingIds = [...new Set(links.map((l) => l.listing_id).filter(Boolean))];
  let listingsById = {};
  if (listingIds.length) {
    const { data } = await supabase
      .from("listings")
      .select("id, title, address, unavailable, last_verified_at")
      .in("id", listingIds);
    listingsById = Object.fromEntries((data ?? []).map((l) => [l.id, l]));
  }

  return NextResponse.json({
    // Demo mode (sample-data connect flow) is available everywhere except prod.
    allowDemo: appEnv() !== "production",
    // Preview-only pilot: the connect + preview flow runs, but confirm is
    // refused server-side, so the UI must not offer it.
    previewOnly: pmsPreviewOnly(),
    connections: (connections ?? []).map((c) => ({
      ...c,
      links: links
        .filter((l) => l.connection_id === c.id)
        .map((l) => ({ ...l, listing: l.listing_id ? listingsById[l.listing_id] ?? null : null })),
    })),
  });
}
