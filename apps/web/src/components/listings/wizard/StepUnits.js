"use client";

import { useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  FileText,
  ImagePlus,
  Loader2,
  Plus,
  Upload,
  X,
} from "lucide-react";
import LeaseTermPicker from "@/components/listings/LeaseTermPicker";
import {
  StepFrame,
  Stepper,
  inputCls,
  importedInputCls,
} from "@/components/listings/wizard/wizardShared";

/*
 * Screen 3: the units, and the leases under each.
 *
 * Same shape as the manual flow and the listing page: a property holds units,
 * a unit holds leases. A unit here is one floor plan (its layout, size and
 * diagram). A lease is one option a student could take on it: a rent, when it
 * opens up, and the lease lengths written at that rent. Apartments on the same
 * plan at the same rent are one lease, so a unit lists only the options that
 * actually differ.
 */

const money = (n) => `$${Number(n).toLocaleString()}`;

const planLabel = (u) => {
  const beds = u.bedrooms === "" ? "? bed" : Number(u.bedrooms) === 0 ? "Studio" : `${u.bedrooms} bed`;
  const layout = u.bathrooms === "" ? beds : `${beds} · ${u.bathrooms} bath`;
  return u.area !== "" && u.area != null ? `${layout} · ${Number(u.area).toLocaleString()} sq ft` : layout;
};

const rentRange = (leases) => {
  const rents = leases.map((l) => Number(l.rent)).filter((r) => r > 0);
  if (!rents.length) return null;
  const lo = Math.min(...rents);
  const hi = Math.max(...rents);
  return lo === hi ? `${money(lo)}/mo` : `${money(lo)} to ${money(hi)}/mo`;
};

/*
 * The unit's floor plan: upload one, see it, replace or remove it. An imported
 * diagram lands in the same slot, so the landlord can swap a blurry one out.
 */
function FloorPlanSlot({ url, uploading, error, onPick, onRemove }) {
  const isPdf = /\.pdf($|\?)/i.test(url ?? "");
  const input = (
    <input
      type="file"
      accept="image/*,application/pdf"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onPick(f);
        e.target.value = "";
      }}
    />
  );
  return (
    <div className="shrink-0">
      <span className="block text-xs font-semibold text-gray-700">Floor plan</span>
      <span className="mb-1.5 block text-[11px] text-gray-400">The layout drawing · image or PDF</span>
      {uploading ? (
        <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : url ? (
        <div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title="Open the floor plan"
            className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white"
          >
            {isPdf ? (
              <span className="flex flex-col items-center gap-1 text-xs font-medium text-gray-500">
                <FileText className="h-6 w-6" /> PDF
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="Floor plan" className="h-full w-full object-contain" />
            )}
          </a>
          <div className="mt-1 flex gap-2 text-[11px]">
            <label className="cursor-pointer font-medium text-red-600 hover:underline">
              Replace
              {input}
            </label>
            <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-600">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 text-center text-[11px] font-medium text-gray-500 transition hover:border-red-300 hover:text-red-600">
          <Upload className="h-5 w-5" />
          Upload
          <span className="font-normal text-gray-400">image or PDF</span>
          {input}
        </label>
      )}
      {error && <p className="mt-1 w-40 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

/*
 * Photos of this unit: its rooms, as opposed to the building's gallery on the
 * Photos step. Several at once; each can be taken out again.
 */
function UnitPhotos({ photos, uploading, error, onPick, onRemove }) {
  return (
    <div>
      <span className="block text-xs font-semibold text-gray-700">Unit photos</span>
      <span className="mb-1.5 block text-[11px] text-gray-400">Pictures of the rooms in this unit</span>
      <div className="flex flex-wrap gap-2">
        {photos.map((url) => (
          <div key={url} className="group relative h-24 w-24 overflow-hidden rounded-lg border border-gray-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Unit photo" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onRemove(url)}
              aria-label="Remove photo"
              className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }).map((_, k) => (
          <div
            key={`up${k}`}
            className="flex h-24 w-24 items-center justify-center rounded-lg border border-gray-200 bg-gray-50"
          >
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ))}
        <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 text-[11px] font-medium text-gray-500 transition hover:border-red-300 hover:text-red-600">
          <ImagePlus className="h-5 w-5" />
          Add photos
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onPick(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

/*
 * The units this property already has on Proximity, on an existing-property
 * tab. The landlord's own leases are editable in place; other landlords' are
 * only counted, never shown or touched. Any unit can take a new lease.
 */
function ExistingUnits({ w }) {
  const property = w.existingProperty;
  const units = property?.units ?? [];
  const toForm = (l) => ({
    rent: l.rent == null ? "" : String(Number(l.rent)),
    rentIsPerPerson: !!l.rentIsPerPerson,
    availableFrom: l.availableFrom ?? "",
    leaseTermMonths: l.leaseTermMonths ?? [],
  });
  return (
    <div className="mb-6 rounded-xl border border-red-200 bg-red-50/40 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Building2 className="h-4 w-4 text-red-600" />
        Already on Proximity
        <span className="font-normal text-gray-500">
          {units.length} {units.length === 1 ? "unit" : "units"} at {property?.title || "this property"}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-gray-500">
        Change the leases you already have here, or add a lease to any unit. Other
        landlords&apos; leases stay as they are.
      </p>
      <div className="mt-3 space-y-3">
        {units.map((u) => {
          const mine = u.leases.filter((l) => l.isMine);
          const others = u.leases.filter((l) => !l.isMine && l.live).length;
          const added = w.existingNewLeases[u.id] ?? [];
          return (
            <div key={u.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-sm font-medium text-gray-900">
                {u.label || "Unit"}
                <span className="ml-2 font-normal text-gray-500">
                  {Number(u.bedrooms) === 0 ? "Studio" : `${u.bedrooms ?? "?"} bed`} ·{" "}
                  {u.bathrooms ?? "?"} bath
                  {u.area ? ` · ${Number(u.area).toLocaleString()} sq ft` : ""}
                  {others ? ` · ${others} lease${others === 1 ? "" : "s"} by other landlords` : ""}
                </span>
              </p>
              <div className="mt-2 space-y-2 border-l-2 border-red-100 pl-3">
                {mine.map((l) => {
                  const edited = w.existingEdits[l.id];
                  return (
                    <div key={l.id}>
                      <p className="mb-1 text-[11px] font-medium text-gray-500">
                        Your lease
                        {edited && (
                          <>
                            <span className="ml-1.5 text-amber-700">changed</span>
                            <button
                              type="button"
                              onClick={() => w.resetExistingLease(l.id)}
                              className="ml-1.5 text-red-600 hover:underline"
                            >
                              Undo
                            </button>
                          </>
                        )}
                      </p>
                      <LeaseRow
                        lease={{ ...toForm(l), ...(edited ?? {}) }}
                        canRemove={false}
                        onChange={(patch) => w.editExistingLease(l.id, { ...toForm(l), ...(edited ?? {}), ...patch })}
                      />
                    </div>
                  );
                })}
                {added.map((lease, k) => (
                  <div key={`new${k}`}>
                    <p className="mb-1 text-[11px] font-medium text-green-700">New lease</p>
                    <LeaseRow
                      lease={lease}
                      canRemove
                      onRemove={() => w.removeExistingUnitLease(u.id, k)}
                      onChange={(patch) => w.updateExistingUnitLease(u.id, k, patch)}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => w.addExistingUnitLease(u.id)}
                  className="flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" /> Add your lease to this unit
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/*
 * On the landlord's own listing, where each unit and lease stands against what
 * is live on Proximity (see mergeWithLive).
 */
const sameTerms = (a, b) =>
  JSON.stringify([...(a ?? [])].map(Number).sort()) ===
  JSON.stringify([...(b ?? [])].map(Number).sort());
const leaseChanged = (l) =>
  !!l.live &&
  (String(l.rent ?? "") !== String(l.live.rent ?? "") ||
    !!l.rentIsPerPerson !== !!l.live.rentIsPerPerson ||
    (l.availableFrom || "") !== (l.live.availableFrom || "") ||
    !sameTerms(l.leaseTermMonths, l.live.leaseTermMonths));

const PILL = {
  red: "bg-red-100 text-red-700",
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  gray: "bg-gray-100 text-gray-600",
};
function Pill({ tone, children }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${PILL[tone]}`}>
      {children}
    </span>
  );
}

// "Keep" or "Mark unavailable", for something on Proximity the website dropped.
function RetireChoice({ retire, onChange }) {
  return (
    <span className="inline-flex rounded-md bg-gray-100 p-0.5 text-[10px]">
      {[
        [false, "Keep"],
        [true, "Mark unavailable"],
      ].map(([v, label]) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded px-1.5 py-0.5 font-medium ${
            !!retire === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
          }`}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

// "was 650 · Undo" under a field the website changed.
function Was({ value, onUndo }) {
  return (
    <p className="mt-1 text-[11px] text-amber-700">
      was {value === "" || value == null ? "blank" : String(value)} on Proximity ·{" "}
      <button type="button" onClick={onUndo} className="font-medium text-red-600 hover:underline">
        Undo
      </button>
    </p>
  );
}

const leaseSummary = (l) =>
  [
    l.rent !== "" && l.rent != null
      ? `${money(l.rent)}/mo${l.rentIsPerPerson ? " per person" : ""}`
      : "Contact for pricing",
    (l.leaseTermMonths ?? []).length
      ? `${l.leaseTermMonths.join(", ")} months`
      : null,
    l.availableFrom
      ? `from ${new Date(`${l.availableFrom}T00:00:00`).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`
      : "Available now",
  ]
    .filter(Boolean)
    .join(" · ");

/*
 * One lease, as a single line until it is opened. A revenue-managed building
 * quotes a price per lease length, so a unit can carry ten of these, and ten
 * open forms is a page nobody reads. A lease that still needs an answer, or was
 * just added, opens itself.
 */
function LeaseRow({ lease, onChange, onRemove, canRemove, imported, badge = null }) {
  const missingTerms = !(lease.leaseTermMonths ?? []).length;
  const [open, setOpen] = useState(missingTerms);

  if (!open) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-1 items-center gap-2 text-left text-sm text-gray-800"
        >
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          {leaseSummary(lease)}
        </button>
        {badge}
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove this lease"
            className="shrink-0 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-red-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative rounded-lg border border-gray-200 bg-white p-3">
      {badge && <div className="mb-2 flex flex-wrap items-center gap-2 pr-16">{badge}</div>}
      {!missingTerms && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-9 top-2.5 text-[11px] font-medium text-gray-400 hover:text-gray-700"
        >
          Done
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this lease"
          className="absolute right-2 top-2 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-red-600"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3 pr-6">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Rent per month
          </span>
          <input
            type="number"
            min="0"
            value={lease.rent}
            onChange={(e) => onChange({ rent: e.target.value })}
            placeholder="Contact for pricing"
            className={`w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500${
              imported ? importedInputCls : ""
            }`}
          />
          <div className="mt-1.5 inline-flex rounded-lg bg-gray-100 p-0.5 text-[11px]">
            {[
              [false, "whole unit"],
              [true, "per person"],
            ].map(([v, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => onChange({ rentIsPerPerson: v })}
                className={`rounded-md px-2 py-0.5 font-medium transition ${
                  !!lease.rentIsPerPerson === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </label>

        <div>
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Available on
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="Available on"
              value={lease.availableFrom ?? ""}
              onChange={(e) => onChange({ availableFrom: e.target.value })}
              className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            {/* Blank is a real answer, so it says so. Once a date is set, the
                same slot is the way back to "now". */}
            {lease.availableFrom ? (
              <button
                type="button"
                onClick={() => onChange({ availableFrom: "" })}
                className="rounded-full border border-gray-300 px-2 py-0.5 text-[10px] font-medium text-gray-600 transition-colors hover:border-green-400 hover:bg-green-50 hover:text-green-800"
              >
                Available now instead
              </button>
            ) : (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-800">
                Available now
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
          Lease lengths at this rent
        </span>
        <div
          className={
            (lease.leaseTermMonths ?? []).length ? "" : "-m-1.5 rounded-lg p-1.5 ring-1 ring-red-200"
          }
        >
          <LeaseTermPicker
            value={lease.leaseTermMonths ?? []}
            onChange={(next) => onChange({ leaseTermMonths: next })}
          />
        </div>
      </div>
    </div>
  );
}

export default function StepUnits({ w }) {
  /*
   * A big building arrives folded up. Thirty-six floor plans open at once is a
   * morning of scrolling, so above a handful each unit shows as one line that
   * says what it is and what still needs an answer, and opens on a click.
   */
  const totalLeases = w.units.reduce((n, u) => n + (u.leases?.length ?? 0), 0);
  const manyUnits = w.units.length > 5 || (w.units.length > 1 && totalLeases > 12);
  const [opened, setOpened] = useState(() => new Set());
  const isOpen = (i) => !manyUnits || opened.has(i);
  const allOpen = manyUnits && opened.size === w.units.length;
  const toggleOpen = (i) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const offered = w.units.filter((u) => u.available !== false);
  const waitlistCount = w.units.length - offered.length;
  const leasesMissingTerms = offered.flatMap((u) => u.leases).filter(
    (l) => !(l.leaseTermMonths ?? []).length
  ).length;

  /*
   * Lease lengths, set once for the whole building. Most buildings write the
   * same lengths on every plan, and a site that doesn't publish them leaves
   * every lease empty. Said out loud and undoable.
   */
  const [bulkTerms, setBulkTerms] = useState([]);
  const [undo, setUndo] = useState(null);
  const applyBulk = () => {
    if (!bulkTerms.length) return;
    setUndo(w.applyTermsToAll(bulkTerms));
  };

  const unitProblems = (u) =>
    [
      u.bedrooms === "" || u.bathrooms === "" ? "needs beds and baths" : null,
      u.available !== false && u.leases.some((l) => !(l.leaseTermMonths ?? []).length)
        ? "needs a lease length"
        : null,
    ].filter(Boolean);

  return (
    <StepFrame
      title="Units and leases"
      subtitle="One unit per floor plan. Under each, the rents it's offered at, with the lease lengths and move-in date for each."
    >
      {w.ownExisting && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">This is already on Proximity, and it&apos;s yours.</p>
        </div>
      )}
      {w.batchExisting && !w.ownExisting && w.existingProperty && <ExistingUnits w={w} />}
      {w.batchExisting && !w.ownExisting && (
        <p className="mb-3 text-sm font-semibold text-gray-900">
          New units to add
          <span className="ml-1.5 font-normal text-gray-500">
            Read from your website. Remove any that are already listed above.
          </span>
        </p>
      )}
      <div className="space-y-4">
        {(manyUnits || leasesMissingTerms > 1 || waitlistCount > 0) && (
          <div className="space-y-3 rounded-lg bg-gray-50 px-4 py-3">
            {manyUnits && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-gray-600">
                  {w.units.length} units, {totalLeases} leases. Open any unit to check or
                  change it.
                </p>
                <button
                  type="button"
                  onClick={() => setOpened(allOpen ? new Set() : new Set(w.units.map((_, i) => i)))}
                  className="shrink-0 text-sm font-medium text-red-600 hover:text-red-700"
                >
                  {allOpen ? "Collapse all" : "Open all"}
                </button>
              </div>
            )}

            {waitlistCount > 0 && (
              <p className="text-xs text-gray-600">
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                  {waitlistCount} waitlist only
                </span>{" "}
                Your website shows these with no price, so they are saved with your
                listing but not offered to students.
              </p>
            )}

            {(leasesMissingTerms > 1 || undo) && (
              <div className={manyUnits || waitlistCount ? "border-t border-gray-200 pt-2.5" : ""}>
                <p className="text-xs text-gray-700">
                  {leasesMissingTerms > 1
                    ? `${leasesMissingTerms} leases still need a lease length. Set them all at once:`
                    : "Lease lengths set on every lease."}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <LeaseTermPicker value={bulkTerms} onChange={setBulkTerms} />
                  <button
                    type="button"
                    onClick={applyBulk}
                    disabled={!bulkTerms.length}
                    className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    Apply to every lease
                  </button>
                  {undo && (
                    <button
                      type="button"
                      onClick={() => {
                        w.restoreUnits(undo);
                        setUndo(null);
                      }}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Undo
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {w.units.map((unit, i) => {
          const leases = unit.leases ?? [];
          const problems = unitProblems(unit);
          const summary = (
            <>
              <span className="text-sm font-semibold text-gray-900">
                {unit.title || `Unit ${i + 1}`}
              </span>
              <span className="text-sm text-gray-500">{planLabel(unit)}</span>
              {rentRange(leases) && (
                <span className="text-sm text-gray-500">{rentRange(leases)}</span>
              )}
              <span className="text-xs text-gray-400">
                {leases.length} {leases.length === 1 ? "lease" : "leases"}
              </span>
              {unit.available === false && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  Waitlist only
                </span>
              )}
              {unit.status === "live" && <Pill tone="red">On Proximity</Pill>}
              {unit.status === "new" && w.ownExisting && <Pill tone="green">New from your website</Pill>}
              {unit.status === "missing" && (
                <Pill tone={unit.retire ? "gray" : "amber"}>
                  {unit.retire ? "Will be marked unavailable" : "Not on your website"}
                </Pill>
              )}
              {unit.othersLeases > 0 && (
                <span className="text-xs text-gray-400">
                  +{unit.othersLeases} by other landlords
                </span>
              )}
            </>
          );
          // Only the listing's owner may change a unit's own details; someone
          // holding a lease here edits their leases and nothing else.
          const lockedUnit = !!(unit.live && w.ownExisting && w.ownExisting.mine !== "owner");
          const canRemoveUnit = !unit.live && (w.units.length > 1 || w.batchExisting);

          if (!isOpen(i)) {
            return (
              <div key={i} className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-3">
                <button
                  type="button"
                  onClick={() => toggleOpen(i)}
                  className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left"
                >
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                  {summary}
                  {problems.map((p) => (
                    <span key={p} className="text-xs font-medium text-red-600">
                      {p}
                    </span>
                  ))}
                </button>
                {canRemoveUnit && (
                  <button
                    type="button"
                    onClick={() => w.removeUnit(i)}
                    aria-label="Remove unit"
                    className="shrink-0 text-gray-300 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          }

          return (
            <div key={i} className="rounded-xl border border-gray-200">
              {/* The unit: what the floor plan is. */}
              <div className="flex items-start gap-2 border-b border-gray-100 px-4 py-3">
                {manyUnits ? (
                  <button
                    type="button"
                    onClick={() => toggleOpen(i)}
                    aria-label="Collapse unit"
                    className="mt-0.5 text-gray-400 hover:text-gray-700"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                ) : null}
                <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">{summary}</div>
                {unit.status === "missing" && (
                  <RetireChoice retire={unit.retire} onChange={(v) => w.setUnitRetire(i, v)} />
                )}
                {canRemoveUnit && (
                  <button
                    type="button"
                    onClick={() => w.removeUnit(i)}
                    aria-label="Remove unit"
                    className="text-gray-300 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="space-y-4 p-4">
                {/* Pictures first, side by side and labelled apart: the floor
                    plan is the layout drawing, the photos are of the rooms. */}
                <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
                  <FloorPlanSlot
                    url={unit.floorPlanImageUrl}
                    uploading={!!w.floorPlanUploading[i]}
                    error={w.floorPlanError[i]}
                    onPick={(file) => w.uploadFloorPlan(i, file)}
                    onRemove={() => w.updateUnit(i, "floorPlanImageUrl", "")}
                  />
                  <div className="hidden self-stretch border-l border-gray-200 sm:block" />
                  <div className="min-w-0 flex-1">
                    <UnitPhotos
                      photos={unit.photos ?? []}
                      uploading={w.unitPhotoUploading[i] ?? 0}
                      error={w.floorPlanError[`photos${i}`]}
                      onPick={(files) => w.uploadUnitPhotos(i, files)}
                      onRemove={(url) => w.removeUnitPhoto(i, url)}
                    />
                  </div>
                </div>

                {lockedUnit && (
                  <p className="text-xs text-gray-500">
                    Only the property&apos;s owner can change this unit&apos;s details. Your leases
                    below are yours to edit.
                  </p>
                )}
                {unit.live &&
                  !lockedUnit &&
                  (unit.floorPlanImageUrl || "") !== (unit.live.floorPlanImageUrl || "") && (
                    <p className="text-[11px] text-amber-700">
                      Floor plan changed from the one on Proximity ·{" "}
                      <button
                        type="button"
                        onClick={() => w.revertUnitField(i, "floorPlanImageUrl")}
                        className="font-medium text-red-600 hover:underline"
                      >
                        Undo
                      </button>
                    </p>
                  )}
                <div
                  className={`flex flex-wrap items-start gap-x-8 gap-y-4${
                    lockedUnit ? " pointer-events-none opacity-60" : ""
                  }`}
                >
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-600">
                      Floor plan name <span className="text-gray-400">(optional)</span>
                    </span>
                    <input
                      type="text"
                      value={unit.title ?? ""}
                      onChange={(e) => w.updateUnit(i, "title", e.target.value)}
                      placeholder='e.g. "The Loft"'
                      className={`w-52 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500${
                        w.importedFields.has(`u${i}:title`) ? importedInputCls : ""
                      }`}
                    />
                    {unit.live && String(unit.title ?? "") !== String(unit.live.title ?? "") && (
                      <Was value={unit.live.title} onUndo={() => w.revertUnitField(i, "title")} />
                    )}
                  </label>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-gray-600">Bedrooms</p>
                    <Stepper
                      value={unit.bedrooms}
                      min={0}
                      onChange={(v) => w.updateUnit(i, "bedrooms", v)}
                    />
                    {unit.live && String(unit.bedrooms) !== String(unit.live.bedrooms) && (
                      <Was value={unit.live.bedrooms} onUndo={() => w.revertUnitField(i, "bedrooms")} />
                    )}
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-gray-600">Bathrooms</p>
                    <Stepper
                      value={unit.bathrooms}
                      min={0}
                      step={0.5}
                      onChange={(v) => w.updateUnit(i, "bathrooms", v)}
                    />
                    {unit.live && String(unit.bathrooms) !== String(unit.live.bathrooms) && (
                      <Was value={unit.live.bathrooms} onUndo={() => w.revertUnitField(i, "bathrooms")} />
                    )}
                  </div>
                  <label className="block w-28">
                    <span className="mb-1.5 block text-xs font-medium text-gray-600">
                      Sq ft <span className="text-gray-400">(optional)</span>
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={unit.area}
                      onChange={(e) => w.updateUnit(i, "area", e.target.value)}
                      className={`${inputCls}${
                        w.importedFields.has(`u${i}:area`) ? importedInputCls : ""
                      }`}
                    />
                    {unit.live && String(unit.area ?? "") !== String(unit.live.area ?? "") && (
                      <Was value={unit.live.area} onUndo={() => w.revertUnitField(i, "area")} />
                    )}
                  </label>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={unit.available === false}
                    onChange={(e) => w.updateUnit(i, "available", !e.target.checked)}
                  />
                  Waitlist only (saved, but not offered to students yet)
                </label>

                {/* The leases: the options a student can take on this unit. */}
                <div className="border-l-2 border-red-100 pl-4">
                  <p className="mb-2 text-xs font-semibold text-gray-700">
                    Leases on this unit
                    <span className="ml-1.5 font-normal text-gray-400">
                      One per rent. Apartments at the same rent share a lease.
                    </span>
                  </p>
                  <div className="space-y-2">
                    {leases.map((lease, k) => {
                      const changed = leaseChanged(lease);
                      const badge = !w.ownExisting ? null : lease.status === "missing" ? (
                        <>
                          <Pill tone={lease.retire ? "gray" : "amber"}>
                            {lease.retire ? "Will be marked unavailable" : "Not on your website"}
                          </Pill>
                          <RetireChoice
                            retire={lease.retire}
                            onChange={(v) => w.setLeaseRetire(i, k, v)}
                          />
                        </>
                      ) : lease.live ? (
                        changed ? (
                          <>
                            <Pill tone="amber">Updated from your website</Pill>
                            <span className="text-[11px] text-gray-500">
                              was {leaseSummary(lease.live)} ·{" "}
                              <button
                                type="button"
                                onClick={() => w.revertLease(i, k)}
                                className="font-medium text-red-600 hover:underline"
                              >
                                Undo
                              </button>
                            </span>
                          </>
                        ) : (
                          <Pill tone="red">On Proximity</Pill>
                        )
                      ) : (
                        <Pill tone="green">New</Pill>
                      );
                      return (
                        <LeaseRow
                          key={k}
                          lease={lease}
                          badge={badge}
                          imported={w.importedFields.has(`u${i}:leases`)}
                          canRemove={!lease.live && leases.length > 1}
                          onRemove={() => w.removeLease(i, k)}
                          onChange={(patch) => w.updateLease(i, k, patch)}
                        />
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => w.addLease(i)}
                    className="mt-2 flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add a lease at a different rent
                  </button>
                </div>
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
            <Plus className="h-4 w-4" /> Add a unit
          </button>
        )}
        <p className="text-xs text-gray-500">
          {w.units.length} {w.units.length === 1 ? "unit" : "units"} · {totalLeases}{" "}
          {totalLeases === 1 ? "lease" : "leases"}
        </p>
      </div>
    </StepFrame>
  );
}
