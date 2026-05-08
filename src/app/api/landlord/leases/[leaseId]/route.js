import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

// Verify the lease exists and belongs to a listing owned by the requesting user.
async function resolveLease(leaseId, userId, role) {
  const { data: lease, error } = await supabase
    .from("listing_leases")
    .select("*, listings!listing_id(primary_landlord_id)")
    .eq("id", leaseId)
    .is("deleted_at", null)
    .single();

  if (error || !lease) return { err: "Not found", status: 404 };

  if (role !== "super") {
    const { data: own } = await supabase
      .from("listing_landlords")
      .select("listing_id")
      .eq("listing_id", lease.listing_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!own) return { err: "Forbidden", status: 403 };
  }

  return { lease };
}

// GET /api/landlord/leases/[leaseId]
export async function GET(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leaseId } = await params;
  const { lease, err, status } = await resolveLease(leaseId, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  return NextResponse.json(lease);
}

// PATCH /api/landlord/leases/[leaseId]
// Supports partial updates: any subset of lease fields.
// To disable: { is_active: false, disabled_reason: "manually_disabled" }
export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leaseId } = await params;
  const { err, status } = await resolveLease(leaseId, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  const body = await req.json();

  const ALLOWED = new Set([
    "bedrooms", "bathrooms", "area", "pricing_basis", "rent", "beds_in_lease",
    "lease_term_months", "available_from", "sublease", "total_bedrooms", "total_bathrooms",
    "summer_only", "semester_only", "unit_group_label", "floor_plan_image_url",
    "is_active", "disabled_reason", "price_locked_until",
  ]);

  const updates = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.has(k)) updates[k] = v;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }
  if (updates.pricing_basis && !["per_unit", "per_bed"].includes(updates.pricing_basis)) {
    return NextResponse.json({ error: "pricing_basis must be per_unit or per_bed" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("listing_leases")
    .update(updates)
    .eq("id", leaseId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/landlord/leases/[leaseId]
// Soft-deletes the lease offer (sets deleted_at). Hard delete not exposed.
export async function DELETE(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leaseId } = await params;
  const { err, status } = await resolveLease(leaseId, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  const { error } = await supabase
    .from("listing_leases")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", leaseId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
