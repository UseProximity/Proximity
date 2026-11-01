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

// Invoices that failed or are past the 30 day overdue limit.
export function InvoiceList({ invoices }) {
  if (invoices.length === 0) return <Empty>No failed or overdue invoices.</Empty>;
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
      {invoices.map((inv) => (
        <li key={inv.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <Landlord landlord={inv.landlord} />
            <p className="mt-0.5 text-xs text-gray-500">
              Invoiced {fmtDate(inv.invoiceDate)} ({inv.daysOld} days ago)
              {inv.failureMessage ? ` · ${inv.failureMessage}` : ""}
            </p>
          </div>
          {inv.reason === "failed" ? <Badge color="red">Payment failed</Badge> : <Badge color="red">Overdue</Badge>}
          {inv.disputed && <Badge color="amber">Disputed</Badge>}
          {inv.leasesWithdrawn && <Badge color="gray">Leases withdrawn</Badge>}
          <p className="text-sm font-semibold text-gray-900">{formatCents(inv.totalCents)}</p>
        </li>
      ))}
    </ul>
  );
}
