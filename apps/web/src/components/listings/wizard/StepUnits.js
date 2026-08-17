"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { LEASE_TERM_PRESETS } from "@proximity/shared";
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
              <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={unit.available !== false}
                  onChange={(e) => w.updateUnit(i, "available", e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                Currently available
              </label>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={w.addUnit}
        className="mt-4 flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700"
      >
        <Plus className="h-4 w-4" /> Add another floor plan
      </button>
    </StepFrame>
  );
}
