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
 * in for the owning account, or the contact email of an imported lease with no
 * account, neither of which reaches the browser). There is no
 * selection state here: every card is independently actionable.
 *
 * The list is narrowed by the student's move-in month and lease length
 * (Wyatt, 2026-10-27), picked in the header and saved to their account so every
 * unit opens already narrowed (the pickers sit in the unit's name row, see
 * useUnitLeasePrefs). Offerings that fit lead, cheapest first; the
 * rest fold behind one link, closest first. When nothing fits, the closest
 * options show straight away under a note saying why, so a unit never looks
 * empty just because the dates are narrow. The fit rules live in
 * lib/listings/leaseFit.js. This replaced the old "Sort by" select.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { availabilityLabel } from "@/utils/availability";
import { useLeasePreferences } from "@/context/LeasePreferencesContext";
import { missReason, partitionLeases, prefsForUnit } from "@/lib/listings/leaseFit";

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
 * One card per landlord. The key is the server's; name and photo are taken
 * from whichever of their leases has them, which is all of them once the
 * landlord has saved a contact block, and the first one that does otherwise.
 * Leases arrive already ordered, so cards come out ordered by their best
 * lease and each card's leases keep that order.
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

// A long list (of landlords, or of one landlord's options) pushes the rest of
// the listing out of reach, so it opens on the first few and grows on request.
const PAGE = 5;

// How many lease rows open on their own across every landlord on a unit. Past
// this, landlords start folded so a busy unit still fits on a screen.
const OPEN_BUDGET = 10;

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

/*
 * The move-in month and lease length as they apply to one unit, plus the
 * setters the pickers call. Shared by the pickers (which sit in the unit's
 * name row, in ListingModalInfo) and this list, so the listing calls it once
 * and hands the result to both.
 *
 * A landlord previewing their draft as a student can try the pickers, but
 * nothing is saved: it is not their search. A saved month or length this unit
 * does not offer reads "Any" here (prefsForUnit).
 */
export function useUnitLeasePrefs(leases, preview = false) {
  const shared = useLeasePreferences();
  const [previewPrefs, setPreviewPrefs] = useState(shared.prefs);
  const saved = preview ? previewPrefs : shared.prefs;
  const prefs = useMemo(() => prefsForUnit(saved, leases), [saved, leases]);
  const setPrefs = preview ? (patch) => setPreviewPrefs((p) => ({ ...p, ...patch })) : shared.setPrefs;
  const clear = preview ? () => setPreviewPrefs({ moveIn: null, months: null }) : shared.clear;
  return { prefs, setPrefs, clear };
}

export default function LeaseOptions({ leases = [], loading = false, onContact, prefs = null }) {
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
    <LeaseList leases={leases} onContact={onContact} prefs={prefs ?? { moveIn: null, months: null }} />
  );
}

/*
 * Open landlords in order until the next one would take the rows on show past
 * OPEN_BUDGET; from there on every card starts folded. A card shows at most
 * PAGE rows, so that is what it spends. The first landlord always opens, so the
 * top option is never hidden.
 */
function withOpenBudget(groups) {
  let spent = 0;
  let budgetLeft = true;
  return groups.map((g, i) => {
    const cost = Math.min(g.leases.length, PAGE);
    if (i > 0 && spent + cost > OPEN_BUDGET) budgetLeft = false;
    const defaultOpen = budgetLeft;
    if (defaultOpen) spent += cost;
    return { ...g, defaultOpen };
  });
}

function LeaseList({ leases, onContact, prefs }) {
  const [showMisses, setShowMisses] = useState(false);
  // A different unit, or new dates, is a different list: fold the rest again.
  useEffect(() => setShowMisses(false), [leases, prefs.moveIn, prefs.months]);

  const { active, fits, misses, note } = useMemo(
    () => partitionLeases(leases, prefs),
    [leases, prefs]
  );
  const fitGroups = useMemo(() => withOpenBudget(groupByLandlord(fits)), [fits]);
  const missGroups = useMemo(() => withOpenBudget(groupByLandlord(misses)), [misses]);

  // Nothing fits: the closest options are the answer, so they show unasked.
  const missesOpen = !fits.length || showMisses;

  return (
    <div className="pt-1">
      {fits.length > 0 && (
        <GroupList
          groups={fitGroups}
          onContact={onContact}
          summaryNoun={active ? "fit" : null}
        />
      )}

      {misses.length > 0 && (
        <div className={fits.length ? "border-t border-gray-100" : ""}>
          {note && <p className="px-4 pt-3 text-xs text-amber-700">{note}</p>}
          {fits.length > 0 && (
            <div className="px-4 py-2.5">
              <button
                type="button"
                onClick={() => setShowMisses((v) => !v)}
                aria-expanded={showMisses}
                className="flex items-center gap-1 rounded text-xs font-semibold text-gray-600 transition hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                {showMisses ? "Hide" : "Show"} {misses.length}{" "}
                {misses.length === 1 ? "option that doesn't" : "options that don't"} fit your dates
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${showMisses ? "rotate-180" : ""}`}
                />
              </button>
            </div>
          )}
          {missesOpen && (
            <GroupList groups={missGroups} onContact={onContact} prefs={prefs} showReasons />
          )}
        </div>
      )}
    </div>
  );
}

// A list of landlord cards that opens on the first PAGE and grows on request.
function GroupList({ groups, onContact, summaryNoun = null, prefs = null, showReasons = false }) {
  const [shown, setShown] = useState(PAGE);

  // A different unit's tab is a different list: start it from the top.
  useEffect(() => setShown(PAGE), [groups]);

  const visible = groups.slice(0, shown);
  const remaining = groups.length - visible.length;

  return (
    <>
      <ul className="divide-y divide-gray-100">
        {visible.map((group) => (
          <LandlordCard
            key={group.key}
            group={group}
            onContact={onContact}
            summaryNoun={summaryNoun}
            prefs={prefs}
            showReasons={showReasons}
          />
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
    </>
  );
}

/*
 * One landlord on this unit: who they are, one Contact, and their options.
 *
 * The first landlords open with every option showing, so a renter can compare
 * terms without clicking in; once OPEN_BUDGET rows are on show, the rest start
 * folded to a one-line summary ("3 lease options from $900/mo") that opens on
 * request. Inside an open card, past the first PAGE options the rest grow on
 * request so one prolific landlord can't bury the others.
 *
 * Contact carries the landlord's best option (the closest fit to the student's
 * dates, then the cheapest) as the lease the enquiry is about. The chat is routed to the landlord either way,
 * and every option in the card reaches the same person.
 */
function LandlordCard({ group, onContact, summaryNoun = null, prefs = null, showReasons = false }) {
  const { landlordName, landlordImage, leases, defaultOpen } = group;
  const single = leases.length === 1;
  const [open, setOpen] = useState(defaultOpen);
  const [shown, setShown] = useState(PAGE);

  // A different unit's tab (or new dates) is a different list: start it from the top.
  useEffect(() => {
    setOpen(defaultOpen);
    setShown(PAGE);
  }, [leases, defaultOpen]);

  // A lone option that opened on its own has nothing to fold away.
  const toggleable = !(single && defaultOpen);

  const visible = leases.slice(0, shown);
  const remaining = leases.length - visible.length;

  const priced = leases.filter((l) => l.rent != null);
  const cheapest = priced.length
    ? priced.reduce((a, b) => (b.rent < a.rent ? b : a))
    : null;
  // "2 fit your dates" in the list of fits, "2 lease options" everywhere else.
  const count = summaryNoun
    ? `${leases.length} ${leases.length === 1 ? "fits" : "fit"} your dates`
    : single
    ? "1 lease option"
    : `${leases.length} lease options`;
  const summary = cheapest
    ? `${count}${single ? " · " : " from "}${money(cheapest.rent)}${
        cheapest.rentIsPerPerson ? "/person" : "/mo"
      }`
    : count;

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
          {toggleable ? (
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
          ) : (
            <p className="text-xs text-gray-500">{count}</p>
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

      {open && (
        /*
         * Several options read exactly like one: plain rows under the landlord,
         * split by a hairline, no box around them (Wyatt, 2026-10-27).
         */
        <ul className="mt-2 divide-y divide-gray-100">
          {visible.map((lease) => (
            <LeaseRow
              key={lease.id}
              lease={lease}
              reason={showReasons && prefs ? missReason(lease, prefs) : null}
            />
          ))}
        </ul>
      )}

      {open && leases.length > PAGE && (
        <div className="mt-1.5 flex items-center justify-center gap-4">
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
    </li>
  );
}

/*
 * One offering. The four columns are what a renter compares across offerings;
 * everything that is true of only this one (the landlord's own note, whether
 * they furnish it) lives behind the chevron. Who is offering it is said once,
 * on the card above, and so is how to reach them.
 */
function LeaseRow({ lease, reason = null }) {
  const [open, setOpen] = useState(false);
  const details = [
    lease.furnished == null
      ? null
      : { label: "Furnished", value: lease.furnished ? "Yes" : "No" },
  ].filter(Boolean);
  const hasDetails = !!lease.description || details.length > 0;

  return (
    <li className="py-2">
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
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg p-2 text-xs font-medium text-gray-500 transition hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            {/*
              * Spelled out because a bare chevron reads as decoration: the
              * landlord's note (Early Access, lease start) sat behind it unseen.
              */}
            {open ? "Hide Details" : "View Details"}
            <ChevronDown
              className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>

      {/* Why an offering outside the student's dates is outside them. */}
      {reason && <p className="mt-1 text-[11px] text-amber-700">{reason}</p>}

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
