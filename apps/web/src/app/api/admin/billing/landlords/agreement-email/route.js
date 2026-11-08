export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { getBaseUrl } from "@/lib/email";
import { bulkAudience, loadLandlordOverview, sendAgreementRequests, singleTarget } from "@/lib/billing/landlordOverview";
import { getLiveVersion } from "@/lib/billing/agreementVersions";
import { readAgreementFile } from "@/lib/billing/agreementFiles";
import { formatDeadline, getEnrollmentWindow } from "@/lib/billing/enrollment";
import { sendAgreementRequestEmail } from "@/lib/billing/billingEmails";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * Email landlords a link to sign the commission agreement in the app, with the
 * agreement PDF attached.
 * Body: { landlordId } for one landlord, or { all: true, confirm: true } for
 * everyone with a live listing who has not signed and was not asked in the last
 * three days (300 per call; call again to continue).
 *
 * Every email goes through the outreach gate, so off production it is redirected
 * to the test inbox or not sent.
 *
 * @auth admin
 */
export async function POST(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;

  try {
    const body = await req.json().catch(() => ({}));
    const live = await getLiveVersion(supabase);
    if (!live?.provider_recipient_id) {
      throw new BillingError("no_live_version", "Make an agreement version live before asking landlords to sign.", 409);
    }

    const { allRows: rows } = await loadLandlordOverview(supabase);
    let targets;
    if (body.all === true) {
      if (body.confirm !== true) throw new BillingError("confirm_required", "Confirm that you want to email these landlords.");
      targets = bulkAudience(rows);
    } else {
      if (!isUuid(body.landlordId)) throw new BillingError("bad_landlord", "Choose a landlord.");
      targets = [singleTarget(rows, body.landlordId)];
    }

    const pdf = await readAgreementFile(live.file_key).catch((err) => {
      console.error("billing: could not read the agreement PDF for the email", err?.message);
      return null;
    });
    const window = await getEnrollmentWindow(supabase);
    const input = {
      versionLabel: live.label,
      signUrl: `${getBaseUrl()}/dashboard/landlord?tab=billing#marketing-agreement`,
      deadline: window.deadline && !window.enforcedAt ? formatDeadline(window.deadline) : null,
    };
    const result = await sendAgreementRequests({
      targets,
      send: (landlord, resign) => sendAgreementRequestEmail(landlord, { ...input, resign }, pdf),
    });
    return NextResponse.json({ ok: true, ...result, attachedPdf: !!pdf });
  } catch (err) {
    return billingErrorResponse(err, "email agreement");
  }
}
