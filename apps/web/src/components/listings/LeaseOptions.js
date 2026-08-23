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

export function moveInLabel(availableFrom) {
  if (!availableFrom) return null;
  return new Date(availableFrom).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    // available_from is a date column, so render it as written rather than
    // shifting it into the viewer's timezone.
    timeZone: "UTC",
  });
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
        <li
          key={lease.id}
          className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
        >
          <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
            <div className="min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                Price
              </dt>
              <dd className="truncate text-sm font-semibold text-gray-900">
                {money(lease.rent) ? (
                  <>
                    {money(lease.rent)}
                    <span className="font-normal text-gray-500">/mo</span>
                  </>
                ) : (
                  <span className="text-gray-600">Contact for Price</span>
                )}
              </dd>
            </div>
            <Cell label="Move in">{moveInLabel(lease.availableFrom)}</Cell>
            <Cell label="Duration">{durationLabel(lease.leaseTermMonths)}</Cell>
            <Cell label="Lease type">{leaseTypeLabel(lease)}</Cell>
            <Cell label="Listed by">{lease.landlordName}</Cell>
          </dl>

          {/* Contact closes the row it belongs to, so a renter can never send an
              enquiry to a landlord other than the one whose terms they just read. */}
          <button
            type="button"
            onClick={() => onContact?.(lease)}
            className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 sm:w-[130px]"
          >
            Contact
          </button>
        </li>
      ))}
    </ul>
  );
}
