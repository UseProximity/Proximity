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
 * The landlord, or the authorized payer the charge is billed to (Wyatt,
 * 2026-11-25), contests a charge that is Unconfirmed or Pending, for its full
 * amount. It moves to Contested and the team is emailed the charge details and
 * the landlord's reason. An admin resolves it in the admin review view. Approved
 * and Paid charges cannot be contested here.
 * Body: { reason }
 *
 * @auth landlord (own charges, or ones billed to them as authorized payer)
 */
export async function POST(req, { params }) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Charge not found.", 404);
    const { reason } = await req.json().catch(() => ({}));

    const { reason: saved, byPayer, landlordId } = await landlordContest(supabase, { userId: session.user.id, chargeId: id, reason });

    // The contest is already recorded; an email problem must not undo or fail it.
    try {
      const view = await getChargeViewForLandlord(supabase, session.user.id, id);
      // Contested by the authorized payer: the team is told whose account it is on.
      let account = { name: session.user.name, email: session.user.email };
      if (byPayer) {
        const { data } = await supabase.from("users").select("name, company_name, email").eq("id", landlordId).maybeSingle();
        account = { name: data?.company_name?.trim() || data?.name || null, email: data?.email ?? "" };
      }
      await sendContestSubmittedTeamEmail({
        landlordName: account.name,
        landlordEmail: account.email,
        ...(byPayer && { payer: { name: session.user.name, email: session.user.email } }),
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
