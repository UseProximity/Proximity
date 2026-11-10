"use client";

import { formatCents } from "@/lib/billing/money";
import { basisLabel, refundedInFull, splitChargeHistory, statusMessage } from "@/lib/billing/chargeDisplay";

const STATUS = {
  unconfirmed: { label: "Unconfirmed", className: "bg-gray-100 text-gray-700" },
  pending: { label: "In review", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", className: "bg-blue-100 text-blue-800" },
  invoiced: { label: "Invoiced", className: "bg-indigo-100 text-indigo-800" },
  paid: { label: "Paid", className: "bg-green-100 text-green-800" },
  billed: { label: "Billed", className: "bg-blue-100 text-blue-800" },
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

// A Paid charge refunded in full reads Refunded; a partial refund or credit keeps Paid and says so below.
function statusOf(charge) {
  if (refundedInFull(charge)) {
    return { label: "Refunded", className: "bg-gray-100 text-gray-700" };
  }
  return STATUS[charge.status] ?? STATUS.unconfirmed;
}

function ChargeRow({ charge, busy, onApprove, onContest }) {
  const status = statusOf(charge);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {charge.triggerLabel}
            <span className="ml-2 text-xs font-normal text-gray-400">{dateOnly(charge.createdAt)}</span>
          </p>
          <p className="mt-0.5 text-xs text-gray-600">
            <Detail label="Account" value={charge.accountName} />
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
      {(charge.adjustments ?? []).map((a, i) => (
        <p key={i} className="mt-1 text-xs text-gray-700">
          {a.kind === "refund"
            ? `${formatCents(a.amountCents)} refunded on ${dateOnly(a.createdAt)}, back to the card or bank account you paid with.`
            : `${formatCents(a.amountCents)} credited on ${dateOnly(a.createdAt)}, taken off your next invoice.`}
        </p>
      ))}
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

// Points right while folded, down when open. `turn` names which fold it follows.
const Chevron = ({ turn }) => (
  <svg className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${turn}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.17 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
  </svg>
);

// What a past month adds up to: "4 charges · $1,240.00 paid · $100.00 refunded · 1 removed".
function monthSummary(group) {
  const n = group.charges.length;
  return [
    `${n} charge${n === 1 ? "" : "s"}`,
    group.paidCents > 0 ? `${formatCents(group.paidCents)} paid` : null,
    group.refundedCents > 0 ? `${formatCents(group.refundedCents)} refunded` : null,
    group.creditedCents > 0 ? `${formatCents(group.creditedCents)} credited` : null,
    group.removedCount > 0 ? `${group.removedCount} removed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/*
 * Paid and removed charges from before this month, folded away so the list
 * above stays short: one section, then one fold per month (newest first).
 * Nothing here has an action left, so it is read only.
 */
function PastCharges({ past }) {
  const total = past.reduce((n, g) => n + g.charges.length, 0);
  return (
    <details className="group border-t border-gray-100">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        <Chevron turn="group-open:rotate-90" />
        Past charges ({total})
      </summary>
      <div className="border-t border-gray-100">
        {past.map((g) => (
          <details key={g.month} className="group/month border-b border-gray-100 last:border-b-0">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 bg-gray-50 px-4 py-2.5 text-sm hover:bg-gray-100 [&::-webkit-details-marker]:hidden">
              <Chevron turn="group-open/month:rotate-90" />
              <span className="font-medium text-gray-900">{g.label}</span>
              <span className="text-xs text-gray-500">{monthSummary(g)}</span>
            </summary>
            <ul className="divide-y divide-gray-100">
              {g.charges.map((c) => (
                <ChargeRow key={c.id} charge={c} busy onApprove={() => {}} onContest={() => {}} />
              ))}
            </ul>
          </details>
        ))}
      </div>
    </details>
  );
}

// `billedTo`: a payer pays this account's charges (Project B): no balance tiles, they aren't this account's to pay.
export default function ChargesCard({ charges, summary, busy, onApprove, onContest, billedTo = null }) {
  const { current, past } = splitChargeHistory(charges);
  return (
    <section className="space-y-4">
      {!billedTo && <div className="flex flex-wrap gap-3">
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
      </div>}

      <div className="bg-white rounded-lg border border-gray-100 shadow-sm">
        <div className="px-4 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Charges</h2>
          <p className="mt-1 text-sm text-gray-500">
            {billedTo
              ? `Charges are reviewed before they are billed to ${billedTo}. Approve the ones that look right or contest the ones that do not.`
              : "Charges are reviewed before they are collected. Approve the ones that look right or contest the ones that do not. Everything approved is collected once a month on a single invoice."}
          </p>
        </div>
        {charges.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-600">You have no charges.</p>
        ) : current.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-600">Nothing in progress. Your earlier charges are under Past charges.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {current.map((c) => (
              <ChargeRow key={c.id} charge={c} busy={busy} onApprove={onApprove} onContest={onContest} />
            ))}
          </ul>
        )}
        {past.length > 0 && <PastCharges past={past} />}
      </div>
    </section>
  );
}
