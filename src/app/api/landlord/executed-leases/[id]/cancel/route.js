import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

const CANCELLABLE_STATUSES = ["draft", "landlord_reviewing", "landlord_approved", "sent_to_tenant", "tenant_signed"];

// POST /api/landlord/executed-leases/[id]/cancel
// Body: { reason? }
// Cancels a Documenso envelope (if one exists) and flips status to 'cancelled'.
export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { data: lease, error: leaseErr } = await supabase
    .from("executed_leases")
    .select("id, listing_id, status, documenso_document_id")
    .eq("id", id)
    .single();

  if (leaseErr || !lease) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: own } = session.user.role !== "super"
    ? await supabase.from("listing_landlords").select("listing_id")
        .eq("listing_id", lease.listing_id).eq("user_id", session.user.id).maybeSingle()
    : { data: true };
  if (!own) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!CANCELLABLE_STATUSES.includes(lease.status))
    return NextResponse.json({ error: `Cannot cancel a lease in ${lease.status} status` }, { status: 422 });

  // TODO (§11): if documenso_document_id exists, call documenso.cancelDocument(lease.documenso_document_id)

  const { reason } = await req.json().catch(() => ({}));
  const { data: updated, error: updateErr } = await supabase
    .from("executed_leases")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason ?? null,
    })
    .eq("id", id)
    .select()
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  return NextResponse.json(updated);
}
