export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { billingReader } from "@/lib/billing/viewer";
import { listChargesForLandlord, listChargesPaidBy } from "@/lib/billing/charges";
import { payeeChargeView } from "@/lib/billing/chargeDisplay";
import { billedTo, billingLinksFor } from "@/lib/billing/payerLinks";
import { summarizeBalance } from "@/lib/billing/chargeLifecycle";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The signed-in landlord's charges, newest first, with what the next billing run
 * will collect (balanceCents) and what is still under review (inReviewCents).
 * Each charge says which actions the landlord may take on it. The admin's
 * internal notes are never included.
 *
 * A charge invoiced to someone else (the account's authorized signer, or its
 * authorized payer) reads "Billed to" them: who that is was decided when the
 * charge was made, so it is read per charge, never from who signs or pays now.
 * Whoever is billed also gets the charges of the accounts they pay for, each
 * with `accountName`: read only for a signer, with Approve and Dispute for an
 * authorized payer (Wyatt, 2026-11-25).
 *
 * @auth landlord (own charges only)
 */
export async function GET(req) {
  const reader = await billingReader(req);
  if (!reader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const [own, paidFor, links] = await Promise.all([
      listChargesForLandlord(supabase, reader.userId),
      listChargesPaidBy(supabase, reader.userId),
      billingLinksFor(supabase, reader.userId),
    ]);
    const link = links.signers.account;
    // What this account is invoiced for: its own charges (each one nobody else
    // pays, read per charge) and the charges of the accounts it pays for.
    const billedHere = [...own.filter((c) => !c.billedElsewhere), ...paidFor];
    const summary = summarizeBalance(billedHere.map((c) => ({ status: c.status, amount_cents: c.amountCents })));
    // The name of whoever each charge is billed to.
    const ids = [...new Set(own.map((c) => c.billedToId).filter(Boolean))];
    const nameOf = new Map();
    if (ids.length) {
      const { data, error } = await supabase.from("users").select("id, name, company_name, email").in("id", ids);
      if (error) throw error;
      for (const u of data ?? []) nameOf.set(u.id, u.name?.trim() || u.company_name?.trim() || u.email);
    }
    const mine = own.map((c) => (c.billedElsewhere ? payeeChargeView(c, nameOf.get(c.billedToId) ?? link?.signer_name ?? "someone else") : c));
    const charges = [...mine, ...paidFor].map(({ billedToId: _omit, ...c }) => c).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    // `billedTo`: who this account's charges go to by default now (its authorized
    // payer, else its authorized signer), or null when the landlord pays.
    const whole = billedTo({ landlordId: reader.userId, ...links });
    return NextResponse.json({ charges, summary, billedTo: whole.name });
  } catch (err) {
    return billingErrorResponse(err, "list charges");
  }
}
