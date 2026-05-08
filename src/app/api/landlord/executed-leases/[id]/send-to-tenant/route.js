import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

// POST /api/landlord/executed-leases/[id]/send-to-tenant
//
// Pre-conditions:
//   1. executed_lease.status === 'landlord_approved'
//   2. All lease_redlines for this lease have status !== 'pending'
//   3. At least one executed_lease_tenant row exists
//
// What this route does (once §8/§11 integrations are built):
//   1. TODO: call src/lib/leaseRedlinedPdf.ts to build the redlined PDF from approved redlines
//   2. TODO: upload PDF to R2 at lease-templates/redlined/{id}.pdf
//   3. TODO: call src/lib/documenso.ts createEnvelope({ pdfUrl, recipients }) → documentId + signingUrls
//   4. Persist documenso_document_id, redlined_pdf_url, per-tenant signing_url
//   5. Flip status → 'sent_to_tenant'
export async function POST(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  // Fetch lease + redlines + tenants
  const { data: lease, error: leaseErr } = await supabase
    .from("executed_leases")
    .select("*, lease_redlines(id, status), executed_lease_tenants(id, email, full_name, role)")
    .eq("id", id)
    .single();

  if (leaseErr || !lease) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Ownership check
  const { data: own } = session.user.role !== "super"
    ? await supabase.from("listing_landlords").select("listing_id")
        .eq("listing_id", lease.listing_id).eq("user_id", session.user.id).maybeSingle()
    : { data: true };
  if (!own) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (lease.status !== "landlord_approved")
    return NextResponse.json({ error: `Lease must be in landlord_approved status (current: ${lease.status})` }, { status: 422 });

  const pendingRedlines = (lease.lease_redlines ?? []).filter((r) => r.status === "pending");
  if (pendingRedlines.length > 0)
    return NextResponse.json({ error: `${pendingRedlines.length} redline(s) still pending landlord review` }, { status: 422 });

  if (!lease.executed_lease_tenants?.length)
    return NextResponse.json({ error: "Add at least one tenant before sending" }, { status: 422 });

  // TODO (§11): build redlined PDF + upload to R2
  // const { pdfUrl } = await buildRedlinedPdf(id);

  // TODO (§11): create Documenso envelope
  // const { documentId, recipients } = await createEnvelope({ pdfUrl, recipients: lease.executed_lease_tenants });
  // for (const r of recipients) {
  //   await supabase.from("executed_lease_tenants").update({ documenso_recipient_id: r.id, signing_url: r.signingUrl }).eq("id", r.proximityId);
  // }
  // await supabase.from("executed_leases").update({ documenso_document_id: documentId, redlined_pdf_url: pdfUrl }).eq("id", id);

  // Flip status regardless (PDF/Documenso stubbed until §11)
  const { data: updated, error: updateErr } = await supabase
    .from("executed_leases")
    .update({ status: "sent_to_tenant", sent_to_tenant_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  return NextResponse.json(updated);
}
