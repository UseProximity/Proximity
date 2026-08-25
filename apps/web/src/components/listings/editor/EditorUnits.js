"use client";

/*
 * Units, and the offerings on them.
 *
 * The three levels answer to different people, so they are edited separately
 * and never in one save:
 *   the unit    — a physical fact of the building; the property owner's
 *   an offering — one landlord's terms on that unit; only that landlord's
 *
 * Unavailable units are shown rather than hidden. The renter-facing panel drops
 * them, which meant a landlord who marked a unit unavailable had no way to find
 * it again and turn it back on.
 */

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Plus } from "lucide-react";
import { availabilityLabel } from "@/utils/availability";
import { UnitPhotoRow } from "./EditorImageRows";
import LeaseTermPicker from "@/components/listings/LeaseTermPicker";
import { LEASE_DESCRIPTION_MAX } from "@/lib/listings/leaseDescription";

const DESIGNATORS = ["Apt", "Unit", "Suite", "Floor", "Room", "Whole"];

// Heading for a group of offerings inside a unit.
function SectionLabel({ children, hint }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 px-4 pt-3">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {children}
      </span>
      {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
    </div>
  );
}

const field =
  "rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-red-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500";

// The saved state of an offering, as the form holds it. Shared by the initial
// draft and by Discard, so "back to how it was" cannot drift from "how it
// opened".
const leaseDraft = (lease) => ({
  rent: lease.rent ?? "",
  rentIsPerPerson: lease.rentIsPerPerson ?? false,
  leaseTermMonths: lease.leaseTermMonths ?? [],
  sublease: !!lease.sublease,
  furnished: !!lease.furnished,
  availableFrom: lease.availableFrom ? String(lease.availableFrom).slice(0, 10) : "",
  unavailable: !!lease.unavailable,
  contactEmail: lease.contactEmail ?? "",
  contactPhone: lease.contactPhone ?? "",
  description: lease.description ?? "",
});

function LeaseRow({ lease, listingId, onChanged }) {
  const [draft, setDraft] = useState(() => leaseDraft(lease));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (p) => { setDraft((d) => ({ ...d, ...p })); setDirty(true); };

  const avail = availabilityLabel(lease.availableFrom);

  const discard = () => {
    setDraft(leaseDraft(lease));
    setDirty(false);
  };

  const save = async () => {
    // A renter has to be able to reach someone. The property contact still backs
    // legacy offerings, but a landlord editing their own can't leave it blank.
    if (!draft.contactEmail.trim()) {
      return toast.error("Add a contact email so students can reach you.");
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/leases/${lease.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, availableFrom: draft.availableFrom || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Couldn't save that listing.");
      toast.success("Your listing was updated.");
      setDirty(false);
      await onChanged();
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  };

  if (!lease.mine) {
    // Another landlord's offering on the same unit: visible because a renter
    // sees it, read-only because it isn't theirs.
    return (
      <li className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-gray-200 bg-white/60 p-4 text-sm">
        <span className="font-semibold text-gray-900">
          {lease.rent != null ? `$${Number(lease.rent).toLocaleString()}` : "Ask"}
          {lease.rent != null && (
            <span className="font-normal text-gray-500">
              {lease.rentIsPerPerson ? "/person" : "/mo"}
            </span>
          )}
        </span>
        <span className={avail.now ? "font-semibold text-green-600" : "text-gray-600"}>{avail.text}</span>
        <span className="text-gray-600">{lease.sublease ? "Sublease" : "Standard"}</span>
        <span className="text-gray-500">{lease.landlordName ?? "Another landlord"}</span>
        {lease.unavailable && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
            Withdrawn
          </span>
        )}
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {/* Red because it is a live consequence, not a note: while this is on,
            students cannot find the offering at all. */}
        {draft.unavailable && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
            Withdrawn
          </span>
        )}
        <span className="flex-1" />
        {dirty && (
          <>
            {/* An edit you can back out of. Without this the only way to undo a
                half-typed change was to reload the page and lose the rest. */}
            <button onClick={discard} disabled={saving}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-60">
              Discard changes
            </button>
            <button onClick={save} disabled={saving}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Rent / month</span>
          <input type="number" className={`mt-1 w-full ${field}`} value={draft.rent}
            placeholder="Leave blank for “Contact for pricing”"
            onChange={(e) => set({ rent: e.target.value })} />
          <div className="mt-1.5 inline-flex rounded-lg bg-gray-100 p-0.5 text-[11px]">
            {[[false, "whole unit"], [true, "per person"]].map(([v, label]) => (
              <button key={label} type="button" onClick={() => set({ rentIsPerPerson: v })}
                className={`rounded-md px-2 py-0.5 font-medium transition ${
                  draft.rentIsPerPerson === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
                {label}
              </button>
            ))}
          </div>
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Available on</span>
          <input type="date" className={`mt-1 w-full ${field}`} value={draft.availableFrom}
            onChange={(e) => set({ availableFrom: e.target.value })} />
          <span className="mt-0.5 block text-[11px] text-gray-400">
            A date in the past shows{" "}
            <span className="font-semibold text-green-600">Now</span>.
          </span>
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Contact email</span>
          <input type="email" required className={`mt-1 w-full ${field}`} value={draft.contactEmail}
            onChange={(e) => set({ contactEmail: e.target.value })} />
        </label>
      </div>

      <div className="mt-3">
        <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
          Lease lengths you accept
        </span>
        <div className="mt-1.5">
          <LeaseTermPicker
            value={draft.leaseTermMonths}
            onChange={(next) => set({ leaseTermMonths: next })}
          />
        </div>
      </div>

      {/* The blurb students read behind the chevron on this offering. Short by
          design — it sits under the row, not in place of it. */}
      <label className="mt-3 block">
        <span className="flex items-baseline justify-between text-[10px] font-medium uppercase tracking-wide text-gray-400">
          <span>A short note about this listing</span>
          <span className="normal-case tracking-normal">
            Optional · {draft.description.length}/{LEASE_DESCRIPTION_MAX}
          </span>
        </span>
        <textarea
          rows={2} className={`mt-1 w-full ${field}`} value={draft.description}
          maxLength={LEASE_DESCRIPTION_MAX}
          placeholder="Utilities included, on-street parking, cat-friendly…"
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2 text-gray-700">
          <input type="checkbox" checked={draft.sublease}
            onChange={(e) => set({ sublease: e.target.checked })} />
          This is a sublease
        </label>
        <label className="inline-flex items-center gap-2 text-gray-700">
          <input type="checkbox" checked={draft.furnished}
            onChange={(e) => set({ furnished: e.target.checked })} />
          Furnished
        </label>
        <label className="inline-flex items-center gap-2 text-gray-700">
          <input type="checkbox" checked={draft.unavailable}
            onChange={(e) => set({ unavailable: e.target.checked })} />
          Withdrawn (hide from students)
        </label>
      </div>
    </li>
  );
}

function UnitPanel({ unit, listing, isPropertyOwner, currentUserEmail, onChanged }) {
  const listingId = listing?._id || listing?.id;
  const [draft, setDraft] = useState({
    designator: unit.designator ?? (unit.identityLabel ? "Apt" : ""),
    number: unit.number ?? "",
    bedrooms: unit.bedrooms ?? "",
    bathrooms: unit.bathrooms ?? "",
    area: unit.area ?? "",
    title: unit.title ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (p) => { setDraft((d) => ({ ...d, ...p })); setDirty(true); };

  const myLeases = (unit.leases ?? []).filter((l) => l.mine);
  const otherLeases = (unit.leases ?? []).filter((l) => !l.mine);

  const patchUnit = async (payload, message) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/units/${unit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Couldn't save that unit.");
      if (message) toast.success(message);
      setDirty(false);
      await onChanged();
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
        <h4 className="text-sm font-semibold text-gray-900">
          {unit.identityLabel ?? unit.title ?? `${unit.bedrooms ?? "?"} bed · ${unit.bathrooms ?? "?"} bath`}
        </h4>
        <span className="text-xs text-gray-500">
          {unit.bedrooms ?? "?"} bed · {unit.bathrooms ?? "?"} bath
          {unit.area != null ? ` · ${Number(unit.area).toLocaleString()} sq ft` : ""}
        </span>
        {!unit.available && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">Unavailable</span>
        )}
        {isPropertyOwner && dirty && (
          <button onClick={() => patchUnit(draft, "Unit saved.")} disabled={saving}
            className="ml-auto rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {saving ? "Saving…" : "Save unit"}
          </button>
        )}
      </div>

      {isPropertyOwner ? (
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Type</span>
            <select className={`mt-1 w-full ${field}`} value={draft.designator}
              onChange={(e) => set({ designator: e.target.value })}>
              <option value="">—</option>
              {DESIGNATORS.map((d) => <option key={d} value={d}>{d === "Whole" ? "Whole property" : d}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Number</span>
            <input className={`mt-1 w-full ${field}`} value={draft.number}
              disabled={!draft.designator || draft.designator === "Whole"}
              onChange={(e) => set({ number: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Beds</span>
            <input type="number" className={`mt-1 w-full ${field}`} value={draft.bedrooms}
              onChange={(e) => set({ bedrooms: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Baths</span>
            <input type="number" step="0.5" className={`mt-1 w-full ${field}`} value={draft.bathrooms}
              onChange={(e) => set({ bathrooms: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Sq ft</span>
            <input type="number" className={`mt-1 w-full ${field}`} value={draft.area}
              onChange={(e) => set({ area: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Floor plan name</span>
            <input className={`mt-1 w-full ${field}`} value={draft.title}
              onChange={(e) => set({ title: e.target.value })} />
          </label>
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-gray-500">
          {unit.bedrooms ?? "?"} bed · {unit.bathrooms ?? "?"} bath
          {unit.area ? ` · ${Number(unit.area).toLocaleString()} sq ft` : ""}
          <span className="ml-2 text-xs text-gray-400">Managed by the property owner</span>
        </p>
      )}

      <UnitPhotoRow
        listing={listing}
        unit={unit}
        isPropertyOwner={isPropertyOwner}
        onChanged={onChanged}
      />

      {/*
        * The offerings sit on a darker ground than the unit above them. They are
        * a different level of the record owned by different people, and on a
        * white-on-white panel the boundary between "this apartment" and "the
        * terms someone is offering on it" was invisible.
        */}
      <div className="border-t border-gray-200 bg-gray-100/70">
        {(unit.leases ?? []).length === 0 && (
          <>
            <SectionLabel>Listings on this unit</SectionLabel>
            <p className="px-4 pb-3 text-sm text-gray-500">
              No offerings on this unit yet.
            </p>
          </>
        )}

        {/*
          * Split by who owns them rather than sorted into one list. The two
          * groups are not the same kind of thing: the first is yours to edit,
          * the second is what a student sees beside it and cannot be touched.
          * Interleaving them by price made the editable rows something you had
          * to hunt for on a unit with competing offerings.
          */}
        {myLeases.length > 0 && (
          <>
            <SectionLabel>Your listings on this unit</SectionLabel>
            <ul className="space-y-3 px-4 pb-3 pt-2">
              {myLeases.map((lease) => (
                <LeaseRow key={lease.id} lease={lease} listingId={listingId} onChanged={onChanged} />
              ))}
            </ul>
          </>
        )}

        {otherLeases.length > 0 && (
          <>
            <SectionLabel hint="Shown to students alongside yours — not yours to edit">
              {otherLeases.length === 1
                ? "Other landlord's listing"
                : `Other landlords' listings (${otherLeases.length})`}
            </SectionLabel>
            <ul className="space-y-3 px-4 pb-3 pt-2">
              {otherLeases.map((lease) => (
                <LeaseRow key={lease.id} lease={lease} listingId={listingId} onChanged={onChanged} />
              ))}
            </ul>
          </>
        )}

        {/*
          * A landlord can hold more than one offering on the same apartment —
          * different terms, or a sublease alongside their standard lease — and
          * several landlords can each hold their own. Adding one creates an empty
          * offering to fill in rather than opening a separate form, so it lands in
          * the same list the others are edited in.
          */}
        <div className="border-t border-gray-200 px-4 py-3">
          <button
            type="button" disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                const res = await fetch("/api/leases", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    unitId: unit.id,
                    leaseTermMonths: [12],
                    available: true,
                    contactEmail: currentUserEmail ?? null,
                  }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) return toast.error(data.error || "Couldn't add a listing.");
                toast.success("Added — fill in your terms below.");
                await onChanged();
              } catch {
                toast.error("Network error.");
              } finally {
                setSaving(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-red-300 hover:text-red-600 disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            Add another listing on this unit
          </button>
        </div>
      </div>

      {/* The renter-facing panel puts Contact here. For a landlord the equivalent
          action is deciding whether the unit is on the market at all. */}
      {isPropertyOwner && (
        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/60 px-4 py-3">
          <span className="text-xs text-gray-500">
            {unit.available
              ? "This unit is on the market."
              : "Hidden from students — no offering on it can be found."}
          </span>
          <button
            onClick={() => patchUnit({ available: !unit.available },
              unit.available ? "Unit marked unavailable." : "Unit is available again.")}
            disabled={saving}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
              unit.available
                ? "border border-gray-300 text-gray-700 hover:border-red-300 hover:text-red-600"
                : "bg-green-600 text-white hover:bg-green-700"}`}
          >
            {unit.available ? "Mark unavailable" : "Mark available"}
          </button>
        </div>
      )}
    </div>
  );
}

/*
 * The unsaved tab behind the +.
 *
 * Beds and baths are asked for rather than defaulted. The first version of this
 * created the row immediately with nothing in it, which the database refused
 * outright (both columns are NOT NULL) — and had it succeeded, a placeholder
 * 1-bed would have gone straight into browse and matched bed/bath filters no
 * real apartment here answers.
 */
function NewUnitPanel({ saving, onCancel, onCreate }) {
  const [draft, setDraft] = useState({
    designator: "", number: "", bedrooms: "", bathrooms: "", area: "", title: "",
  });
  const [attempted, setAttempted] = useState(false);
  const set = (p) => setDraft((d) => ({ ...d, ...p }));

  const missing = [];
  if (draft.bedrooms === "") missing.push({ key: "bedrooms", label: "Bedrooms" });
  if (draft.bathrooms === "") missing.push({ key: "bathrooms", label: "Bathrooms" });
  if (draft.designator && draft.designator !== "Whole" && !draft.number.trim()) {
    missing.push({ key: "number", label: "Unit number" });
  }
  const missingKeys = new Set(missing.map((m) => m.key));
  const bad = (key) =>
    attempted && missingKeys.has(key) ? "border-red-400 ring-1 ring-red-200" : "";

  const submit = () => {
    if (missing.length) return setAttempted(true);
    onCreate({
      designator: draft.designator || null,
      number: draft.designator && draft.designator !== "Whole" ? draft.number : null,
      bedrooms: draft.bedrooms,
      bathrooms: draft.bathrooms,
      area: draft.area,
      title: draft.title,
    });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h4 className="text-sm font-semibold text-gray-900">A new unit</h4>
        <p className="text-xs text-gray-500">
          The apartment itself. You add your own terms on it once it exists.
        </p>
      </div>

      <div className="grid gap-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Type</span>
          <select className={`mt-1 w-full ${field}`} value={draft.designator}
            onChange={(e) => set({ designator: e.target.value })}>
            <option value="">—</option>
            {DESIGNATORS.map((d) => <option key={d} value={d}>{d === "Whole" ? "Whole property" : d}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Number</span>
          <input className={`mt-1 w-full ${field} ${bad("number")}`} value={draft.number}
            disabled={!draft.designator || draft.designator === "Whole"}
            placeholder="2W"
            onChange={(e) => set({ number: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
            Beds <span className="text-red-500">*</span>
          </span>
          <input type="number" className={`mt-1 w-full ${field} ${bad("bedrooms")}`} value={draft.bedrooms}
            onChange={(e) => set({ bedrooms: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
            Baths <span className="text-red-500">*</span>
          </span>
          <input type="number" step="0.5" className={`mt-1 w-full ${field} ${bad("bathrooms")}`}
            value={draft.bathrooms}
            onChange={(e) => set({ bathrooms: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Sq ft</span>
          <input type="number" className={`mt-1 w-full ${field}`} value={draft.area}
            onChange={(e) => set({ area: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Floor plan name</span>
          <input className={`mt-1 w-full ${field}`} value={draft.title}
            onChange={(e) => set({ title: e.target.value })} />
        </label>
      </div>

      <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-4 py-3">
        <button onClick={submit} disabled={saving}
          className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
          {saving ? "Adding…" : "Add unit"}
        </button>
        <button onClick={onCancel} disabled={saving}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700">
          Cancel
        </button>
        {attempted && missing.length > 0 && (
          <span className="text-xs font-medium text-red-600">
            Still needed: {missing.map((m) => m.label).join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

// The tab's name for a unit: its real identity first, then the landlord's own
// name for the floor plan, and only then a description of it. Mirrors the
// student-facing selector, which is the point — a landlord editing Apt 2W
// should be looking at the same label a renter sees.
function unitTabLabel(unit) {
  if (unit.identityLabel) return unit.identityLabel;
  if (unit.title) return unit.title;
  if ((unit.bedrooms ?? 0) === 0 && unit.bedrooms != null) return "Studio";
  return `${unit.bedrooms ?? "?"} bd · ${unit.bathrooms ?? "?"} ba`;
}

export default function EditorUnits({ listing, isPropertyOwner, currentUserEmail, onChanged }) {
  // Every unit, available or not — see the note at the top of this file.
  const units = listing?.unitTypes ?? [];
  const myUnitIds = new Set((listing?.myLeases ?? []).map((l) => l.unitId));
  /*
   * What a landlord who does NOT own the property sees: the units they are
   * letting, plus any unit nobody is offering at all.
   *
   * That second group matters twice over. It is how a landlord claims a vacant
   * apartment in someone else's building — the point of letting anyone add a
   * unit. And without it, a unit you just added yourself vanished the moment it
   * was created: a new unit has no lease, so "units I hold a lease on" excluded
   * it, and the panel insisted nothing had happened while the row sat in the
   * database.
   */
  const visible = isPropertyOwner
    ? units
    : units.filter(
        (u) => myUnitIds.has(u.id) || !(u.leases ?? []).some((l) => !l.unavailable)
      );
  const listingId = listing?._id || listing?.id;

  /*
   * One unit open at a time, selected by id rather than index so adding or
   * removing a unit doesn't silently swap which one is on screen. Stacking every
   * unit vertically made a four-unit building an enormous scroll of near-identical
   * forms with no way to tell where one ended — the same reason browse tabs them.
   */
  const [openId, setOpenId] = useState(null);
  // A unit being described but not yet saved. It gets its own tab so the + is
  // still one click, but nothing reaches the database until the specs are
  // there — a unit with invented beds and baths would show up in browse and
  // match filters it has no business matching.
  const [drafting, setDrafting] = useState(false);
  const [adding, setAdding] = useState(false);
  const justAdded = useRef(null);

  // Keep the selection valid: fall back to the first unit, and jump to a unit
  // this component just created rather than leaving the landlord to find it.
  useEffect(() => {
    if (justAdded.current && visible.some((u) => u.id === justAdded.current)) {
      setOpenId(justAdded.current);
      justAdded.current = null;
      return;
    }
    if (!visible.length) return;
    if (!visible.some((u) => u.id === openId)) setOpenId(visible[0].id);
  }, [visible, openId]);

  const createUnit = async (payload) => {
    setAdding(true);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 means this unit is already on the property. That is an answer, not
        // a failure — open the one that exists rather than making them find it.
        if (res.status === 409 && data.unit?.id) {
          justAdded.current = data.unit.id;
          setDrafting(false);
          toast("That unit is already here — opening it.");
          await onChanged();
          return;
        }
        return toast.error(data.error || "Couldn't add a unit.");
      }
      justAdded.current = data.unit?.id ?? null;
      setDrafting(false);
      toast.success("Unit added — add your listing on it below.");
      await onChanged();
    } catch {
      toast.error("Network error.");
    } finally {
      setAdding(false);
    }
  };

  const addButton = (
    <button
      type="button" onClick={() => setDrafting(true)}
      title="Add a unit to this property"
      aria-label="Add a unit to this property"
      className={`flex shrink-0 items-center gap-1 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
        drafting
          ? "border-red-600 bg-red-600 text-white"
          : "border-gray-200 bg-gray-50 text-gray-500 hover:bg-red-50 hover:text-red-600"
      }`}
    >
      <Plus className="h-4 w-4" />
    </button>
  );

  if (!visible.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 p-5 text-sm text-gray-500">
        <p>
          {isPropertyOwner
            ? "This property has no units yet."
            : "You don't have a listing on any unit at this property."}
        </p>
        <button
          type="button" onClick={() => setDrafting(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-red-300 hover:text-red-600"
        >
          <Plus className="h-3.5 w-3.5" />
          Add a unit
        </button>
        {drafting && (
          <div className="mt-3">
            <NewUnitPanel
              saving={adding}
              onCancel={() => setDrafting(false)}
              onCreate={createUnit}
            />
          </div>
        )}
      </div>
    );
  }

  const openUnit = visible.find((u) => u.id === openId) ?? visible[0];

  return (
    <div className="space-y-3">
      <div className="flex w-full overflow-x-auto rounded-xl bg-white shadow-sm">
        {visible.map((u) => (
          <button
            key={u.id} type="button"
            onClick={() => { setOpenId(u.id); setDrafting(false); }}
            className={`flex-1 whitespace-nowrap border-b-2 px-3 py-2.5 text-center text-sm font-semibold transition ${
              openUnit.id === u.id && !drafting
                ? "border-red-600 bg-red-600 text-white"
                : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
            }`}
          >
            {unitTabLabel(u)}
            {/* A withdrawn unit still gets a tab — it is the only way back to
                one — but it should not look like an active listing. */}
            {!u.available && (
              <span className={`ml-1.5 text-[10px] font-normal ${
                openUnit.id === u.id && !drafting ? "text-red-100" : "text-red-400"}`}>
                hidden
              </span>
            )}
          </button>
        ))}
        {addButton}
      </div>

      {drafting ? (
        <NewUnitPanel
          saving={adding}
          onCancel={() => setDrafting(false)}
          onCreate={createUnit}
        />
      ) : (
        <UnitPanel key={openUnit.id} unit={openUnit} listing={listing}
          isPropertyOwner={isPropertyOwner} currentUserEmail={currentUserEmail}
          onChanged={onChanged} />
      )}
    </div>
  );
}
