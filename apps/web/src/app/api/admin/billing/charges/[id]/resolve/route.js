export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { getBaseUrl } from "@/lib/email";
import { adminResolveContest, getAdminChargeView } from "@/lib/billing/adminReview";
import { contestedBy } from "@/lib/billing/charges";
import { sendContestOutcomeEmail } from "@/lib/billing/billingEmails";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * An admin resolves a Contested charge: "approved" keeps it (it will be collected
 * on the next billing run) and "voided" removes it. A written internal note is
 * required and stays internal; the landlord is emailed the outcome only, and so
 * is whoever else is part of it (Wyatt, 2026-11-25): the person the charge is
 * billed to, and the authorized payer who contested it.
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
      const details = {
        outcome,
        charge: {
          amountCents: view.amountCents,
          triggerType: view.triggerType,
          listingLabel: view.listingLabel,
          leaseLabel: view.leaseLabel,
          studentName: view.studentName,
        },
        paymentsUrl: `${getBaseUrl()}/dashboard/landlord?tab=billing`,
      };
      // Who contested it, and who is invoiced for it: either may not be the landlord.
      const contesterId = (await contestedBy(supabase, [id])).get(id) ?? view.landlord.id;
      const billedId = view.billedToId ?? view.landlord.id;
      const otherIds = [...new Set([contesterId, billedId])].filter((uid) => uid !== view.landlord.id);
      const people = new Map();
      if (otherIds.length) {
        const { data } = await supabase.from("users").select("id, name, company_name, email").in("id", otherIds).is("deleted_at", null);
        for (const u of data ?? []) people.set(u.id, u);
      }
      const nameOf = (uid) => (uid === view.landlord.id ? view.landlord.company_name?.trim() || view.landlord.name : people.get(uid)?.name?.trim() || people.get(uid)?.company_name?.trim()) || "someone else on the account";
      const recipients = [view.landlord, ...otherIds.map((uid) => people.get(uid)).filter(Boolean)];
      for (const to of recipients) {
        if (!to.email) continue;
        await sendContestOutcomeEmail(
          { id: to.id, email: to.email, name: to.name },
          {
            ...details,
            ...(to.id !== contesterId && { contestedBy: nameOf(contesterId) }),
            ...(to.id !== billedId && { invoicedTo: nameOf(billedId) }),
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
