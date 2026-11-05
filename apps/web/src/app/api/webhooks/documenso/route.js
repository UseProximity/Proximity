export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { documensoSetting, verifyWebhookSecret } from "@/lib/billing/documenso";
import { applyEnvelope } from "@/lib/billing/agreements";
import { agreementServices } from "@/lib/billing/agreementServices";

/*
 * Documenso webhook: a landlord finished, declined or a copy was cancelled.
 *
 * Production and the test environments share one Documenso team, and each has
 * its own webhook, so every environment hears about every document. A document
 * this environment's database does not know is ignored before Documenso is asked
 * anything.
 *
 * Documenso sends the webhook secret in X-Documenso-Secret; anything without the
 * right one is refused before the body is read. The body is used only for the
 * envelope id: the envelope is then fetched from Documenso's API, so a forged or
 * replayed body cannot mark anything signed. Applying it is idempotent. A failure
 * answers 500 so Documenso tries again; an envelope that is not one of ours, or an
 * event we do not use, answers 200.
 *
 * In Documenso: Team settings > Webhooks, one per environment, URL
 * https://<site>/api/webhooks/documenso, events DOCUMENT_COMPLETED,
 * DOCUMENT_REJECTED and DOCUMENT_CANCELLED, and a secret equal to that
 * environment's DOCUMENSO_WEBHOOK_SECRET.
 *
 * @auth Documenso webhook secret (DOCUMENSO_WEBHOOK_SECRET, DOCUMENSO_WEBHOOK_SECRET_DEV off production)
 */
const HANDLED = new Set(["DOCUMENT_COMPLETED", "DOCUMENT_REJECTED", "DOCUMENT_CANCELLED", "DOCUMENT_SIGNED", "DOCUMENT_RECIPIENT_COMPLETED"]);

export async function POST(req) {
  if (!documensoSetting("DOCUMENSO_WEBHOOK_SECRET")) {
    console.error("documenso webhook: DOCUMENSO_WEBHOOK_SECRET (or _DEV off production) is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  if (!verifyWebhookSecret(req.headers.get("x-documenso-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const event = body?.event;
  const envelopeId = body?.payload?.envelopeId ?? null;
  if (!HANDLED.has(event) || typeof envelopeId !== "string" || !envelopeId) {
    return NextResponse.json({ ok: true, ignored: event ?? "unknown" });
  }

  try {
    // Not one of ours (another environment's document, or a template): nothing to do.
    const { data: known, error } = await supabase
      .from("landlord_agreements")
      .select("id")
      .eq("provider_envelope_id", envelopeId)
      .maybeSingle();
    if (error) throw error;
    if (!known) return NextResponse.json({ ok: true, ignored: "not this environment's document" });

    const { documenso, options } = agreementServices();
    const envelope = await documenso.getEnvelope(envelopeId);
    const result = await applyEnvelope(supabase, documenso, envelope, options);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("documenso webhook failed", err?.message ?? err);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }
}
