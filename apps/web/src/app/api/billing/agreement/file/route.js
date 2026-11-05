export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { documentFileKey } from "@/lib/billing/agreements";
import { signedAgreementUrl } from "@/lib/billing/agreementFiles";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * A five minute download link for one of the landlord's own signed documents.
 * Query: kind=master|amendment, id (optional; the current master without it),
 * part=agreement|exhibit. Only their own files are ever returned.
 *
 * @auth landlord (own agreement only)
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const params = new URL(req.url).searchParams;
    const kind = params.get("kind") === "amendment" ? "amendment" : "master";
    const part = params.get("part") === "exhibit" ? "exhibit" : "agreement";
    const id = params.get("id");
    if (id && !UUID.test(id)) throw new BillingError("not_found", "That document was not found.", 404);
    const key = await documentFileKey(supabase, { userId: session.user.id, kind, id, part });
    if (!key) throw new BillingError("not_found", "There is no signed copy on file.", 404);
    const name = `${kind === "amendment" ? "exhibit-a-amendment" : part === "exhibit" ? "exhibit-a" : "commission-agreement"}${part === "exhibit" && kind === "amendment" ? "-pages" : ""}.pdf`;
    return NextResponse.json({ url: await signedAgreementUrl(key, name) });
  } catch (err) {
    return billingErrorResponse(err, "open signed agreement");
  }
}
