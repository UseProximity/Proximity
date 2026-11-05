export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { getStripe } from "@/lib/billing/stripe";
import { syncCheckoutSession } from "@/lib/billing/paymentMethods";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The landlord came back from Stripe Checkout: record the method they added now,
 * rather than waiting for the webhook, so it is on the page they land on. The
 * webhook records the same method; whichever arrives second changes nothing.
 * Body: { sessionId }. A session that is not this landlord's is refused.
 *
 * @auth landlord
 */
export async function POST(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { sessionId } = await req.json().catch(() => ({}));
    if (typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
      throw new BillingError("bad_session", "We could not find that setup session.", 404);
    }
    const result = await syncCheckoutSession(supabase, getStripe(), { sessionId, userId: session.user.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return billingErrorResponse(err, "sync checkout session");
  }
}
