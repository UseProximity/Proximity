"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import AddressSearchInput from "@/components/AddressSearchInput";

// ─── UnitTypesSelector ────────────────────────────────────────────────────────
// Lets the user enter beds/baths to build a list of unit types in #BR / #BA format.

function UnitTypesSelector({ value, onChange }) {
  const [beds, setBeds] = useState("");
  const [baths, setBaths] = useState("");

  const units = Array.isArray(value) ? value : [];

  function unitLabel(u) {
    return `${u.bedrooms}BR / ${u.bathrooms}BA`;
  }

  function addUnit() {
    const b = Number(beds);
    const ba = Number(baths);
    if (beds === "" || baths === "" || isNaN(b) || isNaN(ba) || b < 0 || ba < 0) return;
    onChange([...units, { name: `${b}BR / ${ba}BA`, bedrooms: b, bathrooms: ba, rent: null, area: null }]);
    setBeds("");
    setBaths("");
  }

  function removeUnit(idx) {
    onChange(units.filter((_, i) => i !== idx));
  }

  function updateField(idx, key, val) {
    const next = [...units];
    next[idx] = { ...next[idx], [key]: val === "" ? null : Number(val) };
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Add a unit type */}
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min="0"
          placeholder="Beds"
          value={beds}
          onChange={(e) => setBeds(e.target.value)}
          className="w-16 px-2 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
        />
        <span className="text-xs text-gray-400">BR /</span>
        <input
          type="number"
          min="0"
          placeholder="Baths"
          value={baths}
          onChange={(e) => setBaths(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addUnit())}
          className="w-16 px-2 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
        />
        <span className="text-xs text-gray-400">BA</span>
        <button
          type="button"
          onClick={addUnit}
          disabled={beds === "" || baths === ""}
          className="px-2.5 py-0.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Add
        </button>
      </div>

      {/* Added unit types with rent/area inputs */}
      {units.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {units.map((u, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1">
              <span className="font-medium text-gray-700 min-w-[80px]">{unitLabel(u)}</span>
              <input
                type="number"
                placeholder="Rent ($)"
                value={u.rent ?? ""}
                onChange={(e) => updateField(idx, "rent", e.target.value)}
                className="w-24 px-2 py-0.5 border border-gray-300 rounded focus:outline-none focus:border-blue-400"
              />
              <input
                type="number"
                placeholder="Area (sqft)"
                value={u.area ?? ""}
                onChange={(e) => updateField(idx, "area", e.target.value)}
                className="w-24 px-2 py-0.5 border border-gray-300 rounded focus:outline-none focus:border-blue-400"
              />
              <button
                type="button"
                onClick={() => removeUnit(idx)}
                className="ml-auto text-gray-400 hover:text-red-500 text-sm leading-none"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
// type: "id" | "readonly" | "text" | "number" | "boolean" | "json" | "enum"
// enum fields also carry an `options` array of allowed values

const SCHEMAS = {
  users: [
    { key: "_id",            label: "ID",              type: "id"       },
    { key: "name",           label: "Name",            type: "text",    required: true  },
    { key: "email",          label: "Email",           type: "text",    required: true  },
    { key: "role",           label: "Role",            type: "enum",    options: ["student", "landlord", "super"] },
    { key: "phone",          label: "Phone",           type: "text"     },
    { key: "gender",         label: "Gender",          type: "enum",    options: ["unspecified", "male", "female", "other"] },
    { key: "birthday",       label: "Birthday",        type: "text"     },
    { key: "description",    label: "Bio",             type: "text"     },
    { key: "referralSource", label: "Referral Source", type: "text"     },
    { key: "profileComplete",label: "Profile Complete",type: "boolean"  },
    { key: "rating",         label: "Rating",          type: "number"   },
    { key: "numReviews",     label: "# Reviews",       type: "number"   },
    { key: "image",          label: "Image URL",       type: "text"     },
    { key: "listings",       label: "Listings",        type: "json"     },
    { key: "favorites",      label: "Favorites",       type: "json"     },
    { key: "contacted",      label: "Contacted",       type: "json"     },
    { key: "reviews",        label: "Reviews",         type: "json"     },
    { key: "createdAt",      label: "Created",         type: "readonly" },
    { key: "updatedAt",      label: "Updated",         type: "readonly" },
  ],
  listings: [
    { key: "_id",              label: "ID",                type: "id"       },
    { key: "title",            label: "Title",             type: "text"     },
    { key: "address",          label: "Address",           type: "text",    required: true  },
    { key: "homeType",         label: "Home Type",         type: "enum",    options: ["apartment", "house", "condo", "townhouse"] },
    { key: "leaseType",        label: "Lease Type",        type: "enum",    options: ["standard", "sublease"] },
    { key: "leaseAvailability",label: "Lease Availability",type: "enum",    options: ["semester", "10-month", "12-month"] },
    { key: "leaseStructure",   label: "Lease Structure",   type: "enum",    options: ["individual", "joint"] },
    { key: "moveInDate",       label: "Move-in Date",      type: "text"     },
    { key: "furnished",        label: "Furnished",         type: "boolean"  },
    { key: "utilitiesIncluded",label: "Utilities Included",type: "multi-enum", options: ["water", "sewer", "trash", "internet", "electric", "gas", "hotWater", "yardCare"] },
    { key: "subleaseFriendly", label: "Sublease Friendly", type: "boolean"  },
    { key: "unavailable",      label: "Unavailable",       type: "boolean"  },
    { key: "minRent",          label: "Min Rent",          type: "number"   },
    { key: "maxRent",          label: "Max Rent",          type: "number"   },
    { key: "minBedrooms",      label: "Min Beds",          type: "number"   },
    { key: "maxBedrooms",      label: "Max Beds",          type: "number"   },
    { key: "minBathrooms",     label: "Min Baths",         type: "number"   },
    { key: "maxBathrooms",     label: "Max Baths",         type: "number"   },
    { key: "minArea",          label: "Min Area (sqft)",   type: "number"   },
    { key: "maxArea",          label: "Max Area (sqft)",   type: "number"   },
    { key: "rating",           label: "Rating",            type: "number"   },
    { key: "numReviews",       label: "# Reviews",         type: "number"   },
    { key: "numSaves",         label: "# Saves",           type: "number"   },
    { key: "numClicks",        label: "# Clicks",          type: "number"   },
    { key: "shuttleWalkMinutes",label:"Shuttle Walk (min)", type: "number"  },
    { key: "latitude",         label: "Latitude",          type: "number"   },
    { key: "longitude",        label: "Longitude",         type: "number"   },
    { key: "contactEmail",     label: "Contact Email",     type: "text"     },
    { key: "contactPhone",     label: "Contact Phone",     type: "text"     },
    { key: "contactName",      label: "Contact Name",      type: "text"     },
    { key: "description",      label: "Description",       type: "text",    required: true  },
    { key: "owner",            label: "Owner ID",          type: "text"     },
    { key: "landlord",         label: "Landlord ID",       type: "text"     },
    { key: "unitTypes",        label: "Unit Types",        type: "json",    required: true  },
    { key: "images",           label: "Images",            type: "images"   },
    { key: "reviews",          label: "Reviews",           type: "json"     },
    { key: "placeWalkMinutes", label: "Place Walk Times",  type: "json"     },
    { key: "amenities",        label: "Amenities",         type: "multi-enum", options: ["dishwasher","in_unit_laundry","refrigerator","stove","oven","microwave","ac_heating","mailroom","pets_allowed","extra_storage","fireplace","private_parking","pool","study_room","gym"] },
    { key: "createdAt",        label: "Created",           type: "readonly" },
  ],
  reviews: [
    { key: "_id",                label: "ID",             type: "id"       },
    { key: "reviewer",           label: "Reviewer ID",    type: "text",    required: true  },
    { key: "reviewedUser",       label: "Reviewed User",  type: "text"     },
    { key: "listing",            label: "Listing ID",     type: "text"     },
    { key: "rating",             label: "Rating",         type: "number",  required: true  },
    { key: "comment",            label: "Comment",        type: "text",    required: true  },
    { key: "legitimacy",         label: "Verified",       type: "boolean"  },
    { key: "communicationRating",label: "Communication",  type: "number"   },
    { key: "locationRating",     label: "Location",       type: "number"   },
    { key: "valueRating",        label: "Value",          type: "number"   },
    { key: "createdAt",          label: "Created",        type: "readonly" },
    { key: "updatedAt",          label: "Updated",        type: "readonly" },
  ],
  dorms: [
    { key: "_id",        label: "ID",          type: "id"       },
    { key: "name",       label: "Name",        type: "text",    required: true  },
    { key: "description",label: "Description", type: "text"     },
    { key: "image",      label: "Image URL",   type: "text"     },
    { key: "roomTypes",  label: "Room Types",  type: "json"     },
    { key: "tags",       label: "Tags",        type: "json"     },
    { key: "createdAt",  label: "Created",     type: "readonly" },
    { key: "updatedAt",  label: "Updated",     type: "readonly" },
  ],
  dormreviews: [
    { key: "_id",      label: "ID",          type: "id"       },
    { key: "name",     label: "Author Name", type: "text",    required: true  },
    { key: "classYear",label: "Class Year",  type: "number",  required: true  },
    { key: "rating",   label: "Rating",      type: "number",  required: true  },
    { key: "dorm",     label: "Dorm",        type: "text",    required: true  },
    { key: "dormType", label: "Room Type",   type: "text"     },
    { key: "tags",     label: "Tags",        type: "json"     },
    { key: "content",  label: "Content",     type: "text",    required: true  },
    { key: "createdAt",label: "Created",     type: "readonly" },
    { key: "updatedAt",label: "Updated",     type: "readonly" },
  ],
  testimonials: [
    { key: "_id",      label: "ID",     type: "id"       },
    { key: "text",     label: "Text",   type: "text",    required: true  },
    { key: "author",   label: "Author", type: "text",    required: true  },
    { key: "rating",   label: "Rating", type: "number",  required: true  },
    { key: "createdAt",label: "Created",type: "readonly" },
    { key: "updatedAt",label: "Updated",type: "readonly" },
  ],
};

const TABLES = Object.keys(SCHEMAS);

// ─── Cell Input Components ─────────────────────────────────────────────────────

function ExpandingTextarea({ value, onChange, className }) {
  const ref = useRef(null);

  function resize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => { onChange(e.target.value); resize(); }}
      onFocus={resize}
      onBlur={(e) => { e.target.style.height = ""; }}
      className={`resize-none overflow-hidden ${className}`}
    />
  );
}

function EnumDropdown({ options, current, changed, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(e.target))
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleToggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
    }
    setOpen((o) => !o);
  }

  return (
    <div className="relative min-w-[110px]">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={`w-full flex items-center justify-between gap-1 px-2 py-0.5 rounded text-xs text-left focus:outline-none ${
          changed
            ? "border border-amber-400 bg-amber-50"
            : "border border-gray-300 bg-white hover:border-blue-400"
        }`}
      >
        <span className={current ? "text-gray-800" : "text-gray-400"}>
          {current || "—"}
        </span>
        <svg className="w-3 h-3 text-gray-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded shadow-lg"
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 ${
                current === opt ? "font-semibold text-blue-600" : "text-gray-700"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Normalizes legacy ALL_CAPS amenity values to snake_case
const AMENITY_NORMALIZE = {
  "DISHWASHER":      "dishwasher",
  "IN-UNIT LAUNDRY": "in_unit_laundry",
  "IN UNIT LAUNDRY": "in_unit_laundry",
  "MAILROOM":        "mailroom",
  "PETS ALLOWED":    "pets_allowed",
  "EXTRA STORAGE":   "extra_storage",
  "FIREPLACE":       "fireplace",
  "FREE PARKING":    "private_parking",
  "POOL":            "pool",
  "STUDY ROOMS":     "study_room",
  "GYM":             "gym",
};

function MultiEnumDropdown({ options, current, changed, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);

  // Normalise: current may be an array or a JSON string; also map legacy values
  const rawArray = Array.isArray(current)
    ? current
    : (typeof current === "string" && current.startsWith("["))
      ? (() => { try { return JSON.parse(current); } catch { return []; } })()
      : [];
  const selected = rawArray.map((v) => AMENITY_NORMALIZE[v] ?? v);

  useEffect(() => {
    function handleClick(e) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(e.target))
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleToggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
    }
    setOpen((o) => !o);
  }

  function toggle(opt) {
    const next = selected.includes(opt)
      ? selected.filter((v) => v !== opt)
      : [...selected, opt];
    onChange(next);
  }

  return (
    <div className="relative min-w-[140px]">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={`w-full flex items-center justify-between gap-1 px-2 py-0.5 rounded text-xs text-left focus:outline-none ${
          changed
            ? "border border-amber-400 bg-amber-50"
            : "border border-gray-300 bg-white hover:border-blue-400"
        }`}
      >
        <span className={selected.length ? "text-gray-800" : "text-gray-400"}>
          {selected.length ? `${selected.length} selected` : "None"}
        </span>
        <svg className="w-3 h-3 text-gray-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: 180, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded shadow-lg py-1"
        >
          {options.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-blue-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  className="w-3 h-3 accent-blue-600"
                />
                <span className={checked ? "font-medium text-blue-700" : "text-gray-700"}>
                  {opt}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FieldInput({ fieldDef, value, pendingValue, onChange }) {
  const { type } = fieldDef;
  const current = pendingValue !== undefined ? pendingValue : value;
  const changed = pendingValue !== undefined;

  const baseText = `w-full px-2 py-0.5 rounded text-xs focus:outline-none ${
    changed
      ? "border border-amber-400 bg-amber-50"
      : "border border-transparent hover:border-gray-300 focus:border-blue-400"
  }`;

  if (type === "enum") {
    return (
      <EnumDropdown
        options={fieldDef.options}
        current={current == null ? "" : String(current)}
        changed={changed}
        onChange={onChange}
      />
    );
  }

  if (type === "multi-enum") {
    return (
      <MultiEnumDropdown
        options={fieldDef.options}
        current={current}
        changed={changed}
        onChange={onChange}
      />
    );
  }

  if (type === "id") {
    return (
      <span className="block px-2 py-0.5 text-gray-400 font-mono text-xs whitespace-nowrap">
        {current == null ? "" : String(current)}
      </span>
    );
  }

  if (type === "readonly") {
    const display = current == null ? "" : (
      typeof current === "object" ? new Date(current).toLocaleString() : String(current)
    );
    return (
      <span className="block px-2 py-0.5 text-gray-400 text-xs whitespace-nowrap">
        {display}
      </span>
    );
  }

  if (type === "boolean") {
    const checked = current === true || current === "true";
    return (
      <div className="flex items-center justify-center px-2 py-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className={`w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer ${changed ? "outline outline-2 outline-amber-400" : ""}`}
        />
      </div>
    );
  }

  if (type === "number") {
    return (
      <input
        type="number"
        value={current == null ? "" : String(current)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={`${baseText} min-w-[80px]`}
        step="any"
      />
    );
  }

  if (type === "json") {
    const display = current == null ? "" : (
      typeof current === "object" ? JSON.stringify(current) : String(current)
    );
    return (
      <ExpandingTextarea
        value={display}
        onChange={(v) => onChange(v)}
        className={`${baseText} min-w-[120px] font-mono`}
      />
    );
  }

  if (type === "images") {
    const imgs = Array.isArray(current)
      ? current
      : (typeof current === "string" && current.startsWith("[")
        ? (() => { try { return JSON.parse(current); } catch { return []; } })()
        : []);
    return (
      <button
        type="button"
        onClick={() => onChange("__open_panel__")}
        className="px-2 py-0.5 text-xs rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 whitespace-nowrap"
      >
        View all ({imgs.length})
      </button>
    );
  }

  // text (default)
  const display = current == null ? "" : String(current);
  return (
    <ExpandingTextarea
      value={display}
      onChange={(v) => onChange(v)}
      className={`${baseText} min-w-[100px]`}
    />
  );
}

// ─── Image Manager Panel ───────────────────────────────────────────────────────

function ImageManagerPanel({ listingId, initialImages, db, onClose, onSaved }) {
  const [images, setImages] = useState(Array.isArray(initialImages) ? initialImages : []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renamingUrl, setRenamingUrl] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [panelError, setPanelError] = useState(null);

  function getFilename(url) {
    try {
      const parts = url.split("/");
      const last = parts[parts.length - 1];
      const dashIdx = last.indexOf("-");
      return dashIdx !== -1 ? last.slice(dashIdx + 1) : last;
    } catch {
      return url;
    }
  }

  function moveUp(idx) {
    if (idx === 0) return;
    setImages((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }

  function moveDown(idx) {
    setImages((prev) => {
      if (idx === prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  async function handleDelete(url) {
    const warning = db === "prod"
      ? "⚠️ PRODUCTION: Delete this image? This will permanently remove it from the live site and cannot be undone."
      : "Delete this image? This cannot be undone.";
    if (!confirm(warning)) return;
    setPanelError(null);
    try {
      const res = await fetch("/api/admin/listing-images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, imageUrl: url, db }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setImages(data.images);
    } catch (e) {
      setPanelError(e.message);
    }
  }

  function startRename(url) {
    setRenamingUrl(url);
    setRenameValue(getFilename(url));
  }

  async function confirmRename() {
    if (!renameValue.trim() || !renamingUrl) return;
    setPanelError(null);
    try {
      const res = await fetch("/api/admin/listing-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, oldUrl: renamingUrl, newFilename: renameValue.trim(), db }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rename failed");
      setImages((prev) => prev.map((u) => (u === renamingUrl ? data.newUrl : u)));
      setRenamingUrl(null);
    } catch (e) {
      setPanelError(e.message);
    }
  }

  async function handleUpload(files) {
    if (!files || files.length === 0) return;
    if (db === "prod" && !confirm(`⚠️ PRODUCTION: Upload ${files.length} photo(s) to the live site?`)) return;
    setUploading(true);
    setPanelError(null);
    try {
      const fd = new FormData();
      fd.append("listingId", listingId);
      fd.append("db", db || "dev");
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/upload", { method: "PATCH", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setImages((prev) => [...prev, ...(data.urls || [])]);
    } catch (e) {
      setPanelError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (db === "prod" && !confirm("⚠️ PRODUCTION: Save this image order to the live site?")) return;
    setSaving(true);
    setPanelError(null);
    try {
      const res = await fetch("/api/admin/listing-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, images, db }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved(data.images);
    } catch (e) {
      setPanelError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-2xl bg-white h-full flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Manage Photos</h2>
            <p className="text-xs text-gray-500 mt-0.5">{images.length} image{images.length !== 1 ? "s" : ""} · {listingId}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-500">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        {db === "prod" && (
          <div className="mx-0 px-5 py-2.5 bg-red-600 text-white text-xs font-semibold flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
            PRODUCTION DATABASE — changes are live and permanent
          </div>
        )}

        {panelError && (
          <div className="mx-5 mt-3 px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
            {panelError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {images.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-10">No images yet</p>
          )}
          {images.map((url, idx) => (
            <div key={url + idx} className="flex items-center gap-3 p-2 border border-gray-200 rounded-lg bg-white hover:bg-gray-50">
              <img
                src={url}
                alt={`img-${idx}`}
                className="w-16 h-12 object-cover rounded border border-gray-200 flex-shrink-0"
                onError={(e) => { e.target.style.display = "none"; }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-700 mb-0.5">#{idx + 1}</p>
                {renamingUrl === url ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setRenamingUrl(null); }}
                      autoFocus
                      className="flex-1 border border-blue-400 rounded px-2 py-0.5 text-xs focus:outline-none"
                    />
                    <button onClick={confirmRename} className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                    <button onClick={() => setRenamingUrl(null)} className="px-2 py-0.5 text-xs border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 truncate">{getFilename(url)}</p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => moveUp(idx)} disabled={idx === 0} title="Move up" className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd"/></svg>
                </button>
                <button onClick={() => moveDown(idx)} disabled={idx === images.length - 1} title="Move down" className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                </button>
                <button onClick={() => startRename(url)} title="Rename" className="p-1 rounded hover:bg-gray-200 text-gray-500">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
                </button>
                <button onClick={() => handleDelete(url)} title="Delete" className="p-1 rounded hover:bg-red-100 text-red-500">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-gray-200">
          <label className={`flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed rounded-lg cursor-pointer text-sm transition-colors ${uploading ? "border-gray-200 text-gray-400 cursor-not-allowed" : "border-blue-300 text-blue-600 hover:bg-blue-50"}`}>
            {uploading ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                Uploading…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
                Add Photos
              </>
            )}
            <input type="file" accept="image/*" multiple disabled={uploading} className="hidden" onChange={(e) => handleUpload(Array.from(e.target.files || []))} />
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [activeTable, setActiveTable] = useState("users");
  const [activeDb, setActiveDb] = useState("prod");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [searchColumn, setSearchColumn] = useState("all");
  const [pendingChanges, setPendingChanges] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(SCHEMAS["users"].map((f) => f.key)));
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [imagePanel, setImagePanel] = useState(null);
  const colPickerRef = useRef(null);
  const [addRowOpen, setAddRowOpen] = useState(false);
  const [addRowFields, setAddRowFields] = useState({});
  const [addRowError, setAddRowError] = useState(null);
  const [addRowSaving, setAddRowSaving] = useState(false);

  const schema = SCHEMAS[activeTable] || [];
  const visibleSchema = schema.filter((f) => visibleColumns.has(f.key));

  useEffect(() => {
    function handleOutsideClick(e) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target)) {
        setColPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const loadTable = useCallback(async (table, db) => {
    setLoading(true);
    setError(null);
    setPendingChanges({});
    setSearch("");
    setSearchColumn("all");
    setSaveStatus(null);
    setVisibleColumns(new Set((SCHEMAS[table] || []).map((f) => f.key)));
    try {
      const res = await fetch(`/api/admin/${table}?db=${db}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTable(activeTable, activeDb);
  }, [activeTable, activeDb, loadTable]);

  useEffect(() => {
    if (addRowOpen) {
      setAddRowOpen(false);
      setAddRowFields({});
      setAddRowError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTable]);

  function cellString(row, key) {
    const v = row[key];
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  const filteredRows = rows.filter((row) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const cols = searchColumn === "all" ? schema.map((f) => f.key) : [searchColumn];
    return cols.some((key) => cellString(row, key).toLowerCase().includes(q));
  });

  function handleCellChange(rowId, key, value) {
    if (key === "images" && value === "__open_panel__") {
      const row = rows.find((r) => r._id === rowId);
      const imgs = Array.isArray(row?.images) ? row.images : [];
      setImagePanel({ listingId: rowId, images: imgs });
      return;
    }
    setPendingChanges((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] || {}), [key]: value },
    }));
    setSaveStatus(null);
  }

  async function handleConfirmUpdates() {
    const entries = Object.entries(pendingChanges);
    if (entries.length === 0) return;
    setSaving(true);
    setSaveStatus(null);
    let failed = 0;
    for (const [id, updates] of entries) {
      try {
        const res = await fetch(`/api/admin/${activeTable}?db=${activeDb}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, updates }),
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
    }
    // When saving listings, also normalize any legacy amenity values in the DB
    let migrateMsg = "";
    if (activeTable === "listings") {
      try {
        const res = await fetch(`/api/admin/migrate-amenities?db=${activeDb}`, { method: "POST" });
        const data = await res.json();
        if (!data.error && data.migrated > 0) {
          migrateMsg = ` · ${data.migrated} amenity row(s) normalized`;
        }
      } catch { /* non-fatal */ }
    }
    setSaving(false);
    if (failed === 0) {
      setSaveStatus({ ok: true, msg: `${entries.length} row(s) saved.${migrateMsg}` });
      setPendingChanges({});
      loadTable(activeTable, activeDb);
    } else {
      setSaveStatus({ ok: false, msg: `${failed} row(s) failed to save.` });
    }
  }

  const pendingCount = Object.keys(pendingChanges).length;

  function openAddRow() {
    const initial = {};
    for (const f of schema) {
      if (f.type === "id" || f.type === "readonly") continue;
      if (f.type === "boolean") initial[f.key] = false;
      else if (f.type === "multi-enum") initial[f.key] = [];
      else if (activeTable === "listings" && f.key === "unitTypes") initial[f.key] = [];
      else initial[f.key] = "";
    }
    setAddRowFields(initial);
    setAddRowError(null);
    setAddRowSaving(false);
    setAddRowOpen(true);
  }

  async function handleAddRowSubmit(e) {
    e.preventDefault();
    setAddRowSaving(true);
    setAddRowError(null);
    try {
      const res = await fetch(`/api/admin/${activeTable}?db=${activeDb}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: addRowFields }),
      });
      if (res.status === 201) {
        setAddRowOpen(false);
        setAddRowFields({});
        loadTable(activeTable, activeDb);
      } else {
        const data = await res.json().catch(() => ({}));
        setAddRowError(data.error || `Error ${res.status}`);
      }
    } catch (err) {
      setAddRowError(err.message || "Request failed");
    } finally {
      setAddRowSaving(false);
    }
  }

  return (
    <>
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">Admin Dashboard</h1>
          <div className="flex rounded overflow-hidden border border-gray-600 text-xs font-semibold">
            <button
              onClick={() => setActiveDb("prod")}
              className={`px-3 py-1 transition-colors ${activeDb === "prod" ? "bg-red-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
            >
              PROD
            </button>
            <button
              onClick={() => setActiveDb("dev")}
              className={`px-3 py-1 transition-colors ${activeDb === "dev" ? "bg-green-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
            >
              DEV
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {saveStatus && (
            <span className={`text-sm font-medium ${saveStatus.ok ? "text-green-400" : "text-red-400"}`}>
              {saveStatus.msg}
            </span>
          )}
          {pendingCount > 0 && (
            <span className="text-sm text-amber-400">
              {pendingCount} row{pendingCount !== 1 ? "s" : ""} with unsaved changes
            </span>
          )}
          <button
            onClick={openAddRow}
            className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 text-white rounded font-medium"
          >
            + Add Row
          </button>
          <button
            onClick={() => { setPendingChanges({}); setSaveStatus(null); }}
            disabled={pendingCount === 0}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Discard
          </button>
          <button
            onClick={handleConfirmUpdates}
            disabled={saving || pendingCount === 0}
            className="px-4 py-1.5 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Confirm Updates"}
          </button>
        </div>
      </div>

      <div className="px-6 py-5">
        {/* Table tabs */}
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {TABLES.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTable(t)}
              className={`px-4 py-2 text-sm font-medium rounded capitalize transition-colors ${
                activeTable === t
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Search bar + column picker */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <select
            value={searchColumn}
            onChange={(e) => setSearchColumn(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="all">All Columns</option>
            {schema.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
            >
              Clear
            </button>
          )}

          {/* Column visibility picker */}
          <div ref={colPickerRef} className="relative">
            <button
              onClick={() => setColPickerOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zm0 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" />
              </svg>
              Columns
              <span className="text-xs text-gray-400">({visibleColumns.size}/{schema.length})</span>
            </button>
            {colPickerOpen && (
              <div className="absolute z-30 right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg w-52 py-1 max-h-80 overflow-y-auto">
                <div className="flex gap-2 px-3 py-1.5 border-b border-gray-100">
                  <button
                    className="text-xs text-blue-600 hover:underline"
                    onClick={() => setVisibleColumns(new Set(schema.map((f) => f.key)))}
                  >
                    All
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    className="text-xs text-red-500 hover:underline"
                    onClick={() => setVisibleColumns(new Set())}
                  >
                    None
                  </button>
                </div>
                {schema.map((f) => {
                  const checked = visibleColumns.has(f.key);
                  return (
                    <label
                      key={f.key}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setVisibleColumns((prev) => {
                            const next = new Set(prev);
                            if (checked) next.delete(f.key); else next.add(f.key);
                            return next;
                          });
                        }}
                        className="w-3 h-3 accent-blue-600"
                      />
                      <span className={checked ? "text-gray-800" : "text-gray-400"}>{f.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Row count */}
        <p className="text-xs text-gray-500 mb-2">
          {loading ? "Loading…" : `${filteredRows.length} of ${rows.length} rows · ${activeTable}`}
        </p>

        {/* Table */}
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-700">{error}</div>
        ) : loading ? (
          <div className="text-center py-16 text-gray-500 text-sm">Loading…</div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] border border-gray-300 rounded shadow-sm">
            <table className="min-w-full bg-white text-xs border-collapse">
              <thead>
                <tr className="bg-gray-200 sticky top-0 z-10">
                  {visibleSchema.map((f) => (
                    <th
                      key={f.key}
                      className="border-b border-r border-gray-300 px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap"
                    >
                      {f.label}
                      {(f.type === "boolean" || f.type === "json" || f.type === "number" || f.type === "enum" || f.type === "multi-enum") && (
                        <span className="ml-1 text-gray-400 font-normal text-xs">({f.type})</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const rowId = row._id;
                  const pending = pendingChanges[rowId] || {};
                  const hasChanges = Object.keys(pending).length > 0;
                  return (
                    <tr key={rowId} className={hasChanges ? "bg-amber-50" : "hover:bg-gray-50"}>
                      {visibleSchema.map((f) => (
                        <td key={f.key} className="border-b border-r border-gray-200 px-1 py-0.5 align-top">
                          <FieldInput
                            fieldDef={f}
                            value={row[f.key]}
                            pendingValue={pending[f.key]}
                            onChange={(v) => handleCellChange(rowId, f.key, v)}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={visibleSchema.length || 1} className="text-center py-10 text-gray-400">
                      No rows found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Row Modal */}
      {addRowOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800 capitalize">
                Add {activeTable} Row
              </h2>
              <button
                type="button"
                onClick={() => setAddRowOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleAddRowSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
                {schema
                  .filter((f) => f.type !== "id" && f.type !== "readonly")
                  .map((f) => (
                    <div key={f.key} className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-gray-600">
                        {f.label}
                        {f.required && <span className="ml-0.5 text-red-500">*</span>}
                        <span className="ml-1 text-gray-400 font-normal">({f.type})</span>
                      </label>
                      {activeTable === "listings" && f.key === "address" ? (
                        <AddressSearchInput
                          value={addRowFields.address || ""}
                          onChange={(e) =>
                            setAddRowFields((prev) => ({ ...prev, address: e.target.value }))
                          }
                          onSelectSuggestion={(feature) => {
                            const [lng, lat] = feature.center;
                            setAddRowFields((prev) => ({
                              ...prev,
                              address: feature.place_name,
                              latitude: lat,
                              longitude: lng,
                            }));
                          }}
                          placeholder="Start typing an address…"
                          className="w-full px-2 py-0.5 rounded text-xs border border-gray-300 hover:border-gray-400 focus:border-blue-400 focus:outline-none"
                        />
                      ) : activeTable === "listings" && f.key === "unitTypes" ? (
                        <UnitTypesSelector
                          value={addRowFields.unitTypes}
                          onChange={(v) => setAddRowFields((prev) => ({ ...prev, unitTypes: v }))}
                        />
                      ) : (
                        <FieldInput
                          fieldDef={f}
                          value={addRowFields[f.key]}
                          pendingValue={undefined}
                          onChange={(v) =>
                            setAddRowFields((prev) => ({ ...prev, [f.key]: v }))
                          }
                        />
                      )}
                    </div>
                  ))}
              </div>
              {addRowError && (
                <p className="mx-5 mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {addRowError}
                </p>
              )}
              <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddRowOpen(false)}
                  className="px-4 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addRowSaving}
                  className="px-4 py-1.5 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {addRowSaving ? "Creating…" : "Create Row"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    {imagePanel && (
      <ImageManagerPanel
        listingId={imagePanel.listingId}
        initialImages={imagePanel.images}
        db={activeDb}
        onClose={() => setImagePanel(null)}
        onSaved={(newImages) => {
          setRows((prev) =>
            prev.map((r) => r._id === imagePanel.listingId ? { ...r, images: newImages } : r)
          );
          setImagePanel(null);
        }}
      />
    )}
    </>
  );
}
