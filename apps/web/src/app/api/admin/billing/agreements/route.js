export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { emailMatchPattern, normalizeEmail } from "@/lib/auth/email";
import { markAgreementSent, markAgreementSigned, voidAgreement } from "@/lib/billing/agreements";
import { documensoConfigured } from "@/lib/billing/documenso";
import { documensoClient } from "@/lib/billing/agreementServices";
import { storeSignedAgreement } from "@/lib/billing/agreementFiles";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Recording a landlord's commission agreement by hand, for a paper signature or
 * to clear one. Landlords normally sign in the app (Documenso); the admin
 * overview of every landlord is /api/admin/billing/landlords.
 *
 * POST  { landlordEmail, action } where action is:
 *         "send"  mark it sent (the admin sent it outside the app)
 *         "void"  void the record in progress, or else the current signature
 *                 (a Documenso copy still waiting is cancelled there too)
 *         "sign"  record it signed. Needs signerName; signerTitle is optional,
 *                 signedAt (YYYY-MM-DD) defaults to today. Send multipart/form-data
 *                 with an optional PDF in "file" to keep the signed copy.
 *
 * @auth admin
 */
async function readRequest(req) {
  if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    return {
      landlordEmail: form.get("landlordEmail"),
      action: form.get("action"),
      signerName: form.get("signerName"),
      signerTitle: form.get("signerTitle"),
      signedAt: form.get("signedAt"),
      file: file && typeof file === "object" && file.size > 0 ? file : null,
    };
  }
  const body = await req.json().catch(() => ({}));
  return { ...body, file: null };
}

export async function POST(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { landlordEmail, action, signerName, signerTitle, signedAt, file } = await readRequest(req);
    if (!["send", "sign", "void"].includes(action)) {
      throw new BillingError("bad_action", "Choose send, sign or void.");
    }

    const { data: landlord, error } = await supabase
      .from("users")
      .select("id, roles!role_id(name)")
      .ilike("email", emailMatchPattern(normalizeEmail(landlordEmail)))
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!landlord) throw new BillingError("bad_landlord", "No account with that email.", 404);
    if (landlord.roles?.name !== "landlord") {
      throw new BillingError("bad_landlord", "Agreements are for landlord accounts.");
    }

    let agreement;
    if (action === "send") {
      agreement = await markAgreementSent(supabase, { userId: landlord.id });
    } else if (action === "void") {
      agreement = await voidAgreement(supabase, documensoConfigured() ? documensoClient() : null, { userId: landlord.id });
    } else {
      // Validate the name and date first, so a bad form never leaves an orphaned upload.
      if (!String(signerName ?? "").trim()) throw new BillingError("signer_required", "Who signed the agreement?");
      const signedDate = signedAt ? new Date(`${signedAt}T12:00:00Z`) : new Date();
      if (Number.isNaN(signedDate.getTime())) throw new BillingError("bad_date", "That is not a valid signing date.");
      let signedFileKey = null;
      if (file) {
        signedFileKey = await storeSignedAgreement({
          userId: landlord.id,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      }
      agreement = await markAgreementSigned(supabase, {
        userId: landlord.id,
        signerName,
        signerTitle,
        signedAt: signedDate,
        signedFileKey,
      });
    }
    return NextResponse.json({ ok: true, status: agreement.status });
  } catch (err) {
    return billingErrorResponse(err, "update agreement");
  }
}
