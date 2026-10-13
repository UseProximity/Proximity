"use client";

/*
 * Lease options for ONE unit, shown directly under that unit's tab.
 *
 * A unit is a physical place; a lease is one landlord's offering on it. Several
 * landlords can offer the same unit, so a renter is choosing between people as
 * much as between terms. The list is therefore one card per landlord: who they
 * are and one Contact, with every option they offer on this unit inside the
 * card. A landlord with three leases here is one person to talk to, not three
 * buttons that all reach the same inbox.
 *
 * Who counts as "one landlord" is decided server-side (landlordKey, standing
 * in for the contact email, which never reaches the browser). There is no
 * selection state here: every card is independently actionable.
 */

import { useEffect, useMemo, useState } from "react";
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

/*
 * How a renter can order a unit's offerings. Each puts unknowns (no price, no
 * start date, no stated term) last: an offering that hasn't said is not the
 * cheapest, soonest or shortest. Ties keep the order the leases arrived in,
 * which is cheapest first.
 */
const lastIfNull = (fn) => (a, b) => {
  const x = fn(a);
  const y = fn(b);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return x < y ? -1 : x > y ? 1 : 0;
};

const SORTS = {
  price: { label: "Price", compare: lastIfNull((l) => l.rent) },
  availability: {
    label: "Availability",
    // A date already past reads as "Now", so it sorts as today.
    compare: lastIfNull((l) => {
      if (!l.availableFrom) return null;
      const day = String(l.availableFrom).slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      return day < today ? today : day;
    }),
  },
  duration: {
    label: "Lease length",
    // Shortest term on offer first; a lease flexible down to 4 months suits a
    // renter looking for 4, whatever else it also allows.
    compare: lastIfNull((l) => leaseTermList(l.leaseTermMonths)[0] ?? null),
  },
};

// A stable sort by `compare`, falling back to arrival order (cheapest first).
const stableSort = (items, compare) =>
  items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => compare(a.item, b.item) || a.i - b.i)
    .map(({ item }) => item);

/*
 * One card per landlord. The key is the server's; name and photo are taken
 * from whichever of their leases has them, which is all of them once the
 * landlord has saved a contact block, and the first one that does otherwise.
 */
function groupByLandlord(leases) {
  const groups = new Map();
  for (const lease of leases) {
    const key = lease.landlordKey ?? lease.ownerId ?? lease.id;
    let g = groups.get(key);
    if (!g) {
      g = { key, landlordName: null, landlordImage: null, leases: [] };
      groups.set(key, g);
    }
    g.leases.push(lease);
    if (!g.landlordName && lease.landlordName) g.landlordName = lease.landlordName;
    if (!g.landlordImage && lease.landlordImage) g.landlordImage = lease.landlordImage;
  }
  return [...groups.values()];
}

// A long list of landlords pushes the rest of the listing out of reach, so it
// opens on the first few and grows on request.
const PAGE = 5;

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

  return <LeaseList leases={leases} onContact={onContact} />;
}

function LeaseList({ leases, onContact }) {
  const [sortBy, setSortBy] = useState("price");
  const [shown, setShown] = useState(PAGE);

  // A different unit's tab is a different list: start it from the top.
  useEffect(() => setShown(PAGE), [leases]);

  /*
   * Sort inside each card, then sort the cards by their best option under the
   * same rule: on "Price" the landlord with the cheapest lease comes first, and
   * their cheapest lease heads their card.
   */
  const groups = useMemo(() => {
    const { compare } = SORTS[sortBy];
    const sortedWithin = groupByLandlord(leases).map((g) => ({
      ...g,
      leases: stableSort(g.leases, compare),
    }));
    return stableSort(sortedWithin, (a, b) => compare(a.leases[0], b.leases[0]));
  }, [leases, sortBy]);
  const visible = groups.slice(0, shown);
  const remaining = groups.length - visible.length;

  return (
    <div>
      {leases.length > 1 && (
        <div className="flex items-center justify-between gap-3 px-4 pt-3 text-xs text-gray-500">
          <span>
            {leases.length} lease options
            {groups.length > 1 && ` from ${groups.length} landlords`}
          </span>
          <label className="flex items-center gap-1.5">
            <span>Sort by</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs font-medium text-gray-700 focus:border-red-400 focus:outline-none"
            >
              {Object.entries(SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <ul className="divide-y divide-gray-100">
        {visible.map((group) => (
          <LandlordCard key={group.key} group={group} onContact={onContact} />
        ))}
      </ul>

      {groups.length > PAGE && (
        <div className="flex items-center justify-center gap-4 border-t border-gray-100 px-4 py-2.5">
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Show {Math.min(PAGE, remaining)} more
              <span className="font-normal text-gray-400"> ({remaining} left)</span>
            </button>
          )}
          {shown > PAGE && (
            <button
              type="button"
              onClick={() => setShown(PAGE)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-50 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/*
 * One landlord on this unit: who they are, one Contact, and their options.
 *
 * With a single option there is nothing to fold, so it sits open under the
 * name with no toggle. With several, the card opens on a one-line summary
 * ("3 lease options from $900/mo") and the terms unfold on request, so a unit
 * with four landlords still fits on a screen.
 *
 * Contact carries the landlord's best option under the current sort as the
 * lease the enquiry is about. The chat is routed to the landlord either way,
 * and every option in the card reaches the same person.
 */
function LandlordCard({ group, onContact }) {
  const { landlordName, landlordImage, leases } = group;
  const single = leases.length === 1;
  const [open, setOpen] = useState(false);
  const expanded = single || open;

  const priced = leases.filter((l) => l.rent != null);
  const cheapest = priced.length
    ? priced.reduce((a, b) => (b.rent < a.rent ? b : a))
    : null;
  const summary = cheapest
    ? `${leases.length} lease options from ${money(cheapest.rent)}${
        cheapest.rentIsPerPerson ? "/person" : "/mo"
      }`
    : `${leases.length} lease options`;

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <img
          src={landlordImage?.trim() ? landlordImage : "/default-icons/default-user.png"}
          alt=""
          className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-gray-100"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">
            {landlordName ?? "Landlord"}
          </p>
          {single ? (
            <p className="text-xs text-gray-500">1 lease option</p>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="flex items-center gap-0.5 rounded text-left text-xs text-gray-500 transition hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <span className="truncate">{summary}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onContact?.(leases[0])}
          className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 sm:w-[130px]"
        >
          Contact
        </button>
      </div>

      {expanded && (
        <ul
          className={`mt-3 divide-y divide-gray-100 ${
            single ? "" : "rounded-lg border border-gray-100 bg-gray-50/60"
          }`}
        >
          {leases.map((lease) => (
            <LeaseRow key={lease.id} lease={lease} inset={!single} />
          ))}
        </ul>
      )}
    </li>
  );
}

/*
 * One offering. The four columns are what a renter compares across offerings;
 * everything that is true of only this one (the landlord's own note, whether
 * they furnish it) lives behind the chevron. Who is offering it is said once,
 * on the card above, and so is how to reach them.
 */
function LeaseRow({ lease, inset = false }) {
  const [open, setOpen] = useState(false);
  const details = [
    lease.furnished == null
      ? null
      : { label: "Furnished", value: lease.furnished ? "Yes" : "No" },
  ].filter(Boolean);
  const hasDetails = !!lease.description || details.length > 0;

  return (
    <li className={inset ? "px-3 py-2.5" : "py-1"}>
      <div className="flex items-center gap-3">
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
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
        </dl>

        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Hide details" : "Show details"}
            className="shrink-0 rounded-lg p-2 text-gray-400 transition hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>

      {open && hasDetails && (
        <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2.5">
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
