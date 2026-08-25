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

/**
 * Lease length as a plain range. unit_leases.lease_term_months holds every term
 * a landlord will accept, so [12, 10] is one offering flexible between 10 and 12
 * months — not two offerings.
 */
export function durationLabel(leaseTermMonths) {
  const months = (leaseTermMonths ?? [])
    .map(Number)
    .filter((m) => Number.isFinite(m) && m > 0);
  if (!months.length) return null;
  const min = Math.min(...months);
  const max = Math.max(...months);
  return min === max ? `${min} months` : `${min}–${max} months`;
}

// Kept as a named export for callers that want the raw date text; the panel
// itself renders through availabilityLabel so a past date reads as "Now".
export function moveInLabel(availableFrom) {
  return availabilityLabel(availableFrom).text;
}

export const leaseTypeLabel = (lease) =>
  lease?.sublease ? "Sublease" : "Standard";

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
 * they furnish it, a phone number — lives behind the chevron, so a unit with
 * four competing offerings still fits on a screen.
 */
function LeaseRow({ lease, onContact }) {
  const [open, setOpen] = useState(false);
  const details = [
    lease.furnished == null
      ? null
      : { label: "Furnished", value: lease.furnished ? "Yes" : "No" },
    lease.contactPhone ? { label: "Phone", value: lease.contactPhone } : null,
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
          <Cell label="Duration">{durationLabel(lease.leaseTermMonths)}</Cell>
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
