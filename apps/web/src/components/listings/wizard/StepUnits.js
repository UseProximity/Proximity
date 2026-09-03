"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
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

  // Preview of what each floor-plan card will expand into, so the landlord sees
  // the unit count before publishing rather than after.
  const parsedPerCard = w.units.map((u) => parseUnitNumbers(u.designator, u.unitNumbers));
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
      subtitle="One card per floor plan. A 12-unit building is usually just 2 or 3 of these."
    >
      <div className="space-y-4">
        {w.units.map((unit, i) => (
          <div key={i} className="relative rounded-xl border border-gray-200 p-4">
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
                    onClick={() => w.toggleUnitTerm(i, p.months)}
                  >
                    {p.label}
                  </Chip>
                ))}
                {(unit.leaseTermMonths || [])
                  .filter((m) => !LEASE_TERM_PRESETS.some((p) => p.months === m))
                  .map((m) => (
                    <Chip key={m} on onClick={() => w.toggleUnitTerm(i, m)}>
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
              <p className="mb-1.5 text-xs font-medium text-gray-600">
                Which units have this floor plan?
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={unit.designator ?? ""}
                  onChange={(e) => {
                    w.updateUnit(i, "designator", e.target.value);
                    if (e.target.value === "Whole") w.updateUnit(i, "unitNumbers", "");
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Type…</option>
                  {UNIT_DESIGNATORS.map((d) => (
                    <option key={d} value={d}>
                      {d === "Whole" ? "Whole property" : d}
                    </option>
                  ))}
                </select>

                {unit.designator !== "Whole" && (
                  <input
                    type="text"
                    value={unit.unitNumbers ?? ""}
                    onChange={(e) => w.updateUnit(i, "unitNumbers", e.target.value)}
                    disabled={!unit.designator}
                    placeholder="2W, 2E, 3W, 3E — or 1-4"
                    className={`${inputCls} w-64 disabled:bg-gray-100`}
                  />
                )}
              </div>

              <p className="mt-1.5 text-[11px] text-gray-500">
                {unit.designator === "Whole"
                  ? "One unit covering the whole property."
                  : parsedCounts[i] > 0
                  ? `Creates ${parsedCounts[i]} ${
                      parsedCounts[i] === 1 ? "unit" : "units"
                    }, each with its own lease: ${parsedUnitLists[i]}`
                  : "Separate with commas. Pick “Whole property” for a single-family house."}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
              <input
                type="text"
                value={unit.title ?? ""}
                onChange={(e) => w.updateUnit(i, "title", e.target.value)}
                placeholder='Floor plan name (optional), e.g. "The Loft"'
                className={`w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500${
                  w.importedFields.has(`u${i}:title`) ? importedInputCls : ""
                }`}
              />
            </div>
          </div>
        ))}
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
