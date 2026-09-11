"use client";

// Step 2 of the address -> unit -> lease create flow.
//
// When the entered address already has a property, this renders that property's
// existing units so the user can attach their lease to one instead of creating a
// duplicate listing. When the address is new, it collapses to a single "identify
// the unit" form.
//
// The sublease rule is enforced by a database trigger; it is mirrored here only
// so an ineligible unit is visibly disabled with a reason rather than failing on
// submit. A unit that already has a live lease cannot take a sublease, because a
// sublease means someone is already living there under that lease.

export const UNIT_DESIGNATORS = ["Apt", "Unit", "Suite", "Floor", "Room", "Whole"];

// Mirrors listing_units_number_check: 'Whole' covers the entire property and
// carries no number; every other designator is meaningless without one.
export function isUnitIdentityValid(unit) {
  if (!unit?.designator) return false;
  if (unit.designator === "Whole") return true;
  return !!String(unit.number ?? "").trim();
}

function unitSummary(unit) {
  const beds = unit.bedrooms === 0 ? "Studio" : `${unit.bedrooms} bed`;
  return `${beds} · ${unit.bathrooms} bath${unit.area ? ` · ${unit.area} sq ft` : ""}`;
}

export default function PropertyUnitPicker({
  loading = false,
  property = null,
  leaseType = "standard",
  selection,
  onSelectionChange,
  disabled = false,
}) {
  const isSublease = String(leaseType).toLowerCase() === "sublease";
  const units = property?.units ?? [];

  const setMode = (mode) => onSelectionChange({ ...selection, mode, unitId: null });
  const patch = (fields) => onSelectionChange({ ...selection, ...fields });

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-red-500" />
        Checking this address…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {property && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-sm font-medium text-amber-900">
            There&rsquo;s already a listing at this address
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            {property.ownerCount > 1
              ? `${property.ownerCount} people currently list here.`
              : "Your lease will be added to this property instead of creating a second one."}
            {property.viewerHasLease && " You already have a lease here."}
          </p>
        </div>
      )}

      {property && units.length > 0 && (
        <fieldset disabled={disabled} className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-gray-700">
            Which unit is this lease for?
          </legend>

          {units.map((unit) => {
            const blocked = isSublease && !unit.canAddSublease;
            const checked = selection?.mode === "existing" && selection.unitId === unit.id;

            return (
              <label
                key={unit.id}
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
                  blocked
                    ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60"
                    : checked
                    ? "cursor-pointer border-red-500 bg-red-50"
                    : "cursor-pointer border-gray-300 hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="unit-selection"
                  className="mt-0.5 accent-red-500"
                  disabled={blocked}
                  checked={checked}
                  onChange={() => patch({ mode: "existing", unitId: unit.id })}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">
                    {unit.label ?? "Unlabelled unit"}
                    {!unit.identified && (
                      <span className="ml-1.5 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                        needs a label
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-gray-500">{unitSummary(unit)}</span>

                  {blocked ? (
                    <span className="mt-1 block text-xs font-medium text-amber-700">
                      Can&rsquo;t sublease this unit — it already has a live lease.
                    </span>
                  ) : unit.liveLeaseCount > 0 ? (
                    <span className="mt-1 block text-xs text-gray-500">
                      {unit.liveLeaseCount} active{" "}
                      {unit.liveLeaseCount === 1 ? "listing" : "listings"} on this unit
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}

          <label
            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
              selection?.mode === "new"
                ? "cursor-pointer border-red-500 bg-red-50"
                : "cursor-pointer border-gray-300 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name="unit-selection"
              className="mt-0.5 accent-red-500"
              checked={selection?.mode === "new"}
              onChange={() => setMode("new")}
            />
            <span className="text-sm font-medium text-gray-900">
              None of these — add a new unit
            </span>
          </label>
        </fieldset>
      )}

      {property && units.length > 0 && units.every((u) => !u.identified) && (
        <p className="text-xs text-gray-500">
          These units were added before unit numbers were collected, so they can&rsquo;t be
          told apart yet. If none of them is clearly yours, add a new unit.
        </p>
      )}

      {property && selection?.mode === "new" && (
        <p className="text-xs text-gray-500">
          Add the new unit (and its lease) in the Units section below.
        </p>
      )}
    </div>
  );
}
