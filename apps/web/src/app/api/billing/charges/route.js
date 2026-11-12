export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { billingReader } from "@/lib/billing/viewer";
import { listChargesForLandlord, listChargesPaidBy } from "@/lib/billing/charges";
import { payeeChargeView } from "@/lib/billing/chargeDisplay";
import { activePayerLink } from "@/lib/billing/payerLinks";
import { summarizeBalance } from "@/lib/billing/chargeLifecycle";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The signed-in landlord's charges, newest first, with what the next billing run
 * will collect (balanceCents) and what is still under review (inReviewCents).
 * Each charge says which actions the landlord may take on it. The admin's
 * internal notes are never included.
 *
 * With a payer (Project B) the landlord's charges read "Billed to" the payer and
 * `billedTo` is set; a payer also gets the charges of the accounts they pay for,
 * each with `accountName`, read only.
 *
 * @auth landlord (own charges only)
 */
export async function GET(req) {
  const reader = await billingReader(req);
  if (!reader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const [own, paidFor, link] = await Promise.all([
      listChargesForLandlord(supabase, reader.userId),
      listChargesPaidBy(supabase, reader.userId),
      activePayerLink(supabase, reader.userId),
    ]);
    // What this account is invoiced for: its own charges (each one the payer
    // doesn't pay, read per charge, never from whether a payer exists now) and the
    // charges of the accounts it pays for.
    const billedHere = [...own.filter((c) => !c.billedElsewhere), ...paidFor];
    const summary = summarizeBalance(billedHere.map((c) => ({ status: c.status, amount_cents: c.amountCents })));
    // A charge billed to the payer reads "Billed to" them (Project B); one still the landlord's stays theirs.
    const mine = link ? own.map((c) => (c.billedElsewhere ? payeeChargeView(c, link.signer_name) : c)) : own;
    const charges = [...mine, ...paidFor].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return NextResponse.json({ charges, summary, billedTo: link ? link.signer_name : null });
  } catch (err) {
    return billingErrorResponse(err, "list charges");
  }
}
