export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { getBaseUrl } from "@/lib/email";
import { adminResolveContest, getAdminChargeView } from "@/lib/billing/adminReview";
import { sendContestOutcomeEmail } from "@/lib/billing/billingEmails";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * An admin resolves a Contested charge: "approved" keeps it (it will be collected
 * on the next billing run) and "voided" removes it. A written internal note is
 * required and stays internal; the landlord is emailed the outcome only.
 * Body: { outcome: "approved" | "voided", note }
 *
 * @auth admin
 */
export async function POST(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;

  try {
    const { id } = await params;
    if (!isUuid(id)) throw new BillingError("not_found", "Charge not found.", 404);
    const { outcome, note } = await req.json().catch(() => ({}));

    const charge = await adminResolveContest(supabase, { chargeId: id, adminId: session.user.id, outcome, note });

    // The decision is already recorded; an email problem must not undo or fail it.
    try {
      const view = await getAdminChargeView(supabase, id);
      if (view.landlord.email) {
        await sendContestOutcomeEmail(
          { id: view.landlord.id, email: view.landlord.email, name: view.landlord.name },
          {
            outcome,
            charge: {
              amountCents: view.amountCents,
              triggerType: view.triggerType,
              listingLabel: view.listingLabel,
              leaseLabel: view.leaseLabel,
              studentName: view.studentName,
            },
            paymentsUrl: `${getBaseUrl()}/dashboard/landlord?tab=billing`,
          }
        );
      }
    } catch (emailErr) {
      console.error("billing: contest outcome email failed", emailErr);
    }
    return NextResponse.json({ ok: true, status: charge.status });
  } catch (err) {
    return billingErrorResponse(err, "resolve contest");
  }
}
