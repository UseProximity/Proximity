import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

async function resolveRedline(redlineId, leaseId, userId, role) {
  const { data: redline, error } = await supabase
    .from("lease_redlines")
    .select("*, executed_leases!executed_lease_id(listing_id)")
    .eq("id", redlineId)
    .eq("executed_lease_id", leaseId)
    .single();
  if (error || !redline) return { err: "Not found", status: 404 };
  if (role !== "super") {
    const { data: own } = await supabase
      .from("listing_landlords")
      .select("listing_id")
      .eq("listing_id", redline.executed_leases.listing_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!own) return { err: "Forbidden", status: 403 };
  }
  return { redline };
}

// PATCH /api/landlord/executed-leases/[id]/redlines/[redlineId]
// Approve, edit, or reject a redline.
// Body: { action: "approve" | "edit" | "reject", edited_text? (required when action=edit) }
export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, redlineId } = await params;
  const { redline, err, status } = await resolveRedline(redlineId, id, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  if (redline.status !== "pending")
    return NextResponse.json({ error: "Redline already actioned" }, { status: 422 });

  const { action, edited_text } = await req.json();
  if (!["approve", "edit", "reject"].includes(action))
    return NextResponse.json({ error: "action must be approve, edit, or reject" }, { status: 400 });
  if (action === "edit" && !edited_text?.trim())
    return NextResponse.json({ error: "edited_text required when action=edit" }, { status: 400 });

  const updates = {
    status: action === "approve" ? "approved" : action === "edit" ? "edited" : "rejected",
    approved_by: session.user.id,
    approved_at: new Date().toISOString(),
    edited_text: action === "edit" ? edited_text.trim() : null,
    final_text: action === "approve"
      ? redline.suggested_text
      : action === "edit"
      ? edited_text.trim()
      : null,
  };

  const { data, error } = await supabase
    .from("lease_redlines")
    .update(updates)
    .eq("id", redlineId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
