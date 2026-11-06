export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { startSigning } from "@/lib/billing/agreements";
import { agreementServices } from "@/lib/billing/agreementServices";
import { documensoHost } from "@/lib/billing/documenso";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";
import { cleanDisclosure, saveDisclosure } from "@/lib/users/licenseDisclosure";

/*
 * Start signing inside the app: the master agreement with Exhibit A, or an
 * updated Exhibit A, whichever covers the properties asked for.
 * Body: { signerName, signerTitle, signerCompany?, signerEmail?, signerAddress1?, signerAddress2?,
 *         authorized: true, listingIds?: [uuid], exhibit?, licenseDisclosure, prepare? }.
 *       exhibit: the Exhibit A step's choice per property ({ listingId, include,
 *       wholeBuilding, units }); left out, every property gets its default.
 *       The optional details fill the template's Company, Owner, Email and Address boxes.
 *       signerName is the full name (first and last) that goes on the document.
 *   prepare     true: only get the copy ready, while the landlord answers the
 *               license questions (no licenseDisclosure needed). Answers
 *               { prepared: true, kind } or { alreadySigned: true }.
 *   licenseDisclosure  required: the real estate license answer given in the
 *               step right before signing (lib/users/licenseDisclosure.js). It is
 *               saved to the account and recorded in the history as given at
 *               signing (never printed on the agreement), before
 *               the document opens. Without a complete answer nothing opens.
 *   listingIds  the properties being published (from the publish dialog); left
 *               out when the landlord signs from the Payments tab
 * Answers { token, host, kind } for Documenso's embedded signing page, or
 * { alreadySigned: true } when everything asked for is covered. A copy already
 * in progress for the same document is reused.
 *
 * @auth landlord (own agreement only)
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only well-formed ids, at most 200. Which of them are really the landlord's is
// decided by the coverage plan, which ignores anything they have no stake in.
const ownListingIds = (ids) => (Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && UUID.test(id)).slice(0, 200) : []);

export async function POST(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const prepare = body.prepare === true;
    // Checked before anything else, so an incomplete answer never opens a document.
    const disclosure = prepare ? null : cleanDisclosure(body.licenseDisclosure);
    const { documenso, signingAvailable, options } = agreementServices();
    if (!signingAvailable) {
      throw new BillingError("not_available", "Signing in the app is not set up yet. Email info@useproximity.org and we will send you the agreement.", 503);
    }
    const { data: user, error } = await supabase.from("users").select("id, name, email").eq("id", session.user.id).single();
    if (error) throw error;
    if (disclosure) await saveDisclosure(supabase, user.id, disclosure, { source: "signing" });
    const result = await startSigning(supabase, documenso, {
      user,
      signerTitle: body.signerTitle,
      ...(body.signerName !== undefined && { signerName: body.signerName }),
      signerCompany: typeof body.signerCompany === "string" ? body.signerCompany : "",
      signerEmail: typeof body.signerEmail === "string" ? body.signerEmail : "",
      signerAddress1: typeof body.signerAddress1 === "string" ? body.signerAddress1 : "",
      signerAddress2: typeof body.signerAddress2 === "string" ? body.signerAddress2 : "",
      authorized: body.authorized === true,
      listingIds: ownListingIds(body.listingIds),
      // The Exhibit A step's choices: [{ listingId, include, wholeBuilding, units }].
      exhibit: Array.isArray(body.exhibit) ? body.exhibit : null,
      prepare,
      ...options,
    });
    return NextResponse.json(result.token ? { token: result.token, kind: result.kind, host: documensoHost() } : result);
  } catch (err) {
    if (err?.name === "DocumensoError") {
      console.error("billing: start signing failed", err.message);
      return NextResponse.json({ error: "We could not open the agreement right now. Please try again in a few minutes." }, { status: 502 });
    }
    return billingErrorResponse(err, "start signing");
  }
}
