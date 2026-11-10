export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { listAgreementDocuments, voidDocument } from "@/lib/billing/agreements";
import { documensoConfigured } from "@/lib/billing/documenso";
import { documensoClient } from "@/lib/billing/agreementServices";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * One landlord's agreement history for the admin dashboard: every master
 * agreement and Exhibit A amendment, signed or not, with the properties each
 * listed (and, for an amendment, the list before it) and how it ended.
 *
 * POST  { action: "void", kind: "master" | "amendment", id } voids one document,
 *       signed or still being signed (voidDocument): a copy still in Documenso is
 *       cancelled there, and the properties it covered or proposed are released.
 *
 * @auth admin
 */

export async function GET(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "That landlord was not found.", 404);
    return NextResponse.json({ documents: await listAgreementDocuments(supabase, id, { admin: true }) });
  } catch (err) {
    return billingErrorResponse(err, "list a landlord's agreement documents");
  }
}

export async function POST(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "That landlord was not found.", 404);
    const body = await req.json().catch(() => ({}));
    if (body.action !== "void") throw new BillingError("bad_action", "Choose void.");
    if (!["master", "amendment"].includes(body.kind) || !isUuid(String(body.id ?? ""))) {
      throw new BillingError("not_found", "That document was not found.", 404);
    }
    const result = await voidDocument(supabase, documensoConfigured() ? documensoClient() : null, {
      userId: id,
      kind: body.kind,
      id: body.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return billingErrorResponse(err, "void a landlord's agreement document");
  }
}
