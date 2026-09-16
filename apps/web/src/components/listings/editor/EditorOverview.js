"use client";

/*
 * The property's own details — the half of the listing that is true of the
 * building regardless of who is letting which unit.
 *
 * Everything here saves through /property, which cannot reach a unit or an
 * offering. A landlord who only holds a lease sees the same fields read-only:
 * they should know what a renter sees without being able to change a building
 * that isn't theirs.
 *
 * The address is absent on purpose. It identifies the property, and other
 * landlords may have attached offerings to it — editing it would move their
 * listings too. A different address is a different listing.
 */

import { useState } from "react";
import { Plus, X, Check } from "lucide-react";
import toast from "react-hot-toast";

// The amenity/utility columns listing_amenities and listing_utilities store.
// Shown in full so a landlord ticks what applies rather than guessing what the
// search understands.
const AMENITIES = [
  ["air_conditioning", "Air conditioning"], ["dishwasher", "Dishwasher"],
  ["gym", "Gym"], ["laundry", "Laundry"], ["mailroom", "Mailroom"],
  ["microwave", "Microwave"], ["oven", "Oven"], ["parking", "Parking"],
  ["pets_allowed", "Pets allowed"], ["pool", "Pool"],
  ["refrigerator", "Refrigerator"], ["rooftop", "Rooftop"],
  ["storage", "Storage"], ["stove", "Stove"], ["study_room", "Study room"],
];
const UTILITIES = [
  ["electric", "Electric"], ["gas", "Gas"], ["heat", "Heat"], ["water", "Water"],
  ["internet", "Internet"], ["trash", "Trash"], ["cable", "Cable"],
  ["sewer", "Sewer"], ["cooling", "Cooling"],
];
const HOME_TYPES = ["Apartment", "House", "Condo", "Townhouse", "Other"];

function Toggle({ on, onClick, disabled, children }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
        on ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      } ${disabled ? "cursor-default opacity-70 hover:bg-gray-100" : ""}`}
    >
      {children}
    </button>
  );
}

export default function EditorOverview({ listing, canEdit, onChanged }) {
  const listingId = listing?._id || listing?.id;
  const [draft, setDraft] = useState({
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    homeType: listing?.homeType ?? "",
    furnished: !!listing?.furnished,
    subleaseFriendly: !!listing?.subleaseFriendly,
    twentyOnePlus: !!listing?.twentyOnePlus,
    amenities: listing?.amenities ?? [],
    utilitiesIncluded: listing?.utilitiesIncluded ?? [],
    customAmenities: listing?.customAmenities ?? [],
  });
  const [addingCustom, setAddingCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };
  const toggleIn = (key, value) =>
    set({ [key]: draft[key].includes(value)
      ? draft[key].filter((v) => v !== value)
      : [...draft[key], value] });

  const addCustom = () => {
    const label = customText.trim();
    if (!label) return setAddingCustom(false);
    if (!draft.customAmenities.includes(label)) {
      set({ customAmenities: [...draft.customAmenities, label] });
    }
    setCustomText("");
    setAddingCustom(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/property`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Couldn't save those details.");
      toast.success("Property details saved.");
      setDirty(false);
      await onChanged();
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-red-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500";

  return (
    <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-gray-900">Property details</h3>
        {!canEdit && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
            Managed by the property owner
          </span>
        )}
        {canEdit && dirty && (
          <button
            onClick={save} disabled={saving}
            className="ml-auto rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save details"}
          </button>
        )}
      </div>

      {/* The address is shown so the landlord knows what they're editing, but is
          never an input — see the note at the top of this file. */}
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Address</span>
        <p className="mt-0.5 text-sm text-gray-700">{listing?.address}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Name</span>
          <input className={`mt-1 ${field}`} value={draft.title} disabled={!canEdit}
            placeholder="e.g. The Pershing"
            onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Home type</span>
          <select className={`mt-1 ${field}`} value={draft.homeType} disabled={!canEdit}
            onChange={(e) => set({ homeType: e.target.value })}>
            <option value="">—</option>
            {HOME_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Description</span>
        <textarea rows={4} className={`mt-1 ${field}`} value={draft.description} disabled={!canEdit}
          onChange={(e) => set({ description: e.target.value })} />
      </label>

      <div className="flex flex-wrap gap-2">
        <Toggle on={draft.furnished} disabled={!canEdit} onClick={() => set({ furnished: !draft.furnished })}>
          Furnished
        </Toggle>
        <Toggle on={draft.subleaseFriendly} disabled={!canEdit} onClick={() => set({ subleaseFriendly: !draft.subleaseFriendly })}>
          Subletting allowed
        </Toggle>
        <Toggle on={draft.twentyOnePlus} disabled={!canEdit} onClick={() => set({ twentyOnePlus: !draft.twentyOnePlus })}>
          21+
        </Toggle>
      </div>

      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Amenities</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {AMENITIES.map(([value, label]) => (
            <Toggle key={value} on={draft.amenities.includes(value)} disabled={!canEdit}
              onClick={() => toggleIn("amenities", value)}>{label}</Toggle>
          ))}
          {draft.customAmenities.map((label) => (
            <span key={label}
              className="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
              {label}
              {canEdit && (
                <button type="button" aria-label={`Remove ${label}`}
                  onClick={() => set({ customAmenities: draft.customAmenities.filter((c) => c !== label) })}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          {/* Anything the fixed list doesn't cover. */}
          {canEdit && (addingCustom ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1">
              <input autoFocus value={customText} placeholder="Add your own"
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addCustom(); if (e.key === "Escape") setAddingCustom(false); }}
                className="w-32 bg-transparent text-xs focus:outline-none" />
              <button type="button" onClick={addCustom} aria-label="Add amenity">
                <Check className="h-3.5 w-3.5 text-green-600" />
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setAddingCustom(true)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-red-300 hover:text-red-600">
              <Plus className="h-3 w-3" /> Custom
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Utilities included</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {UTILITIES.map(([value, label]) => (
            <Toggle key={value} on={draft.utilitiesIncluded.includes(value)} disabled={!canEdit}
              onClick={() => toggleIn("utilitiesIncluded", value)}>{label}</Toggle>
          ))}
        </div>
      </div>
    </section>
  );
}
