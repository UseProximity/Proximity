"use client";

/*
 * Step two: which apartment.
 *
 * Only reached when the address matched a property we already hold. Picking an
 * existing unit skips unit creation entirely and drops straight to the lease —
 * the unit's beds, baths and area are already recorded, and re-asking would
 * invite a second copy of a unit that exists.
 *
 * A unit that is already being let is shown with its offerings rather than
 * hidden. Several landlords can offer the same apartment, and a subletter is
 * specifically looking for the one that already has a lease on it.
 */

import { Building2, Plus } from "lucide-react";

function unitLabel(u) {
  if (u.label) return u.label;
  const beds = (u.bedrooms ?? 0) === 0 ? "Studio" : `${u.bedrooms ?? "?"} bed`;
  return `${beds} · ${u.bathrooms ?? "?"} bath`;
}

export default function UnitStep({ property, units, selectedUnitId, onSelectUnit, onAddNew }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          We already have <strong>{property?.title || property?.address}</strong>.
          Pick the apartment you&apos;re listing, or add one that isn&apos;t here yet.
        </p>
      </div>

      <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
        {units.map((u) => {
          const selected = selectedUnitId === u.id;
          return (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => onSelectUnit(u)}
                className={`flex w-full items-center gap-4 px-4 py-3 text-left transition ${
                  selected ? "bg-red-50" : "hover:bg-gray-50"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">{unitLabel(u)}</span>
                  <span className="block text-xs text-gray-500">
                    {(u.bedrooms ?? 0) === 0 ? "Studio" : `${u.bedrooms} bed`} ·{" "}
                    {u.bathrooms ?? "?"} bath
                    {u.area ? ` · ${Number(u.area).toLocaleString()} sq ft` : ""}
                    {!u.identified && " · no unit number on file"}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  {u.liveLeaseCount > 0 ? (
                    <>
                      <span className="block font-medium text-gray-700">
                        {u.liveLeaseCount} {u.liveLeaseCount === 1 ? "listing" : "listings"}
                      </span>
                      <span className="block text-gray-400">
                        {u.leases.some((l) => l.isMine) ? "including yours" : "by other landlords"}
                      </span>
                    </>
                  ) : (
                    <span className="text-gray-400">Nothing listed</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onAddNew}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 py-3 text-sm font-medium text-gray-600 transition hover:border-red-300 hover:text-red-600"
      >
        <Plus className="h-4 w-4" />
        My apartment isn&apos;t listed here
      </button>
      <p className="text-xs text-gray-400">
        Adding a unit puts it on this property&apos;s record. The property owner can remove it.
      </p>
    </div>
  );
}
