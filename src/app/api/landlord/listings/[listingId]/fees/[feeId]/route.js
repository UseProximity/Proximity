import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

async function resolveFee(feeId, listingId, userId, role) {
  const { data: fee, error } = await supabase
    .from("listing_fees")
    .select("id, listing_id")
    .eq("id", feeId)
    .eq("listing_id", listingId)
    .single();
  if (error || !fee) return { err: "Not found", status: 404 };
  if (role !== "super") {
    const { data: own } = await supabase
      .from("listing_landlords")
      .select("listing_id")
      .eq("listing_id", listingId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!own) return { err: "Forbidden", status: 403 };
  }
  return { fee };
}

// PATCH /api/landlord/listings/[listingId]/fees/[feeId]
export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId, feeId } = await params;
  const { err, status } = await resolveFee(feeId, listingId, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  const body = await req.json();
  const ALLOWED = new Set(["fee_type_id", "amount", "basis", "listing_lease_id", "conditions", "refundable", "notes"]);
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => ALLOWED.has(k)));
  if (!Object.keys(updates).length)
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  const { data, error } = await supabase
    .from("listing_fees")
    .update(updates)
    .eq("id", feeId)
    .select("*, fee_types(name, category, display_label)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/landlord/listings/[listingId]/fees/[feeId]
export async function DELETE(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId, feeId } = await params;
  const { err, status } = await resolveFee(feeId, listingId, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  const { error } = await supabase.from("listing_fees").delete().eq("id", feeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
