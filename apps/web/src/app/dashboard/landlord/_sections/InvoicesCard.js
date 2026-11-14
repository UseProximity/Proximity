"use client";

import { formatCents } from "@/lib/billing/money";
import { periodLabel } from "@/lib/billing/invoicing";

const STATUS = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800" },
  processing: { label: "Processing", className: "bg-amber-100 text-amber-800" },
  paid: { label: "Paid", className: "bg-green-100 text-green-800" },
  failed: { label: "Payment failed", className: "bg-red-100 text-red-800" },
  void: { label: "Void", className: "bg-gray-100 text-gray-500" },
  uncollectible: { label: "Written off", className: "bg-gray-100 text-gray-500" },
};

const NOTE = {
  open: "Waiting for payment. Nothing is charged until you pay, unless autopay is on.",
  preparing: "This invoice is still being prepared. Nothing is due yet.",
  processing: "Your bank payment is being processed. This takes a few business days.",
  paid: "Paid. Thank you.",
  void: "This invoice was cancelled. Nothing is owed for it.",
  uncollectible: "This invoice was written off.",
};

const dateOnly = (iso) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

const RESULT_TONE = {
  green: "bg-green-50 text-green-800",
  red: "bg-red-50 text-red-800",
};

function InvoiceRow({ invoice, busy, paying, result, onPay }) {
  const status = STATUS[invoice.status] ?? STATUS.open;
  // A Pay now that just failed says why in its own red box: the same reason is not repeated above it.
  const failureInResult = invoice.status === "failed" && result?.tone === "red";
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {periodLabel(invoice.billingPeriod)}
            {invoice.invoiceDate && (
              <span className="ml-2 text-xs font-normal text-gray-400">Invoiced {dateOnly(invoice.invoiceDate)}</span>
            )}
            {invoice.dueDate && invoice.canPay && (
              <span className="ml-2 text-xs font-normal text-gray-500">Due {dateOnly(invoice.dueDate)}</span>
            )}
          </p>
        </div>
        <p className="text-sm font-semibold text-gray-900">{formatCents(invoice.totalCents)}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>{status.label}</span>
      </div>

      {!failureInResult && (
        <p className="mt-1 text-xs text-gray-500">
          {invoice.status === "failed"
            ? invoice.failureMessage || "The payment did not go through."
            : NOTE[invoice.status === "open" && !invoice.invoiceDate ? "preparing" : invoice.status]}
        </p>
      )}
      {invoice.accounts?.length > 0 && (
        <ul className="mt-1 text-xs text-gray-600">
          {invoice.accounts.map((a) => (
            <li key={a.name}>
              {a.name}: {formatCents(a.totalCents)}
            </li>
          ))}
        </ul>
      )}
      {invoice.refundedCents > 0 && (
        <p className="mt-1 text-xs text-gray-700">
          {formatCents(invoice.refundedCents)} refunded to the card or bank account you paid with.
        </p>
      )}
      {invoice.creditedCents > 0 && (
        <p className="mt-1 text-xs text-gray-700">
          {formatCents(invoice.creditedCents)} credited, taken off your next invoice.
        </p>
      )}
      {result && (
        <p role="status" className={`mt-2 rounded-md px-3 py-2 text-sm ${RESULT_TONE[result.tone] ?? RESULT_TONE.green}`}>
          {result.text}
        </p>
      )}
      {invoice.autopayDate && (
        <p className="mt-1 text-xs text-gray-700">Autopay will charge it on {dateOnly(invoice.autopayDate)}.</p>
      )}
      {invoice.status === "failed" && (
        <p className="mt-1 text-xs text-gray-500">
          It will not be retried automatically. Update your payment method if needed, then pay it here. Invoices unpaid
          for more than 30 days past their due date hide your listings from students.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {invoice.canPay && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onPay(invoice)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
          >
            {paying && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {paying ? "Paying..." : invoice.status === "failed" ? "Retry payment" : "Pay now"}
          </button>
        )}
        {invoice.canPay && invoice.hostedInvoiceUrl && (
          <a
            href={invoice.hostedInvoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
          >
            Pay with a different method
          </a>
        )}
        {invoice.invoicePdfUrl && (
          <a
            data-readonly-ok
            href={invoice.invoicePdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-600 underline hover:text-gray-900"
          >
            Invoice PDF
          </a>
        )}
      </div>
    </li>
  );
}

export default function InvoicesCard({ invoices, busy, payingId = null, results = {}, onPay }) {
  return (
    <section id="invoices" className="bg-white rounded-lg border border-gray-100 shadow-sm">
      <div className="px-4 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Invoices</h2>
        <p className="mt-1 text-sm text-gray-500">
          Approved charges are put on one invoice a month, on the first Monday. We email it to you and it is due 30
          days later. Nothing is charged until you press Pay now, unless you turn on autopay.
        </p>
      </div>
      {invoices.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-600">You have no invoices yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {invoices.map((inv) => (
            <InvoiceRow
              key={inv.id}
              invoice={inv}
              busy={busy}
              paying={payingId === inv.id}
              result={results[inv.id] ?? null}
              onPay={onPay}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
