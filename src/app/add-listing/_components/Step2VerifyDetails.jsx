"use client";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import FieldStateBadge from "./FieldStateBadge";

const AMENITY_LABELS = {
  air_conditioning:"Air conditioning", dishwasher:"Dishwasher", gym:"Gym",
  laundry:"Laundry", mailroom:"Mailroom", microwave:"Microwave", oven:"Oven",
  parking:"Parking", pets_allowed:"Pets allowed", pool:"Pool",
  refrigerator:"Refrigerator", rooftop:"Rooftop", storage:"Storage",
  stove:"Stove", study_room:"Study room",
};

/** Inline-editable field. Shows current value with a state badge overlay. */
function EditableField({ label, value, state = "empty", suggestedValue, onSave, onConfirm, onReject, multiline = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || suggestedValue || "");

  const save = async () => {
    if (!draft.trim()) return;
    await onSave?.(draft.trim());
    setEditing(false);
  };

  const confirm = async () => {
    await onConfirm?.();
  };

  return (
    <div className="group relative mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <FieldStateBadge
          state={state}
          compact
          showActions={state === "ai_suggested" && !editing}
          suggestedValue={suggestedValue}
          onConfirm={confirm}
          onEdit={() => { setDraft(suggestedValue || value || ""); setEditing(true); }}
          onReject={onReject}
        />
      </div>

      {editing ? (
        <div className="space-y-2">
          {multiline ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              className="w-full px-3 py-2 border border-red-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          ) : (
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 border border-red-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          )}
          <div className="flex gap-2">
            <button onClick={save} className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">Save</button>
            <button onClick={() => setEditing(false)} className="px-3 py-1 text-xs text-gray-600 hover:text-gray-900">Cancel</button>
          </div>
        </div>
      ) : (
        <div
          className={`text-sm rounded-md px-3 py-2 cursor-pointer
            ${value ? "text-gray-900 bg-gray-50 hover:bg-gray-100" : "text-gray-400 italic bg-gray-50 hover:bg-gray-100"}
            border border-transparent hover:border-gray-200 transition group`}
          onClick={() => { setDraft(value || suggestedValue || ""); setEditing(true); }}
        >
          {value || <span className="text-gray-400">Click to add {label.toLowerCase()}</span>}
          <span className="text-xs text-gray-400 ml-2 opacity-0 group-hover:opacity-100 transition">Edit</span>
        </div>
      )}
    </div>
  );
}

export default function Step5VerifyDetails({ state, dispatch, onNext, onBack }) {
  const { listingId, fieldStates } = state;
  const [listing, setListing] = useState(state.listing);
  const [amenities, setAmenities] = useState({});
  const [petPolicy, setPetPolicy] = useState("");
  const [images, setImages] = useState([]);
  const [imgIdx, setImgIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!listingId) return;
    setLoading(true);
    try {
      const [listingRes, amenRes, ppRes, fsRes] = await Promise.all([
        fetch(`/api/listing/${listingId}`),
        fetch(`/api/landlord/listings/${listingId}/field-states`),
        fetch(`/api/landlord/listings/${listingId}/pet-policy`),
        fetch(`/api/landlord/listings/${listingId}/field-states`),
      ]);

      if (listingRes.ok) {
        const l = await listingRes.json();
        setListing(l);
        setAmenities(Object.fromEntries(l.amenities?.map((a) => [a, true]) || []));
        setImages(l.images || []);
        dispatch({ type: "SET_LISTING_DATA", data: l });
      }
      if (ppRes.ok) {
        const pp = await ppRes.json();
        setPetPolicy(pp.policy_text || "");
      }
      if (amenRes.ok) {
        const fs = await amenRes.json();
        const map = {};
        for (const row of fs) map[`${row.table_name}.${row.field_name}`] = row;
        dispatch({ type: "FIELD_STATES", fieldStates: map });
      }
    } finally {
      setLoading(false);
    }
  }, [listingId, dispatch]);

  useEffect(() => { refresh(); }, [refresh]);

  const getFieldState = (table, field) => fieldStates[`${table}.${field}`] || null;
  const fieldStateName = (table, field) => getFieldState(table, field)?.state || "empty";
  const suggestedVal = (table, field) => getFieldState(table, field)?.suggested_value || null;

  const confirmField = async (tableName, recordId, fieldName) => {
    await fetch(`/api/landlord/listings/${listingId}/field-states`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table_name: tableName, record_id: recordId, field_name: fieldName, state: "confirmed" }),
    });
    await refresh();
    toast.success("Field confirmed");
  };

  const rejectField = async (tableName, recordId, fieldName) => {
    await fetch(`/api/landlord/listings/${listingId}/field-states`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table_name: tableName, record_id: recordId, field_name: fieldName, state: "rejected" }),
    });
    await refresh();
  };

  const saveListingField = async (field, value) => {
    await fetch(`/api/landlord/listings/${listingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    await confirmField("listings", listingId, field);
  };

  const savePetPolicy = async (value) => {
    await fetch(`/api/landlord/listings/${listingId}/pet-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy_text: value }),
    });
    setPetPolicy(value);
    await confirmField("listing_pet_policies", listingId, "policy_text");
  };

  const toggleAmenity = async (key) => {
    const next = { ...amenities, [key]: !amenities[key] };
    setAmenities(next);
    const amenityArr = Object.entries(next).filter(([, v]) => v).map(([k]) => k);
    await fetch(`/api/landlord/listings/${listingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amenities: amenityArr }),
    });
    await confirmField("listing_amenities", listingId, key);
  };

  const aiSuggestedCount = Object.values(fieldStates).filter((f) => f.state === "ai_suggested").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
        <span className="w-5 h-5 border-2 border-gray-300 border-t-red-500 rounded-full animate-spin mr-2" />
        Loading preview…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Review & confirm your listing</h2>
          <p className="text-sm text-gray-500 mt-0.5">This is how students will see it. Edit any field directly.</p>
        </div>
        {aiSuggestedCount > 0 && (
          <span className="text-xs bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full font-medium">
            {aiSuggestedCount} field{aiSuggestedCount !== 1 ? "s" : ""} need review
          </span>
        )}
      </div>

      {/* Image preview */}
      {images.length > 0 && (
        <div className="relative rounded-xl overflow-hidden aspect-video bg-gray-100">
          <img src={images[imgIdx]} alt="" className="w-full h-full object-cover" />
          {images.length > 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
              {images.map((_, i) => (
                <button key={i} onClick={() => setImgIdx(i)}
                  className={`w-2 h-2 rounded-full transition ${i === imgIdx ? "bg-white" : "bg-white/50"}`} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Core listing fields */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-1">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Core details</h3>
        <EditableField
          label="Title"
          value={listing?.title}
          state={fieldStateName("listings", "title")}
          suggestedValue={suggestedVal("listings", "title")}
          onSave={(v) => saveListingField("title", v)}
          onConfirm={() => confirmField("listings", listingId, "title")}
          onReject={() => rejectField("listings", listingId, "title")}
        />
        <EditableField
          label="Description"
          value={listing?.description}
          state={fieldStateName("listings", "description")}
          suggestedValue={suggestedVal("listings", "description")}
          multiline
          onSave={(v) => saveListingField("description", v)}
          onConfirm={() => confirmField("listings", listingId, "description")}
          onReject={() => rejectField("listings", listingId, "description")}
        />
        <EditableField
          label="Contact name"
          value={listing?.contactName}
          state={fieldStateName("listings", "contact_name")}
          onSave={(v) => saveListingField("contact_name", v)}
        />
        <EditableField
          label="Contact email"
          value={listing?.contactEmail}
          state={fieldStateName("listings", "contact_email")}
          onSave={(v) => saveListingField("contact_email", v)}
        />
        <EditableField
          label="Contact phone"
          value={listing?.contactPhone}
          state={fieldStateName("listings", "contact_phone")}
          onSave={(v) => saveListingField("contact_phone", v)}
        />
      </div>

      {/* Pet policy */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Pet policy</h3>
        <EditableField
          label="Policy text"
          value={petPolicy}
          state={fieldStateName("listing_pet_policies", "policy_text")}
          suggestedValue={suggestedVal("listing_pet_policies", "policy_text")}
          multiline
          onSave={savePetPolicy}
          onConfirm={() => confirmField("listing_pet_policies", listingId, "policy_text")}
          onReject={() => rejectField("listing_pet_policies", listingId, "policy_text")}
        />
      </div>

      {/* Amenities */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Amenities</h3>
          {Object.values(AMENITY_LABELS).length > 0 && (
            <span className="text-xs text-gray-400">Click to toggle</span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(AMENITY_LABELS).map(([key, label]) => {
            const fState = fieldStateName("listing_amenities", key);
            const isOn = !!amenities[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleAmenity(key)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition
                  ${isOn ? "bg-green-50 border-green-200 text-green-800" : "bg-gray-50 border-gray-200 text-gray-500"}`}
              >
                <span>{label}</span>
                <div className="flex items-center gap-1.5">
                  {fState === "ai_suggested" && (
                    <span className="text-xs bg-yellow-100 text-yellow-600 px-1 rounded">AI</span>
                  )}
                  <span>{isOn ? "✓" : "○"}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">← Back</button>
        <button onClick={onNext} className="px-6 py-2 bg-red-600 text-white rounded-md font-medium hover:bg-red-700 text-sm transition">
          Continue →
        </button>
      </div>
    </div>
  );
}
