"use client";

import { useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import {
  LEASE_TERM_PRESETS,
  UNIT_DESIGNATORS,
  parseUnitNumbers,
} from "@/components/listings/listingFormOptions";
import {
  StepFrame,
  Chip,
  Stepper,
  inputCls,
  importedInputCls,
} from "@/components/listings/wizard/wizardShared";

/*
 * Screen 3: the units — the lease facts landlords care about most, asked
 * early (rent, beds/baths, terms). One card per floor-plan type; steppers for
 * counts, chips for lease terms, typing only for the rent number.
 */
export default function StepUnits({ w }) {
  const [customTerm, setCustomTerm] = useState({});

  /*
   * A big building arrives folded up.
   *
   * One card per floor plan is right for the common case, and One Hundred Above
   * the Park is not it: thirty-six plans came in at roughly eight hundred pixels
   * a card, which is most of a morning's scrolling before you reach the button
   * at the bottom. Above a handful, each plan shows as one line saying what it
   * is, and opens when the landlord wants to change something. Nothing is
   * hidden and nothing is dropped; a five-plan building still looks exactly as
   * it did, so a hand-typed listing never meets this at all.
   */
  const manyPlans = w.units.length > 5;
  const [opened, setOpened] = useState(() => new Set());
  const isOpen = (i) => !manyPlans || opened.has(i);
  const allOpen = manyPlans && opened.size === w.units.length;
  const toggleOpen = (i) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  // Said in the header rather than repeated down the page as a red warning on
  // every row: a column of identical alarms is not information.
  const waitlistCount = (w.units ?? []).filter((u) => u.available === false).length;
  const needTerms = (w.units ?? []).filter(
    (u) => u.available !== false && !(u.leaseTermMonths ?? []).length
  ).length;

  const planLabel = (u) => {
    const beds = Number(u.bedrooms) === 0 ? "Studio" : `${u.bedrooms || "?"} bed`;
    return u.bathrooms ? `${beds} · ${u.bathrooms} bath` : beds;
  };

  // Preview of what each floor-plan card will expand into, so the landlord sees
  // the unit count before publishing rather than after.
  const parsedPerCard = w.units.map((u) => parseUnitNumbers(u.designator, u.unitNumbers));

  /*
   * Lease terms, set once.
   *
   * Nearly every building offers the same terms on every floor plan, so ticking
   * "12-Month" on each of five cards is five times the work for one fact. Two
   * ways to avoid it, and deliberately not a silent one:
   *
   *  - While no card has terms of its own, the first card you set mirrors onto
   *    the rest, and says so with an Undo. Keep editing that card and the rest
   *    keep following. Touch any other card and mirroring stops for good, so
   *    your own per-plan choices are never overwritten.
   *  - "Apply to all floor plans" on any card, any time, for the case where the
   *    terms genuinely differ and you want to reset them to match.
   *
   * The pattern is the one bulk actions use elsewhere: do the obvious thing,
   * show that you did it, make it one click to take back.
   */
  const [mirrorSrc, setMirrorSrc] = useState(null);
  const [mirrorNote, setMirrorNote] = useState(null); // {count} after a mirror

  const termsOf = (u) => (Array.isArray(u.leaseTermMonths) ? u.leaseTermMonths : []);
  const othersUntouched = (i) =>
    w.units.length > 1 && w.units.every((u, idx) => idx === i || termsOf(u).length === 0);

  const nextTerms = (cur, months) =>
    cur.includes(months)
      ? cur.filter((m) => m !== months)
      : [...cur, months].sort((a, b) => a - b);

  const changeTerm = (i, months) => {
    const after = nextTerms(termsOf(w.units[i]), months);
    const mirroring = mirrorSrc === i || (mirrorSrc === null && othersUntouched(i));
    if (!mirroring) {
      // A card edited on its own ends mirroring: their choices win.
      if (mirrorSrc !== null && mirrorSrc !== i) setMirrorSrc(null);
      setMirrorNote(null);
      w.toggleUnitTerm(i, months);
      return;
    }
    w.mirrorTerms(after);
    setMirrorSrc(i);
    setMirrorNote(after.length ? { count: w.units.length - 1 } : null);
  };

  const applyToAll = (i) => {
    w.mirrorTerms(termsOf(w.units[i]));
    setMirrorSrc(i);
    setMirrorNote({ count: w.units.length - 1 });
  };

  const undoMirror = () => {
    w.clearTermsExcept(mirrorSrc);
    setMirrorSrc(null);
    setMirrorNote(null);
  };
  const parsedCounts = parsedPerCard.map((list) => list.length);
  const parsedUnitLists = parsedPerCard.map((list) =>
    list
      .slice(0, 6)
      .map((n) => (n == null ? "whole property" : n))
      .join(", ") + (list.length > 6 ? `, +${list.length - 6} more` : "")
  );
  const totalUnits = parsedCounts.reduce((sum, n) => sum + n, 0);

  const addCustom = (i) => {
    const n = Number(customTerm[i]);
    if (!Number.isFinite(n) || n <= 0) return;
    if (!(w.units[i].leaseTermMonths || []).includes(n)) w.toggleUnitTerm(i, n);
    setCustomTerm((p) => ({ ...p, [i]: "" }));
  };

  return (
    <StepFrame
      title="Units and rent"
      subtitle={
        manyPlans
          ? "One row per floor plan, closed to keep the list short. Open any one to change it."
          : "One card per floor plan. A 12-unit building is usually just 2 or 3 of these."
      }
    >
      <div className="space-y-4">
        {manyPlans && (
          /*
           * What came in, what it means, and the one thing left to do.
           *
           * A thirty-four plan building arrived with twenty-three rows reading
           * "needs a lease length" in red and nothing saying why: the site
           * publishes its lease lengths behind a login, so there was nothing to
           * read, and the landlord was left with a column of warnings and no
           * way to answer them without opening twenty-three cards. The waitlist
           * rows needed saying out loud too — a badge tells you what a plan IS,
           * not what is about to happen to it.
           */
          <div className="space-y-3 rounded-lg bg-gray-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-600">
                {w.units.length} floor plans came in from your website. Open any
                one to check it or change it.
              </p>
              <button
                type="button"
                onClick={() =>
                  setOpened(allOpen ? new Set() : new Set(w.units.map((_, i) => i)))
                }
                className="shrink-0 text-sm font-medium text-red-600 hover:text-red-700"
              >
                {allOpen ? "Collapse all" : "Open all"}
              </button>
            </div>

            {waitlistCount > 0 && (
              <p className="text-xs text-gray-600">
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                  {waitlistCount} waitlist only
                </span>{" "}
                — your website shows these with no price, so they are saved with
                your listing but not offered to students. Remove one with the ×
                if you would rather not keep it.
              </p>
            )}

            {needTerms > 1 && (
              <div className="border-t border-gray-200 pt-2.5">
                <p className="text-xs text-gray-700">
                  {needTerms === w.units.length
                    ? "Your website doesn't publish its lease lengths, so pick them here."
                    : `${needTerms} floor plans still need a lease length.`}{" "}
                  <span className="text-gray-500">
                    Picking one sets it on every floor plan; you can change any of
                    them afterwards.
                  </span>
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {LEASE_TERM_PRESETS.map((p) => (
                    <Chip
                      key={p.label}
                      on={w.units.every((u) => (u.leaseTermMonths || []).includes(p.months))}
                      onClick={() => w.mirrorTerms([p.months])}
                    >
                      {p.label}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {w.units.map((unit, i) => {
          const apartments = parsedPerCard[i].filter(Boolean);
          if (!isOpen(i)) {
            const terms = termsOf(unit);
            return (
              <div
                key={i}
                className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-3"
              >
                <button
                  type="button"
                  onClick={() => toggleOpen(i)}
                  className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-left"
                >
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="text-sm font-medium text-gray-900">
                    {unit.title || `Floor plan ${i + 1}`}
                  </span>
                  <span className="text-sm text-gray-500">{planLabel(unit)}</span>
                  {unit.rent ? (
                    <span className="text-sm text-gray-500">${unit.rent}/mo</span>
                  ) : null}
                  {apartments.length ? (
                    <span className="text-sm text-gray-500">
                      {apartments.length}{" "}
                      {apartments.length === 1 ? "apartment" : "apartments"}
                    </span>
                  ) : null}
                  {terms.length ? (
                    <span className="text-xs text-gray-400">
                      {terms.map((m) => `${m} mo`).join(", ")}
                    </span>
                  ) : null}
                  {/* Whatever still needs a decision says so on the closed row,
                      so nothing that blocks publishing hides behind a chevron. */}
                  {unit.available === false && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      Waitlist only
                    </span>
                  )}
                  {[
                    unit.available === false || terms.length || needTerms > 1
                      ? null
                      : "needs a lease length",
                    unit.designator || unit.numbersUnknown ? null : "needs a unit type",
                    unit.available === false || unit.rent ? null : "needs a rent",
                  ]
                    .filter(Boolean)
                    .map((what) => (
                      <span key={what} className="text-xs font-medium text-red-600">
                        {what}
                      </span>
                    ))}
                </button>
                {w.units.length > 1 && (
                  <button
                    type="button"
                    onClick={() => w.removeUnit(i)}
                    aria-label="Remove floor plan"
                    className="shrink-0 text-gray-300 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          }
          return (
          <div key={i} className="relative rounded-xl border border-gray-200 p-4">
            {manyPlans && (
              <button
                type="button"
                onClick={() => toggleOpen(i)}
                className="absolute right-10 top-3 text-xs font-medium text-gray-400 hover:text-gray-700"
              >
                Collapse
              </button>
            )}
            {w.units.length > 1 && (
              <button
                type="button"
                onClick={() => w.removeUnit(i)}
                aria-label="Remove unit"
                className="absolute right-3 top-3 text-gray-300 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-gray-600">Bedrooms</p>
                <Stepper
                  value={unit.bedrooms}
                  min={0}
                  onChange={(v) => w.updateUnit(i, "bedrooms", v)}
                />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-gray-600">Bathrooms</p>
                <Stepper
                  value={unit.bathrooms}
                  min={0}
                  step={0.5}
                  onChange={(v) => w.updateUnit(i, "bathrooms", v)}
                />
              </div>
              <div className="w-36">
                <p className="mb-1.5 text-xs font-medium text-gray-600">
                  Rent, whole unit <span className="text-gray-400">($/mo)</span>
                </p>
                <input
                  type="number"
                  min="0"
                  value={unit.rent}
                  onChange={(e) => w.updateUnit(i, "rent", e.target.value)}
                  placeholder="e.g. 1400"
                  className={`${inputCls}${
                    w.importedFields.has(`u${i}:rent`) ? importedInputCls : ""
                  }`}
                />
              </div>
              <div className="w-32">
                <p className="mb-1.5 text-xs font-medium text-gray-600">
                  Sq ft <span className="text-gray-400">(optional)</span>
                </p>
                <input
                  type="number"
                  min="0"
                  value={unit.area}
                  onChange={(e) => w.updateUnit(i, "area", e.target.value)}
                  className={`${inputCls}${
                    w.importedFields.has(`u${i}:area`) ? importedInputCls : ""
                  }`}
                />
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-1.5 text-xs font-medium text-gray-600">
                Lease terms offered
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {LEASE_TERM_PRESETS.map((p) => (
                  <Chip
                    key={p.label}
                    on={(unit.leaseTermMonths || []).includes(p.months)}
                    onClick={() => changeTerm(i, p.months)}
                  >
                    {p.label}
                  </Chip>
                ))}
                {(unit.leaseTermMonths || [])
                  .filter((m) => !LEASE_TERM_PRESETS.some((p) => p.months === m))
                  .map((m) => (
                    <Chip key={m} on onClick={() => changeTerm(i, m)}>
                      {m}-Month ×
                    </Chip>
                  ))}
                <input
                  type="number"
                  min="1"
                  value={customTerm[i] ?? ""}
                  onChange={(e) => setCustomTerm((p) => ({ ...p, [i]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustom(i);
                    }
                  }}
                  placeholder="# months"
                  className="w-24 rounded-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                {(customTerm[i] ?? "") !== "" ? (
                  <button
                    type="button"
                    onClick={() => addCustom(i)}
                    className="rounded-full bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
                  >
                    Add ↵
                  </button>
                ) : (
                  <span className="text-[11px] text-gray-400">
                    type a number, press Enter
                  </span>
                )}
              </div>

              {/* Said out loud, and undoable. A bulk change nobody saw happen is
                  the thing that makes people distrust a form. */}
              {mirrorSrc === i && mirrorNote && (
                <p className="mt-1.5 text-[11px] text-gray-600">
                  Also applied to your other {mirrorNote.count} floor plan
                  {mirrorNote.count === 1 ? "" : "s"}.{" "}
                  <button
                    type="button"
                    onClick={undoMirror}
                    className="font-medium text-red-600 hover:underline"
                  >
                    Undo
                  </button>
                </p>
              )}

              {w.units.length > 1 && mirrorSrc !== i && termsOf(unit).length > 0 && (
                <button
                  type="button"
                  onClick={() => applyToAll(i)}
                  className="mt-1.5 text-[11px] font-medium text-red-600 hover:underline"
                >
                  Apply these terms to all {w.units.length} floor plans
                </button>
              )}
            </div>

            {/* Which physical units share this floor plan. Each number becomes
                its own unit + lease, which is what lets another landlord at the
                same property attach to the right one later. Hidden when
                attaching — that unit's identity already exists. */}
            <div
              className={`mt-4 rounded-lg bg-gray-50 p-3${
                w.attachingToExistingUnit ? " hidden" : ""
              }`}
            >
              <p className="text-xs font-medium text-gray-700">
                Which apartments have this floor plan?
              </p>
              <p className="mb-2 text-[11px] text-gray-500">
                List them however you refer to them. Each one becomes its own
                unit with its own lease, so students can enquire about a
                specific apartment.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-500">
                    Word in front
                  </span>
                  <select
                    value={unit.designator ?? ""}
                    onChange={(e) => {
                      w.updateUnit(i, "designator", e.target.value);
                      if (e.target.value === "Whole") w.updateUnit(i, "unitNumbers", "");
                    }}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">Choose…</option>
                    {UNIT_DESIGNATORS.map((d) => (
                      <option key={d} value={d}>
                        {d === "Whole" ? "Whole property (no unit numbers)" : d}
                      </option>
                    ))}
                  </select>
                </label>

                {unit.designator !== "Whole" && (
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-gray-500">
                      Their numbers or names
                    </span>
                    <input
                      type="text"
                      value={unit.unitNumbers ?? ""}
                      onChange={(e) => w.updateUnit(i, "unitNumbers", e.target.value)}
                      disabled={!unit.designator}
                      placeholder="2W, 3E, 4W — or Madrid, Lisbon — or 1-4"
                      className={`${inputCls} w-72 disabled:bg-gray-100`}
                    />
                  </label>
                )}
              </div>

              <p className="mt-1.5 text-[11px] text-gray-500">
                {unit.designator === "Whole"
                  ? "One unit covering the whole property. Right for a single-family house."
                  : parsedCounts[i] > 0
                  ? `Creates ${parsedCounts[i]} ${
                      parsedCounts[i] === 1 ? "unit" : "units"
                    }, each with its own lease: ${parsedUnitLists[i]}`
                  : unit.designator
                  ? "Separate with commas. Numbers, letters or names all work. A range like 1-4 fills itself in."
                  : "The word in front is only what students see before the number, like “Apt 2W”. Pick “Whole property” for a house."}
              </p>

              {/*
                One place for dates, not two.

                This used to show a date for the whole floor plan AND a date
                beside each apartment, so a plan with a single apartment asked
                the same question twice in two different sizes. The per-apartment
                row is the truthful one, because a building releases apartment by
                apartment, so it is the only one shown once apartments are named.
                A floor plan with no apartment numbers (a house, "whole
                property") still gets the single date.
              */}
              <div className="mt-3 border-t border-gray-200 pt-3">
                {apartments.length > 0 ? (
                  <>
                    <p className="text-[11px] font-medium text-gray-700">
                      When is each apartment available, and what does it rent for?
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      Leave a date blank if it is available now. Leave a rent blank
                      to use the rent above.
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {apartments.map((number) => {
                        const when = unit.unitAvailability?.[number] ?? "";
                        return (
                          <div key={number} className="flex flex-wrap items-center gap-2">
                            <span className="w-24 shrink-0 truncate text-xs font-medium text-gray-700">
                              {unit.designator && unit.designator !== "Whole"
                                ? `${unit.designator} ${number}`
                                : number}
                            </span>
                            <input
                              type="date"
                              aria-label={`Available from for ${number}`}
                              value={when}
                              onChange={(e) =>
                                w.updateUnit(i, "unitAvailability", {
                                  ...(unit.unitAvailability ?? {}),
                                  [number]: e.target.value,
                                })
                              }
                              className="w-40 shrink-0 rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-red-500"
                            />
                            {/*
                              Blank is a real answer, so it says so out loud
                              rather than leaving an empty box to read. Once a
                              date is set, the same slot becomes the way back:
                              clearing a native date input means finding a tiny
                              cross inside it, which is not a thing to ask of
                              someone who mistyped a year.
                            */}
                            {when ? (
                              <button
                                type="button"
                                onClick={() =>
                                  w.updateUnit(i, "unitAvailability", {
                                    ...(unit.unitAvailability ?? {}),
                                    [number]: "",
                                  })
                                }
                                title="This apartment is available now"
                                className="shrink-0 rounded-full border border-gray-300 px-2 py-0.5 text-[10px] font-medium text-gray-600 transition-colors hover:border-green-400 hover:bg-green-50 hover:text-green-800"
                              >
                                Available now instead
                              </button>
                            ) : (
                              <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-800">
                                Available now
                              </span>
                            )}
                            <input
                              type="number"
                              min="0"
                              aria-label={`Rent for ${number}`}
                              value={unit.unitRents?.[number] ?? ""}
                              onChange={(e) =>
                                w.updateUnit(i, "unitRents", {
                                  ...(unit.unitRents ?? {}),
                                  [number]: e.target.value,
                                })
                              }
                              placeholder="same rent"
                              className="w-28 shrink-0 rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-red-500"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div>
                    <span className="mb-1 block text-[11px] font-medium text-gray-700">
                      Available from
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        aria-label="Available from"
                        value={unit.availableFrom ?? ""}
                        onChange={(e) => w.updateUnit(i, "availableFrom", e.target.value)}
                        className={`w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500${
                          w.importedFields.has(`u${i}:availableFrom`) ? importedInputCls : ""
                        }`}
                      />
                      {/*
                        The same green pill the apartment rows get. An empty box
                        reads as work still to do, and a floor plan with a single
                        apartment was the one case that got the empty box with no
                        pill beside it, so it looked like the one date the
                        landlord still had to fill in. Blank is an answer here
                        too, and it says so.
                      */}
                      {unit.availableFrom ? (
                        <button
                          type="button"
                          onClick={() => w.updateUnit(i, "availableFrom", "")}
                          title="This one is available now"
                          className="shrink-0 rounded-full border border-gray-300 px-2 py-0.5 text-[10px] font-medium text-gray-600 transition-colors hover:border-green-400 hover:bg-green-50 hover:text-green-800"
                        >
                          Available now instead
                        </button>
                      ) : (
                        <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-800">
                          Available now
                        </span>
                      )}
                    </div>
                    <span className="mt-1 block text-[11px] text-gray-500">
                      Leave blank if it is available now.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* A second price for a different lease length. Most landlords
                have one price and never open this; a revenue-managed building
                quotes nine. Each row becomes its own offering on the listing. */}
            <div className="mt-3">
              {(unit.extraLeases ?? []).map((extra, k) => (
                <div
                  key={k}
                  className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2.5"
                >
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-gray-600">
                      Also offered at ($/mo)
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={extra.rent ?? ""}
                      onChange={(e) => w.updateExtraLease(i, k, { rent: e.target.value })}
                      placeholder="e.g. 1725"
                      className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <span className="mb-1 block text-[11px] font-medium text-gray-600">
                      For these lease lengths
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {LEASE_TERM_PRESETS.map((pr) => (
                        <Chip
                          key={pr.label}
                          on={(extra.leaseTermMonths ?? []).includes(pr.months)}
                          onClick={() => w.toggleExtraLeaseTerm(i, k, pr.months)}
                        >
                          {pr.label}
                        </Chip>
                      ))}
                      {(extra.leaseTermMonths ?? [])
                        .filter((m) => !LEASE_TERM_PRESETS.some((pr) => pr.months === m))
                        .map((m) => (
                          <Chip key={m} on onClick={() => w.toggleExtraLeaseTerm(i, k, m)}>
                            {m}-Month ×
                          </Chip>
                        ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => w.removeExtraLease(i, k)}
                    className="shrink-0 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-red-600"
                    aria-label="Remove this price"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => w.addExtraLease(i)}
                className="mt-2 text-[11px] font-medium text-red-600 hover:underline"
              >
                + Add another price for a different lease length
              </button>
            </div>

            <div className="mt-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">
                  Floor plan name (optional)
                </span>
                <input
                  type="text"
                  value={unit.title ?? ""}
                  onChange={(e) => w.updateUnit(i, "title", e.target.value)}
                  placeholder='e.g. "The Loft"'
                  className={`w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500${
                    w.importedFields.has(`u${i}:title`) ? importedInputCls : ""
                  }`}
                />
              </label>
              <p className="mt-1 text-[11px] text-gray-500">
                Only if you market this layout under a name. Individual apartment
                numbers go in the box above, not here.
              </p>
            </div>
          </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {!w.attachingToExistingUnit && (
          <button
            type="button"
            onClick={w.addUnit}
            className="flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700"
          >
            <Plus className="h-4 w-4" /> Add another floor plan
          </button>
        )}
        {totalUnits > 0 && !w.attachingToExistingUnit && (
          <p className="text-xs text-gray-500">
            {totalUnits} {totalUnits === 1 ? "unit" : "units"} across{" "}
            {w.units.length} {w.units.length === 1 ? "floor plan" : "floor plans"}
          </p>
        )}
      </div>
    </StepFrame>
  );
}
