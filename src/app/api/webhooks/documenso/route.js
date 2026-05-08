import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";

async function verifyHMAC(rawBody, signature) {
  const secret = process.env.DOCUMENSO_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sigBytes = Buffer.from(signature, "hex");
  const bodyBytes = new TextEncoder().encode(rawBody);
  return crypto.subtle.verify("HMAC", key, sigBytes, bodyBytes);
}

// POST /api/webhooks/documenso
// Handles: document.signed, document.completed, document.cancelled, document.rejected
export async function POST(req) {
  const raw = await req.text();
  const sig = req.headers.get("x-documenso-signature");

  const valid = await verifyHMAC(raw, sig);
  if (!valid) return new Response("Invalid signature", { status: 401 });

  let evt;
  try { evt = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

  const docId = evt.data?.id?.toString() ?? evt.document?.id?.toString();
  if (!docId) return new Response("Missing document id", { status: 400 });

  // Look up the executed lease by documenso_document_id
  const { data: lease } = await supabase
    .from("executed_leases")
    .select("id, status")
    .eq("documenso_document_id", docId)
    .maybeSingle();

  if (!lease) {
    // Unknown document — log and ack to avoid Documenso retries
    console.warn("[documenso webhook] unknown document id:", docId);
    return new Response("ok");
  }

  switch (evt.event) {
    case "document.signed": {
      // A single recipient signed. Identify which tenant and stamp signed_at.
      const recipient = evt.data?.recipients?.find((r) => r.signedAt);
      if (recipient?.email) {
        await supabase
          .from("executed_lease_tenants")
          .update({
            signed_at: recipient.signedAt,
            signature_ip: recipient.signingIp ?? null,
            signature_audit_data: recipient,
          })
          .eq("executed_lease_id", lease.id)
          .eq("email", recipient.email);
      }
      // If the signer is the tenant (not landlord countersigner), flip to tenant_signed
      if (lease.status === "sent_to_tenant") {
        await supabase
          .from("executed_leases")
          .update({ status: "tenant_signed", tenant_signed_at: new Date().toISOString() })
          .eq("id", lease.id);
      }
      break;
    }

    case "document.completed": {
      // Both parties signed. Fetch signed PDF and store URL, then flip to fully_executed.
      // TODO (§11): download signed PDF from Documenso and re-upload to R2
      // const signedPdfUrl = await downloadAndStoreSignedPdf(docId, lease.id);
      await supabase
        .from("executed_leases")
        .update({
          status: "fully_executed",
          fully_executed_at: new Date().toISOString(),
          // signed_lease_pdf_url: signedPdfUrl,  // uncomment once §11 is wired
        })
        .eq("id", lease.id);
      break;
    }

    case "document.cancelled":
      await supabase
        .from("executed_leases")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: "documenso_cancelled" })
        .eq("id", lease.id);
      break;

    case "document.rejected":
      await supabase
        .from("executed_leases")
        .update({ status: "rejected" })
        .eq("id", lease.id);
      break;

    default:
      // Unhandled event type — ack anyway
      break;
  }

  return new Response("ok");
}
