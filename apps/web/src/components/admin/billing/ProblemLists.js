"use client";

import { Badge, fmtDate } from "@/components/admin/adminShared";
import { formatCents } from "@/lib/billing/money";

const Landlord = ({ landlord }) => (
  <p className="text-xs text-gray-700">
    {landlord.name || "Unnamed landlord"}
    {landlord.email && <span className="text-gray-400"> ({landlord.email})</span>}
  </p>
);

function Empty({ children }) {
  return <p className="rounded-lg border border-gray-100 bg-white px-4 py-6 text-sm text-gray-500">{children}</p>;
}

// Stripe disputes (bank and card chargebacks). Read-only: they are answered in the Stripe dashboard.
export function ChargebackList({ chargebacks }) {
  if (chargebacks.length === 0) return <Empty>No chargebacks.</Empty>;
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
      {chargebacks.map((d) => (
        <li key={d.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <Landlord landlord={d.landlord} />
            <p className="mt-0.5 text-xs text-gray-500">
              {d.reason || "No reason given"} · opened {fmtDate(d.createdAt)}
            </p>
          </div>
          {d.status && <Badge color="amber">{d.status.replace(/_/g, " ")}</Badge>}
          <p className="text-sm font-semibold text-gray-900">{formatCents(d.amountCents)}</p>
        </li>
      ))}
    </ul>
  );
}

const REASON_BADGE = {
  failed: <Badge color="red">Payment failed</Badge>,
  overdue: <Badge color="red">Overdue</Badge>,
  restore: <Badge color="amber">Leases withdrawn</Badge>,
  unfinished: <Badge color="amber">Not issued</Badge>,
};

/*
 * Invoices that need an admin: failed, past the 30 day overdue limit, or whose
 * leases were withdrawn and are still waiting to be put back, or that a billing
 * run started but never issued in Stripe (Run billing now finishes it). Admins never
 * charge a landlord: Resend emails the invoice again (with Pay now); Restore puts
 * back the leases the overdue job withdrew (do this once the invoice is settled).
 */
export function InvoiceList({ invoices, busy, onResend, onRestore }) {
  if (invoices.length === 0) return <Empty>No failed or overdue invoices.</Empty>;
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
      {invoices.map((inv) => (
        <li key={inv.id} className="px-4 py-3 space-y-2">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <Landlord landlord={inv.landlord} />
              <p className="mt-0.5 text-xs text-gray-500">
                {inv.invoiceDate
                  ? `Invoiced ${fmtDate(inv.invoiceDate)} (${inv.daysOld} days ago)${inv.dueDate ? ` · due ${fmtDate(inv.dueDate)}` : ""} · ${inv.status}${inv.autopayDate ? ` · autopay ${fmtDate(inv.autopayDate)}` : ""}`
                  : `Started ${inv.daysOld} days ago, never issued in Stripe. Run billing now to finish it.`}
                {inv.failureMessage ? ` · ${inv.failureMessage}` : ""}
              </p>
            </div>
            {REASON_BADGE[inv.reason]}
            {inv.disputed && <Badge color="amber">Disputed</Badge>}
            {inv.leasesToRestore > 0 && <Badge color="gray">{inv.leasesToRestore} lease(s) withdrawn</Badge>}
            <p className="text-sm font-semibold text-gray-900">{formatCents(inv.totalCents)}</p>
          </div>
          {(inv.canResend || inv.leasesToRestore > 0) && (
            <div className="flex flex-wrap gap-2">
              {inv.canResend && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onResend(inv)}
                  className="px-3 py-1.5 rounded-md bg-gray-900 text-white text-sm hover:bg-gray-700 disabled:opacity-60"
                >
                  Resend invoice email
                </button>
              )}
              {inv.leasesToRestore > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRestore(inv)}
                  className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Restore leases
                </button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
