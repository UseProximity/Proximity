import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

async function resolveExecutedLease(id, userId, role) {
  const { data, error } = await supabase
    .from("executed_leases")
    .select(`
      *,
      executed_lease_tenants(id, email, full_name, role, signed_at, signing_url),
      lease_redlines(id, section_label, status, ai_confidence)
    `)
    .eq("id", id)
    .single();
  if (error || !data) return { err: "Not found", status: 404 };
  if (role !== "super") {
    const { data: own } = await supabase
      .from("listing_landlords")
      .select("listing_id")
      .eq("listing_id", data.listing_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!own) return { err: "Forbidden", status: 403 };
  }
  return { lease: data };
}

// GET /api/landlord/executed-leases/[id]
export async function GET(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { lease, err, status } = await resolveExecutedLease(id, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });
  return NextResponse.json(lease);
}

// PATCH /api/landlord/executed-leases/[id]
// Used to update status (e.g. draft → landlord_reviewing) and tenant list.
// Body: { status?, tenants?: [{ email, full_name, role }] }
export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { lease, err, status } = await resolveExecutedLease(id, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  const body = await req.json();

  const VALID_TRANSITIONS = {
    draft: ["landlord_reviewing"],
    landlord_reviewing: ["landlord_approved", "draft"],
    landlord_approved: ["landlord_reviewing"],
  };

  const updates = {};
  if (body.status) {
    const allowed = VALID_TRANSITIONS[lease.status] ?? [];
    if (!allowed.includes(body.status))
      return NextResponse.json({ error: `Cannot transition from ${lease.status} to ${body.status}` }, { status: 422 });
    updates.status = body.status;
    if (body.status === "landlord_approved") updates.landlord_approved_at = new Date().toISOString();
  }

  if (Object.keys(updates).length) {
    const { error: updateErr } = await supabase
      .from("executed_leases")
      .update(updates)
      .eq("id", id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Replace tenant list if provided
  if (Array.isArray(body.tenants)) {
    await supabase.from("executed_lease_tenants").delete().eq("executed_lease_id", id);
    if (body.tenants.length > 0) {
      const rows = body.tenants.map((t) => ({
        executed_lease_id: id,
        email: t.email,
        full_name: t.full_name,
        role: t.role ?? "tenant",
        user_id: t.user_id ?? null,
      }));
      const { error: tenantErr } = await supabase.from("executed_lease_tenants").insert(rows);
      if (tenantErr) return NextResponse.json({ error: tenantErr.message }, { status: 500 });
    }
  }

  const { data: updated } = await supabase
    .from("executed_leases")
    .select("*, executed_lease_tenants(*)")
    .eq("id", id)
    .single();

  return NextResponse.json(updated);
}
