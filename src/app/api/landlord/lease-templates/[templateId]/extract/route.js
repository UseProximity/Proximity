import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { extractLeaseTemplate } from "@/lib/extraction/leaseTemplate";

// POST /api/landlord/lease-templates/[templateId]/extract
// Triggers (or re-triggers) the AI extraction pass on a lease template PDF.
// Responds immediately with runId; extraction runs synchronously but can be
// offloaded to a background queue in future if latency becomes a concern.
export async function POST(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { templateId } = await params;

  const { data: template, error: tErr } = await supabase
    .from("lease_templates")
    .select("id, landlord_id, listing_id, template_pdf_url")
    .eq("id", templateId)
    .eq("landlord_id", session.user.id)
    .single();

  if (tErr || !template) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json({ error: "AI extraction not configured" }, { status: 503 });

  try {
    const result = await extractLeaseTemplate({
      templateId: template.id,
      listingId: template.listing_id,
      pdfUrl: template.template_pdf_url,
      landlordId: session.user.id,
    });

    return NextResponse.json({
      runId: result.runId,
      fieldsExtracted: result.fieldsExtracted,
      avgConfidence: result.avgConfidence,
    });
  } catch (err) {
    console.error("[extract] lease template extraction failed:", err.message);
    return NextResponse.json({
      error: "Couldn't read this lease — please fill in fields manually.",
      runId: err.runId ?? null,
    }, { status: 500 });
  }
}
