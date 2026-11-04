"use client";

import { Badge, fmtDate } from "@/components/admin/adminShared";
import { basisLabel } from "@/lib/billing/chargeDisplay";
import { formatCents } from "@/lib/billing/money";

function Detail({ label, value }) {
  if (!value) return null;
  return (
    <span className="mr-4">
      <span className="text-gray-400">{label}: </span>
      {value}
    </span>
  );
}

function ChargeRow({ charge, mode, busy, onConfirm, onResolve, onVoid }) {
  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {charge.triggerLabel}
            {charge.isTest && (
              <span className="ml-2 align-middle">
                <Badge color="purple">Test</Badge>
              </span>
            )}
            <span className="ml-2 text-xs font-normal text-gray-400">{fmtDate(charge.createdAt)}</span>
          </p>
          <p className="text-xs text-gray-700">
            {charge.landlord.name || "Unnamed landlord"}
            {charge.landlord.email && <span className="text-gray-400"> ({charge.landlord.email})</span>}
          </p>
          <p className="mt-0.5 text-xs text-gray-600">
            <Detail label="Listing" value={charge.listingLabel} />
            <Detail label="Lease" value={charge.leaseLabel} />
            <Detail label="Student" value={charge.studentName} />
            <Detail label="Basis" value={basisLabel(charge)} />
          </p>
          {charge.description && <p className="mt-0.5 text-xs text-gray-500">{charge.description}</p>}
        </div>
        <p className="text-sm font-semibold text-gray-900">{formatCents(charge.amountCents)}</p>
      </div>

      {mode === "contest" && (
        <blockquote className="border-l-4 border-amber-300 bg-amber-50 px-3 py-2 text-sm text-gray-800">
          <span className="block text-xs font-medium text-amber-800">
            Landlord&apos;s reason{charge.contestedAt ? ` (${fmtDate(charge.contestedAt)})` : ""}
          </span>
          {charge.contestReason}
        </blockquote>
      )}

      <div className="flex flex-wrap gap-2">
        {mode === "confirm" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(charge)}
              className="px-3 py-1.5 rounded-md bg-gray-900 text-white text-sm hover:bg-gray-700 disabled:opacity-60"
            >
              Confirm (start 7 day review)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onVoid(charge)}
              className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              Void
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolve(charge, "approved")}
              className="px-3 py-1.5 rounded-md bg-gray-900 text-white text-sm hover:bg-gray-700 disabled:opacity-60"
            >
              Uphold charge (approve)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolve(charge, "voided")}
              className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              Void charge
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export default function ChargeQueue({ charges, mode, empty, busy, onConfirm, onResolve, onVoid }) {
  if (charges.length === 0) {
    return <p className="rounded-lg border border-gray-100 bg-white px-4 py-6 text-sm text-gray-500">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
      {charges.map((c) => (
        <ChargeRow
          key={c.id}
          charge={c}
          mode={mode}
          busy={busy}
          onConfirm={onConfirm}
          onResolve={onResolve}
          onVoid={onVoid}
        />
      ))}
    </ul>
  );
}
