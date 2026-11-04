export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { documentFileKey } from "@/lib/billing/agreements";
import { signedAgreementUrl } from "@/lib/billing/agreementFiles";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * A five minute link to one of a landlord's signed files, for the admin.
 * Query: kind=master|amendment, id (the document), part=agreement|exhibit.
 * The document must belong to the landlord in the path.
 *
 * @auth admin
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: landlordId } = await params;
    const q = new URL(req.url).searchParams;
    const docId = q.get("id");
    if (!UUID.test(landlordId) || (docId && !UUID.test(docId))) throw new BillingError("not_found", "That document was not found.", 404);
    const kind = q.get("kind") === "amendment" ? "amendment" : "master";
    const part = q.get("part") === "exhibit" ? "exhibit" : "agreement";
    const key = await documentFileKey(supabase, { userId: landlordId, kind, id: docId, part });
    if (!key) throw new BillingError("not_found", "There is no signed copy on file.", 404);
    return NextResponse.json({ url: await signedAgreementUrl(key, `${kind}-${part}.pdf`) });
  } catch (err) {
    return billingErrorResponse(err, "open a landlord's signed document");
  }
}
