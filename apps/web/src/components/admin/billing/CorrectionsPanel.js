"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, fmtDate } from "@/components/admin/adminShared";
import { formatCents } from "@/lib/billing/money";
import { billingFetch } from "@/components/admin/billing/billingFetch";

async function call(url, options) {
  const res = await billingFetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500";

function AdjustDialog({ charge, kind, busy, error, onCancel, onSubmit }) {
  const [amount, setAmount] = useState((charge.remainingCents / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const isRefund = kind === "refund";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4" role="dialog" aria-modal="true">
        <h3 className="text-lg font-semibold text-gray-900">{isRefund ? "Refund this charge" : "Credit the next invoice"}</h3>
        <p className="text-sm text-gray-600">
          {isRefund
            ? "The money goes back to the landlord's payment method through Stripe."
            : "A credit is taken off the landlord's next invoice automatically."}{" "}
          The original charge is not changed; this is recorded against it. Up to {formatCents(charge.remainingCents)} can
          still be adjusted.
        </p>
        <label className="block text-sm font-medium text-gray-700">
          Amount (dollars)
          <input className={`${FIELD} mt-1`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Reason (required, included in the email to the landlord)
          <textarea className={`${FIELD} mt-1`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() => onSubmit({ amount, reason: reason.trim() })}
            className="px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
          >
            {busy ? "Working..." : isRefund ? "Refund" : "Credit"}
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * Corrections: recent Paid charges, each with what has already been refunded or
 * credited. A wrong Paid charge is refunded (the default) or credited on the next
 * invoice; the charge itself is never edited.
 */
export default function CorrectionsPanel({ search }) {
  const [charges, setCharges] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null); // { charge, kind }
  const [dialogError, setDialogError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCharges((await call("/api/admin/billing/paid-charges")).charges);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    if (!charges) return [];
    return q
      ? charges.filter((c) => [c.landlord.email, c.landlord.name, c.listingLabel].some((v) => String(v ?? "").toLowerCase().includes(q)))
      : charges;
  }, [charges, search]);

  async function submit({ amount, reason }) {
    setBusy(true);
    setDialogError(null);
    try {
      await call(`/api/admin/billing/charges/${dialog.charge.id}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: dialog.kind, amount, reason }),
      });
      setNotice(dialog.kind === "refund" ? "Refund issued. The landlord has been emailed." : "Credit added to the landlord's next invoice. The landlord has been emailed.");
      setDialog(null);
      await load();
    } catch (e) {
      setDialogError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!charges && !error) return <p className="py-10 text-center text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-3">
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</div>}
      {charges && shown.length === 0 && (
        <p className="rounded-lg border border-gray-100 bg-white px-4 py-6 text-sm text-gray-500">No paid charges.</p>
      )}
      {shown.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
          {shown.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900">
                  {c.landlord.name || "Unnamed landlord"}
                  {c.landlord.email && <span className="text-xs text-gray-400"> ({c.landlord.email})</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {c.listingLabel ? `${c.listingLabel} · ` : ""}paid {fmtDate(c.paidAt)}
                </p>
              </div>
              {c.adjustedCents > 0 && <Badge color="amber">{formatCents(c.adjustedCents)} adjusted</Badge>}
              <span className="text-sm font-semibold text-gray-900">{formatCents(c.amountCents)}</span>
              <button
                type="button"
                disabled={c.remainingCents <= 0}
                onClick={() => { setDialogError(null); setDialog({ charge: c, kind: "refund" }); }}
                className="px-3 py-1.5 rounded-md bg-gray-900 text-white text-sm hover:bg-gray-700 disabled:opacity-40"
              >
                Refund
              </button>
              <button
                type="button"
                disabled={c.remainingCents <= 0}
                onClick={() => { setDialogError(null); setDialog({ charge: c, kind: "credit" }); }}
                className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Credit
              </button>
            </li>
          ))}
        </ul>
      )}
      {dialog && (
        <AdjustDialog
          charge={dialog.charge}
          kind={dialog.kind}
          busy={busy}
          error={dialogError}
          onCancel={() => setDialog(null)}
          onSubmit={submit}
        />
      )}
    </div>
  );
}
