"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Schemas ──────────────────────────────────────────────────────────────────
// type: "id" | "readonly" | "text" | "number" | "boolean" | "json" | "enum"
// enum fields also carry an `options` array of allowed values

const SCHEMAS = {
  users: [
    { key: "_id",            label: "ID",              type: "id"       },
    { key: "name",           label: "Name",            type: "text"     },
    { key: "email",          label: "Email",           type: "text"     },
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
    { key: "address",          label: "Address",           type: "text"     },
    { key: "homeType",         label: "Home Type",         type: "enum",    options: ["apartment", "house", "condo", "townhouse"] },
    { key: "leaseType",        label: "Lease Type",        type: "enum",    options: ["standard", "sublease"] },
    { key: "leaseAvailability",label: "Lease Availability",type: "enum",    options: ["semester", "10-month", "12-month"] },
    { key: "leaseStructure",   label: "Lease Structure",   type: "enum",    options: ["individual", "joint"] },
    { key: "moveInDate",       label: "Move-in Date",      type: "text"     },
    { key: "furnished",        label: "Furnished",         type: "boolean"  },
    { key: "utilitiesIncluded",label: "Utilities Included",type: "boolean"  },
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
    { key: "description",      label: "Description",       type: "text"     },
    { key: "owner",            label: "Owner ID",          type: "text"     },
    { key: "landlord",         label: "Landlord ID",       type: "text"     },
    { key: "unitTypes",        label: "Unit Types",        type: "json"     },
    { key: "images",           label: "Images",            type: "json"     },
    { key: "reviews",          label: "Reviews",           type: "json"     },
    { key: "placeWalkMinutes", label: "Place Walk Times",  type: "json"     },
    { key: "amenities",        label: "Amenities",         type: "multi-enum", options: ["dishwasher","in_unit_laundry","ac_heating","mailroom","pets_allowed","extra_storage","fireplace","private_parking","pool","study_room","gym"] },
    { key: "createdAt",        label: "Created",           type: "readonly" },
  ],
  reviews: [
    { key: "_id",                label: "ID",             type: "id"       },
    { key: "reviewer",           label: "Reviewer ID",    type: "text"     },
    { key: "reviewedUser",       label: "Reviewed User",  type: "text"     },
    { key: "listing",            label: "Listing ID",     type: "text"     },
    { key: "rating",             label: "Rating",         type: "number"   },
    { key: "comment",            label: "Comment",        type: "text"     },
    { key: "legitimacy",         label: "Verified",       type: "boolean"  },
    { key: "communicationRating",label: "Communication",  type: "number"   },
    { key: "locationRating",     label: "Location",       type: "number"   },
    { key: "valueRating",        label: "Value",          type: "number"   },
    { key: "createdAt",          label: "Created",        type: "readonly" },
    { key: "updatedAt",          label: "Updated",        type: "readonly" },
  ],
  dorms: [
    { key: "_id",        label: "ID",          type: "id"       },
    { key: "name",       label: "Name",        type: "text"     },
    { key: "description",label: "Description", type: "text"     },
    { key: "image",      label: "Image URL",   type: "text"     },
    { key: "roomTypes",  label: "Room Types",  type: "json"     },
    { key: "tags",       label: "Tags",        type: "json"     },
    { key: "createdAt",  label: "Created",     type: "readonly" },
    { key: "updatedAt",  label: "Updated",     type: "readonly" },
  ],
  dormreviews: [
    { key: "_id",      label: "ID",          type: "id"       },
    { key: "name",     label: "Author Name", type: "text"     },
    { key: "classYear",label: "Class Year",  type: "number"   },
    { key: "rating",   label: "Rating",      type: "number"   },
    { key: "dorm",     label: "Dorm",        type: "text"     },
    { key: "dormType", label: "Room Type",   type: "text"     },
    { key: "tags",     label: "Tags",        type: "json"     },
    { key: "content",  label: "Content",     type: "text"     },
    { key: "createdAt",label: "Created",     type: "readonly" },
    { key: "updatedAt",label: "Updated",     type: "readonly" },
  ],
  testimonials: [
    { key: "_id",      label: "ID",     type: "id"       },
    { key: "text",     label: "Text",   type: "text"     },
    { key: "author",   label: "Author", type: "text"     },
    { key: "rating",   label: "Rating", type: "number"   },
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
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative min-w-[110px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
        <div className="absolute z-20 top-full left-0 mt-0.5 bg-white border border-gray-200 rounded shadow-lg min-w-full">
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
  const ref = useRef(null);

  // Normalise: current may be an array or a JSON string; also map legacy values
  const rawArray = Array.isArray(current)
    ? current
    : (typeof current === "string" && current.startsWith("["))
      ? (() => { try { return JSON.parse(current); } catch { return []; } })()
      : [];
  const selected = rawArray.map((v) => AMENITY_NORMALIZE[v] ?? v);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(opt) {
    const next = selected.includes(opt)
      ? selected.filter((v) => v !== opt)
      : [...selected, opt];
    onChange(next);
  }

  return (
    <div ref={ref} className="relative min-w-[140px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
        <div className="absolute z-20 top-full left-0 mt-0.5 bg-white border border-gray-200 rounded shadow-lg min-w-[180px] py-1">
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
  const colPickerRef = useRef(null);

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

  return (
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
          <div className="overflow-x-auto border border-gray-300 rounded shadow-sm">
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
    </div>
  );
}
