/*
 * GET /api/admin/billing/summary
 *
 * The money side of the admin Billing overview: how many charges and invoices
 * sit in each state, and what they add up to. Test charges are left out.
 * Follows the dashboard's dev/prod switch like the other billing reads.
 *
 * @auth super
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { billingErrorResponse } from "@/lib/billing/http";

async function byStatus(db, table, amount, filter) {
  const out = {};
  for (let from = 0; from < 50000; from += 1000) {
    let q = db.from(table).select(`status, ${amount}`).order("id").range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? []) {
      const s = (out[r.status] ??= { count: 0, cents: 0 });
      s.count += 1;
      s.cents += Number(r[amount] ?? 0);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function GET(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { db } = adminBillingDb(req);
  try {
    const [charges, invoices] = await Promise.all([
      byStatus(db, "charges", "amount_cents", (q) => q.eq("is_test", false)),
      byStatus(db, "billing_invoices", "total_cents"),
    ]);
    return NextResponse.json({ charges, invoices });
  } catch (err) {
    return billingErrorResponse(err, "load billing summary");
  }
}
