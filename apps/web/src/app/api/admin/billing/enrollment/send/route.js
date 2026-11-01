export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { getBaseUrl } from "@/lib/email";
import { findEnrollmentAudience, formatDeadline, getEnrollmentWindow, sendEnrollmentEmails } from "@/lib/billing/enrollment";
import { sendEnrollmentEmail } from "@/lib/billing/billingEmails";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Send the launch enrollment email, using the saved window.
 * Body: { mode: "test" | "all", confirm?: boolean, includeAlreadyEmailed?: boolean }
 *
 *   test  sends one copy to the admin's own address, so the wording can be checked.
 *   all   emails every landlord the audience counts show (a live listing, not set
 *         up yet, not already emailed). Needs { confirm: true } and a saved
 *         deadline. Sends at most 300 per call; call again to continue, since
 *         anyone already emailed is skipped.
 *
 * Every email goes through the outreach gate, so off production it is redirected
 * to the test inbox or not sent.
 *
 * @auth admin
 */
export async function POST(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { mode, confirm, includeAlreadyEmailed } = await req.json().catch(() => ({}));
    if (mode !== "test" && mode !== "all") throw new BillingError("bad_mode", "Choose test or all.");

    const window = await getEnrollmentWindow(supabase);
    const input = {
      deadline: formatDeadline(window.deadline),
      includeAgreement: window.includeAgreement,
      paymentsUrl: `${getBaseUrl()}/dashboard/landlord?tab=payments`,
    };

    if (mode === "test") {
      const sent = await sendEnrollmentEmail(
        { id: session.user.id, email: session.user.email, name: session.user.name },
        input
      );
      return NextResponse.json({ ok: true, mode, sent: sent ? 1 : 0, to: session.user.email });
    }

    if (confirm !== true) throw new BillingError("confirm_required", "Confirm that you want to email the landlords.");
    if (!window.deadline) throw new BillingError("deadline_required", "Set the enrollment deadline before emailing landlords.");

    const { toSend } = await findEnrollmentAudience(supabase, {
      includeAgreement: window.includeAgreement,
      includeAlreadyEmailed: includeAlreadyEmailed === true,
    });
    const result = await sendEnrollmentEmails({ toSend, send: (landlord) => sendEnrollmentEmail(landlord, input) });
    return NextResponse.json({ ok: true, mode, ...result });
  } catch (err) {
    return billingErrorResponse(err, "send enrollment emails");
  }
}
