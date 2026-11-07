"use client";

import { formatCents } from "@/lib/billing/money";
import { basisLabel, statusMessage } from "@/lib/billing/chargeDisplay";

const STATUS = {
  unconfirmed: { label: "Unconfirmed", className: "bg-gray-100 text-gray-700" },
  pending: { label: "In review", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", className: "bg-blue-100 text-blue-800" },
  invoiced: { label: "Invoiced", className: "bg-indigo-100 text-indigo-800" },
  paid: { label: "Paid", className: "bg-green-100 text-green-800" },
  contested: { label: "Contested", className: "bg-red-100 text-red-800" },
  voided: { label: "Removed", className: "bg-gray-100 text-gray-500" },
};

const dateOnly = (iso) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function Tile({ label, value, hint }) {
  return (
    <div className="flex-1 min-w-[10rem] rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  );
}

function Detail({ label, value }) {
  if (!value) return null;
  return (
    <span className="mr-4">
      <span className="text-gray-400">{label}: </span>
      {value}
    </span>
  );
}

function ChargeRow({ charge, busy, onApprove, onContest }) {
  const status = STATUS[charge.status] ?? STATUS.unconfirmed;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {charge.triggerLabel}
            <span className="ml-2 text-xs font-normal text-gray-400">{dateOnly(charge.createdAt)}</span>
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
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>{status.label}</span>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {statusMessage(charge)}
        {charge.status === "pending" && charge.reviewEndsAt && ` Review ends ${dateOnly(charge.reviewEndsAt)}.`}
      </p>
      {charge.status === "contested" && charge.contestReason && (
        <p className="mt-1 text-xs text-gray-500">Your reason: {charge.contestReason}</p>
      )}
      {charge.actions.contactForDispute && (
        <p className="mt-1 text-xs text-gray-500">
          To dispute this charge, please contact the team at info@useproximity.org.
        </p>
      )}

      {(charge.actions.approve || charge.actions.contest) && (
        <div className="mt-3 flex gap-2">
          {charge.actions.approve && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onApprove(charge)}
              className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-60"
            >
              Approve
            </button>
          )}
          {charge.actions.contest && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onContest(charge)}
              className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Contest
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function ChargesCard({ charges, summary, busy, onApprove, onContest }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Tile
          label="Current balance"
          value={formatCents(summary.balanceCents)}
          hint="Approved. Collected on the next monthly invoice."
        />
        <Tile
          label="In review"
          value={formatCents(summary.inReviewCents)}
          hint="Not collected until approved."
        />
      </div>

      <div className="bg-white rounded-lg border border-gray-100 shadow-sm">
        <div className="px-4 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Charges</h2>
          <p className="mt-1 text-sm text-gray-500">
            Charges are reviewed before they are collected. Approve the ones that look right or contest the ones
            that do not. Everything approved is collected once a month on a single invoice.
          </p>
        </div>
        {charges.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-600">You have no charges.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {charges.map((c) => (
              <ChargeRow key={c.id} charge={c} busy={busy} onApprove={onApprove} onContest={onContest} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
