import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

async function resolveConcession(concessionId, listingId, userId, role) {
  const { data, error } = await supabase
    .from("listing_concessions")
    .select("id, listing_id")
    .eq("id", concessionId)
    .eq("listing_id", listingId)
    .single();
  if (error || !data) return { err: "Not found", status: 404 };
  if (role !== "super") {
    const { data: own } = await supabase
      .from("listing_landlords")
      .select("listing_id")
      .eq("listing_id", listingId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!own) return { err: "Forbidden", status: 403 };
  }
  return { concession: data };
}

// PATCH /api/landlord/listings/[listingId]/concessions/[concessionId]
export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId, concessionId } = await params;
  const { err, status } = await resolveConcession(concessionId, listingId, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  const body = await req.json();
  const ALLOWED = new Set(["description", "amount", "amount_type", "conditions", "valid_from", "valid_until", "active", "listing_lease_id"]);
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => ALLOWED.has(k)));
  if (!Object.keys(updates).length)
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  const { data, error } = await supabase
    .from("listing_concessions")
    .update(updates)
    .eq("id", concessionId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/landlord/listings/[listingId]/concessions/[concessionId]
export async function DELETE(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId, concessionId } = await params;
  const { err, status } = await resolveConcession(concessionId, listingId, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  const { error } = await supabase.from("listing_concessions").delete().eq("id", concessionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
