export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { findEnrollmentAudience, getEnrollmentWindow, setEnrollmentWindow } from "@/lib/billing/enrollment";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Launch enrollment: the window existing landlords are given to add a payment
 * method (and, once it is ready, sign the agreement), and who would be emailed.
 *
 * GET  the saved window and the audience counts, so the admin can see how many
 *      landlords an email would reach and why the rest are left out.
 * PUT  { deadline: "YYYY-MM-DD" | null, includeAgreement: boolean } saves the
 *      window. The deadline appears in the email and as a banner on the landlord's
 *      Payments tab. Nothing happens automatically when it passes.
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  const supabase = billingDb.db;
  try {
    const window = await getEnrollmentWindow(supabase);
    const { counts, toSend } = await findEnrollmentAudience(supabase, { includeAgreement: window.includeAgreement });
    return NextResponse.json({ ...window, counts, sample: toSend.slice(0, 10).map((l) => ({ name: l.name, email: l.email })) });
  } catch (err) {
    return billingErrorResponse(err, "load enrollment");
  }
}

export async function PUT(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;
  try {
    const body = await req.json().catch(() => ({}));
    const window = await setEnrollmentWindow(
      supabase,
      { deadline: body.deadline || null, includeAgreement: body.includeAgreement === true },
      session.user.id
    );
    return NextResponse.json(window);
  } catch (err) {
    return billingErrorResponse(err, "save enrollment window");
  }
}
