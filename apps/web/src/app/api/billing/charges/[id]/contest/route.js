export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { getBaseUrl } from "@/lib/email";
import { getChargeViewForLandlord, landlordContest } from "@/lib/billing/charges";
import { sendContestSubmittedTeamEmail } from "@/lib/billing/billingEmails";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * The landlord contests a charge that is Unconfirmed or Pending, for its full
 * amount. It moves to Contested and the team is emailed the charge details and
 * the landlord's reason. An admin resolves it in the admin review view. Approved
 * and Paid charges cannot be contested here.
 * Body: { reason }
 *
 * @auth landlord (own charges only)
 */
export async function POST(req, { params }) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Charge not found.", 404);
    const { reason } = await req.json().catch(() => ({}));

    const { reason: saved } = await landlordContest(supabase, { userId: session.user.id, chargeId: id, reason });

    // The contest is already recorded; an email problem must not undo or fail it.
    try {
      const view = await getChargeViewForLandlord(supabase, session.user.id, id);
      await sendContestSubmittedTeamEmail({
        landlordName: session.user.name,
        landlordEmail: session.user.email,
        charge: {
          amountCents: view.amountCents,
          triggerType: view.triggerType,
          listingLabel: view.listingLabel,
          leaseLabel: view.leaseLabel,
          studentName: view.studentName,
        },
        reason: saved,
        adminUrl: `${getBaseUrl()}/dashboard/admin/billing?tab=contest`,
      });
    } catch (emailErr) {
      console.error("billing: contest email failed", emailErr);
    }
    return NextResponse.json({ ok: true, status: "contested" });
  } catch (err) {
    return billingErrorResponse(err, "contest charge");
  }
}
