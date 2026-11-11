export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { billingReader } from "@/lib/billing/viewer";
import { documentParts } from "@/lib/billing/agreements";
import { combinedSignedPdf, pdfOrLink } from "@/lib/billing/agreementFiles";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * One of the landlord's own signed documents, as a single PDF: the commission
 * agreement with its Exhibit A, or an Exhibit A amendment with its before and
 * after pages (Wyatt, 2026-11-06). Query: kind=master|amendment, id (optional;
 * the current master without it). Only their own files are ever returned.
 *
 * @auth landlord (own agreement only)
 */

export async function GET(req) {
  const reader = await billingReader(req);
  if (!reader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const params = new URL(req.url).searchParams;
    const kind = params.get("kind") === "amendment" ? "amendment" : "master";
    const id = params.get("id");
    if (id && !isUuid(id)) throw new BillingError("not_found", "That document was not found.", 404);
    const keys = await documentParts(supabase, { userId: reader.userId, kind, id });
    if (!keys.length) throw new BillingError("not_found", "There is no signed copy on file.", 404);
    return pdfOrLink(await combinedSignedPdf(keys), kind === "amendment" ? "exhibit-a-amendment.pdf" : "marketing-agreement.pdf");
  } catch (err) {
    return billingErrorResponse(err, "open signed agreement");
  }
}
