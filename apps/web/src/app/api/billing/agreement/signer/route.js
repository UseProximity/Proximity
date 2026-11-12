export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { stripeBillingAddressLines } from "@/lib/billing/billingAddress";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * What we already know about the signed-in landlord, to start the signing form
 * with (Wyatt, 2026-11-06): full name, company, email and the billing address on
 * their Stripe account as two lines. Every field stays editable on the form.
 * Answers { name, company, email, address1 (street), address2 (suite or unit),
 * city ("St. Louis, MO 63117") } (empty strings when unknown).
 *
 * @auth landlord (own details only)
 */
export async function GET() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { data: user, error } = await supabase.from("users").select("name, company_name, email").eq("id", session.user.id).maybeSingle();
    if (error) throw error;
    // The address is a nicety: a Stripe problem never stops the form from loading.
    const address = await stripeBillingAddressLines(supabase, session.user.id).catch(() => null);
    return NextResponse.json({
      name: user?.name?.trim() ?? "",
      company: user?.company_name?.trim() ?? "",
      email: user?.email?.trim() ?? "",
      address1: address?.street ?? "",
      address2: address?.suite ?? "",
      city: address?.city ?? "",
    });
  } catch (err) {
    return billingErrorResponse(err, "load signer details");
  }
}
