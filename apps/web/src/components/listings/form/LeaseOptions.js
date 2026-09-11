"use client";

/*
 * Lease options for ONE unit, shown directly under that unit's tab.
 *
 * A unit is a physical place; a lease is one landlord's offering on it. Several
 * landlords can offer the same unit, so these rows are competing options a
 * renter picks between — and because each row is a different landlord, contact
 * belongs on the row rather than on the property. That is why there is no
 * selection state here: every row is independently actionable.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { availabilityLabel } from "@/utils/availability";

const money = (n) =>
  n == null ? null : `$${Number(n).toLocaleString("en-US")}`;

// Every term the landlord will accept, ascending and de-duplicated.
export function leaseTermList(leaseTermMonths) {
  return [
    ...new Set(
      (leaseTermMonths ?? [])
        .map(Number)
        .filter((m) => Number.isFinite(m) && m > 0)
    ),
  ].sort((a, b) => a - b);
}

/**
 * Lease length. unit_leases.lease_term_months holds every term a landlord will
 * accept, so [12, 10] is one offering flexible between 10 and 12 months — not
 * two offerings.
 *
 * Up to three terms are listed outright, because "3, 6, 12 months" is the true
 * answer and a range is not: "3–12 months" implies 7 and 9 are on offer when
 * they are not. Past three the list stops fitting the column, so it collapses to
 * a range with the full set behind a chevron.
 */
export function durationLabel(leaseTermMonths) {
  const months = leaseTermList(leaseTermMonths);
  if (!months.length) return null;
  if (months.length === 1) return `${months[0]} months`;
  if (months.length <= 3) return `${months.join(", ")} months`;
  return `${months[0]}–${months[months.length - 1]} months`;
}

// Kept as a named export for callers that want the raw date text; the panel
// itself renders through availabilityLabel so a past date reads as "Now".
export function moveInLabel(availableFrom) {
  return availabilityLabel(availableFrom).text;
}

export const leaseTypeLabel = (lease) =>
  lease?.sublease ? "Sublease" : "Standard";

/*
 * Duration, with the full set of terms a click away once there are more than
 * three of them. The summary stays a range so the column keeps its width; the
 * chevron is what tells a renter the range is a list rather than a span.
 */
function DurationCell({ leaseTermMonths }) {
  const [open, setOpen] = useState(false);
  const months = leaseTermList(leaseTermMonths);
  const label = durationLabel(leaseTermMonths);
  const expandable = months.length > 3;

  if (!expandable) return <Cell label="Duration">{label}</Cell>;

  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
        Duration
      </dt>
      <dd className="text-xs text-gray-700">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-0.5 rounded text-left hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <span className="truncate">{label}</span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
        {/*
          * Expands in place rather than floating. The whole offerings block sits
          * inside an overflow-hidden card, so an absolutely-positioned menu is
          * sheared off at the card's edge — worst on the last row, where all of
          * it would be.
          */}
        {open && (
          <span className="mt-1 flex flex-wrap gap-1">
            {months.map((m) => (
              <span
                key={m}
                className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700"
              >
                {m} mo
              </span>
            ))}
          </span>
        )}
      </dd>
    </div>
  );
}

function Cell({ label, children, className = "" }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </dt>
      <dd className="truncate text-xs text-gray-700">{children ?? "—"}</dd>
    </div>
  );
}

export default function LeaseOptions({ leases = [], loading = false, onContact }) {
  /*
   * "Loading" and "none offered" are different answers and must not be confused:
   * the browse panel paints itself from the listing feed before the detail fetch
   * lands, and that feed carries no leases at all. Claiming a unit has no lease
   * during that gap is simply wrong.
   */
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-xs text-gray-500">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-red-500" />
        Loading lease options…
      </div>
    );
  }

  if (!leases.length) {
    return (
      <p className="px-4 py-4 text-xs text-gray-500">
        No lease is currently being offered on this unit.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100">
      {leases.map((lease) => (
        <LeaseRow key={lease.id} lease={lease} onContact={onContact} />
      ))}
    </ul>
  );
}

/*
 * One offering. The five columns are what a renter compares across offerings;
 * everything that is true of only this one — the landlord's own note, whether
 * they furnish it — lives behind the chevron, so a unit with four competing
 * offerings still fits on a screen. Reaching the landlord goes through Contact,
 * never a phone number printed on the row.
 */
function LeaseRow({ lease, onContact }) {
  const [open, setOpen] = useState(false);
  const details = [
    lease.furnished == null
      ? null
      : { label: "Furnished", value: lease.furnished ? "Yes" : "No" },
  ].filter(Boolean);
  const hasDetails = !!lease.description || details.length > 0;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
          <div className="min-w-0">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
              Price
            </dt>
            <dd className="truncate text-sm font-semibold text-gray-900">
              {money(lease.rent) ? (
                <>
                  {money(lease.rent)}
                  {/*
                    * Say which number this is. A $2,800 four-bed means very
                    * different things per person and per apartment, and the
                    * renter is the one who has to tell them apart.
                    */}
                  <span className="font-normal text-gray-500">
                    {lease.rentIsPerPerson ? "/person" : "/mo"}
                  </span>
                </>
              ) : (
                <span className="text-gray-600">Contact for Price</span>
              )}
            </dd>
          </div>
          <Cell label="Available on">
            {(() => {
              const a = availabilityLabel(lease.availableFrom);
              return a.now ? (
                <span className="font-semibold text-green-600">{a.text}</span>
              ) : (
                a.text
              );
            })()}
          </Cell>
          <DurationCell leaseTermMonths={lease.leaseTermMonths} />
          <Cell label="Lease type">{leaseTypeLabel(lease)}</Cell>
          <Cell label="Listed by">{lease.landlordName}</Cell>
        </dl>

        <div className="flex shrink-0 items-center gap-1.5">
          {hasDetails && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? "Hide details" : "Show details"}
              className="rounded-lg p-2 text-gray-400 transition hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
          )}
          {/* Contact closes the row it belongs to, so a renter can never send an
              enquiry to a landlord other than the one whose terms they just read. */}
          <button
            type="button"
            onClick={() => onContact?.(lease)}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 sm:w-[130px] sm:flex-none"
          >
            Contact
          </button>
        </div>
      </div>

      {open && hasDetails && (
        <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5">
          {lease.description && (
            <p className="whitespace-pre-line text-xs leading-relaxed text-gray-700">
              {lease.description}
            </p>
          )}
          {details.length > 0 && (
            <dl
              className={`flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600 ${
                lease.description ? "mt-2" : ""
              }`}
            >
              {details.map((d) => (
                <div key={d.label} className="flex gap-1.5">
                  <dt className="text-gray-400">{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}
