"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
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

// ─── UserSearchDropdown ───────────────────────────────────────────────────────
// Searchable dropdown for selecting a user by name; shows name, truncated ID, role.

function UserSearchDropdown({ users, value, onChange, changed }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selectedUser = users.find((u) => u.id === value);
  const lq = query.trim().toLowerCase();
  const filtered = lq
    ? users.filter((u) => (u.name || "").toLowerCase().includes(lq))
    : users;

  const borderClass = changed
    ? "border-amber-400 bg-amber-50"
    : "border-gray-300 hover:border-gray-400 focus:border-blue-400";

  function roleBadgeClass(role) {
    if (role === "super") return "bg-red-500";
    if (role === "landlord") return "bg-blue-500";
    return "bg-gray-400";
  }

  return (
    <div ref={ref} className="relative min-w-[200px]">
      <input
        type="text"
        placeholder={selectedUser ? selectedUser.name : "Search by name…"}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        className={`w-full px-2 py-0.5 rounded text-xs border focus:outline-none ${borderClass}`}
      />
      {selectedUser && !query && (
        <div className="mt-0.5 px-2 flex items-center gap-1.5 text-xs text-gray-500">
          <span className="font-mono text-gray-400 text-[10px]">{selectedUser.id.slice(0, 8)}…</span>
          <span className={`px-1 rounded text-white text-[10px] ${roleBadgeClass(selectedUser.role)}`}>
            {selectedUser.role}
          </span>
        </div>
      )}
      {open && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-80 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 italic">No users found</div>
          ) : (
            filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={() => { onChange(u.id); setQuery(""); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2 ${u.id === value ? "bg-blue-50 font-semibold" : ""}`}
              >
                <span className="flex-1 text-gray-800 truncate">{u.name || "(no name)"}</span>
                <span className="font-mono text-gray-400 text-[10px] shrink-0">{u.id.slice(0, 8)}…</span>
                <span className={`px-1 rounded text-white text-[10px] shrink-0 ${roleBadgeClass(u.role)}`}>
                  {u.role}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── UserSearchMultiDropdown ──────────────────────────────────────────────────
// Multi-select variant of UserSearchDropdown — value is an array of user IDs.

function UserSearchMultiDropdown({ users, value, onChange, changed }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selected = Array.isArray(value) ? value : (value ? [value] : []);
  const selectedUsers = selected.map((id) => users.find((u) => u.id === id)).filter(Boolean);
  const lq = query.trim().toLowerCase();
  const filtered = lq
    ? users.filter((u) => (u.name || "").toLowerCase().includes(lq) && !selected.includes(u.id))
    : users.filter((u) => !selected.includes(u.id));

  const borderClass = changed
    ? "border-amber-400 bg-amber-50"
    : "border-gray-300 hover:border-gray-400 focus:border-blue-400";

  function roleBadgeClass(role) {
    if (role === "super") return "bg-red-500";
    if (role === "landlord") return "bg-blue-500";
    return "bg-gray-400";
  }

  function addUser(id) {
    onChange([...selected, id]);
    setQuery("");
    setOpen(false);
  }

  function removeUser(id) {
    onChange(selected.filter((s) => s !== id));
  }

  return (
    <div ref={ref} className="relative min-w-[200px]">
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {selectedUsers.map((u) => (
            <span key={u.id} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-800 rounded border border-blue-200">
              <span>{u.name || "(no name)"}</span>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); removeUser(u.id); }}
                className="ml-0.5 text-blue-400 hover:text-red-500 leading-none font-bold"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        placeholder="Add landlord…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        className={`w-full px-2 py-0.5 rounded text-xs border focus:outline-none ${borderClass}`}
      />
      {open && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-80 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 italic">No users found</div>
          ) : (
            filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={() => addUser(u.id)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2"
              >
                <span className="flex-1 text-gray-800 truncate">{u.name || "(no name)"}</span>
                <span className="font-mono text-gray-400 text-[10px] shrink-0">{u.id.slice(0, 8)}…</span>
                <span className={`px-1 rounded text-white text-[10px] shrink-0 ${roleBadgeClass(u.role)}`}>
                  {u.role}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── FkSearchDropdown ─────────────────────────────────────────────────────────
// Searchable dropdown for selecting a foreign-key reference by label.
// options: { id: string, label: string }[]

function FkSearchDropdown({ options, value, onChange, changed }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selectedOption = options.find((o) => o.id === value);
  const lq = query.trim().toLowerCase();
  const filtered = lq
    ? options.filter((o) => o.label.toLowerCase().includes(lq) || o.id.toLowerCase().includes(lq))
    : options;

  const borderClass = changed
    ? "border-amber-400 bg-amber-50"
    : "border-gray-300 hover:border-gray-400 focus:border-blue-400";

  return (
    <div ref={ref} className="relative min-w-[180px]">
      <input
        type="text"
        placeholder={selectedOption ? selectedOption.label : "Search…"}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        className={`w-full px-2 py-0.5 rounded text-xs border focus:outline-none ${borderClass}`}
      />
      {selectedOption && !query && (
        <div className="mt-0.5 px-2 flex items-center gap-1.5 text-xs text-gray-500">
          <span className="font-mono text-gray-400 text-[10px]">{value.slice(0, 8)}…</span>
        </div>
      )}
      {open && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-72 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg">
          <button
            type="button"
            onMouseDown={() => { onChange(null); setQuery(""); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50 italic"
          >
            — clear —
          </button>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 italic">No results</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={() => { onChange(o.id); setQuery(""); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2 ${o.id === value ? "bg-blue-50 font-semibold" : ""}`}
              >
                <span className="flex-1 text-gray-800 truncate">{o.label}</span>
                <span className="font-mono text-gray-400 text-[10px] shrink-0">{o.id.slice(0, 8)}…</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
// type: "id" | "readonly" | "text" | "number" | "boolean" | "json" | "enum" | "user-search" | "user-search-multi"
// enum fields also carry an `options` array of allowed values

const SCHEMAS = {
  users: [
    { key: "id",               label: "ID",              type: "id"       },
    { key: "name",             label: "Name",            type: "text",    required: true  },
    { key: "email",            label: "Email",           type: "text",    required: true  },
    { key: "role",             label: "Role",            type: "enum",    options: ["student", "landlord", "super"] },
    { key: "phone",            label: "Phone",           type: "text"     },
    { key: "gender",           label: "Gender",          type: "enum",    options: ["unspecified", "male", "female", "other"] },
    { key: "birthday",         label: "Birthday",        type: "text"     },
    { key: "description",      label: "Bio",             type: "text"     },
    { key: "referral_source",  label: "Referral Source", type: "text"     },
    { key: "profile_complete", label: "Profile Complete",type: "boolean"  },
    { key: "rating",           label: "Rating",          type: "number"   },
    { key: "num_reviews",      label: "# Reviews",       type: "number"   },
    { key: "image",            label: "Image URL",       type: "text"     },
    { key: "created_at",       label: "Created",         type: "readonly" },
    { key: "updated_at",       label: "Updated",         type: "readonly" },
  ],
  listings: [
    { key: "id",                   label: "ID",                type: "id"       },
    { key: "title",                label: "Display Name",      type: "text"     },
    { key: "address",              label: "Address",           type: "text",    required: true  },
    { key: "home_type",            label: "Home Type",         type: "enum",    options: ["apartment", "house", "condo", "townhouse"] },
    { key: "lease_type",           label: "Lease Type",        type: "enum",    options: ["standard", "sublease"] },
    { key: "min_rent",             label: "Min Rent",          type: "readonly" },
    { key: "max_rent",             label: "Max Rent",          type: "readonly" },
    { key: "min_bedrooms",         label: "Min Beds",          type: "readonly" },
    { key: "max_bedrooms",         label: "Max Beds",          type: "readonly" },
    { key: "min_bathrooms",        label: "Min Baths",         type: "readonly" },
    { key: "max_bathrooms",        label: "Max Baths",         type: "readonly" },
    { key: "min_area",             label: "Min Area (sqft)",   type: "readonly" },
    { key: "max_area",             label: "Max Area (sqft)",   type: "readonly" },
    { key: "rating",               label: "Rating",            type: "readonly" },
    { key: "num_reviews",          label: "# Reviews",         type: "readonly" },
    { key: "num_saves",            label: "# Saves",           type: "readonly" },
    { key: "num_clicks",           label: "# Clicks",          type: "readonly" },
    { key: "shuttle_walk_minutes", label: "Shuttle Walk (min)", type: "readonly" },
    { key: "latitude",             label: "Latitude",          type: "readonly" },
    { key: "longitude",            label: "Longitude",         type: "readonly" },
    { key: "contact_email",        label: "Contact Email",     type: "text"     },
    { key: "contact_phone",        label: "Contact Phone",     type: "text"     },
    { key: "contact_name",         label: "Contact Name",      type: "text"     },
    { key: "description",          label: "Description",       type: "text"     },
    { key: "furnished",            label: "Furnished",          type: "boolean"  },
    { key: "utilities_included",   label: "Utilities Included", type: "multi-enum", options: ["water","sewer","trash","internet","electric","gas","hotWater","yardCare"] },
    { key: "lease_structure",      label: "Lease Structure",    type: "enum",    options: ["individual","joint"] },
    { key: "move_in_date",         label: "Move-in Date",       type: "date"     },
    { key: "lease_availability",   label: "Lease Availability", type: "multi-enum", options: ["semester","10-month","12-month","summer"] },
    { key: "sublease_friendly",    label: "Sublease Friendly",  type: "boolean"  },
    { key: "twenty_one_plus",      label: "21+ Only",           type: "boolean"  },
    { key: "amenities",            label: "Amenities",          type: "multi-enum", options: ["dishwasher","in_unit_laundry","refrigerator","stove","oven","microwave","ac_heating","mailroom","pets_allowed","extra_storage","fireplace","private_parking","pool","study_room","gym"] },
    { key: "unavailable",          label: "Unavailable",        type: "boolean"  },
    { key: "landlord_id",          label: "Landlord(s)",       type: "user-search-multi" },
    { key: "images",               label: "Images",            type: "images"   },
    { key: "place_walk_minutes",   label: "Place Walk Times",  type: "walk-times" },
    { key: "created_at",           label: "Created",           type: "readonly" },
    { key: "updated_at",           label: "Updated",           type: "readonly" },
  ],
  listing_units: [
    { key: "id",                  label: "ID",                 type: "id"       },
    { key: "listing_id",          label: "Listing",            type: "fk-search", refTable: "listings", required: true  },
    { key: "bedrooms",            label: "Bedrooms",           type: "number",  required: true,  min: 0, max: 20, step: 1 },
    { key: "bathrooms",           label: "Bathrooms",          type: "number",  required: true,  min: 0, max: 10, step: 0.5 },
    { key: "rent",                label: "Rent ($)",           type: "number",  min: 0 },
    { key: "area",                label: "Area (sqft)",        type: "number",  min: 0 },
    { key: "lease_availability",  label: "Lease Availability", type: "enum",    options: ["semester","10-month","12-month","summer"] },
    { key: "created_at",          label: "Created",            type: "readonly" },
    { key: "updated_at",          label: "Updated",            type: "readonly" },
  ],
  reviews: [
    { key: "id",                   label: "ID",            type: "id"       },
    { key: "user_id",              label: "Reviewer",      type: "fk-search", refTable: "users" },
    { key: "name",                 label: "Name",          type: "text"     },
    { key: "listing_id",           label: "Listing",       type: "fk-search", refTable: "listings", required: true  },
    { key: "rating",               label: "Rating",        type: "number",  required: true,  min: 1, max: 5  },
    { key: "comment",              label: "Comment",       type: "text",    required: true  },
    { key: "legitimacy",           label: "Verified",      type: "boolean"  },
    { key: "communication_rating", label: "Communication", type: "number",  min: 1, max: 5  },
    { key: "location_rating",      label: "Location",      type: "number",  min: 1, max: 5  },
    { key: "value_rating",         label: "Value",         type: "number",  min: 1, max: 5  },
    { key: "created_at",           label: "Created",       type: "readonly" },
    { key: "updated_at",           label: "Updated",       type: "readonly" },
  ],
  dorms: [
    { key: "id",          label: "ID",          type: "id"       },
    { key: "name",        label: "Name",        type: "text",    required: true  },
    { key: "description", label: "Description", type: "text"     },
    { key: "image",       label: "Image URL",   type: "text"     },
    { key: "room_types",  label: "Room Types",  type: "multi-enum", options: ["Modern Single","Modern Double","Modern Triple","Traditional Single","Traditional Double","Traditional Triple","Apartment Style"] },
    { key: "tags",        label: "Tags",        type: "multi-enum", options: ["Quiet Floor","Study Floor","Social Floor","Historic","New Building","Central Location","Apartment Style","Modern"] },
    { key: "created_at",  label: "Created",     type: "readonly" },
    { key: "updated_at",  label: "Updated",     type: "readonly" },
  ],
  dorm_reviews: [
    { key: "id",            label: "ID",          type: "id"       },
    { key: "dorm_id",       label: "Dorm",        type: "fk-search", refTable: "dorms", required: true  },
    { key: "reviewer_name", label: "Author Name", type: "text",    required: true  },
    { key: "class_year",    label: "Class Year",  type: "number",  required: true,  min: 2020, max: 2035, step: 1 },
    { key: "rating",        label: "Rating",      type: "number",  required: true,  min: 1, max: 5  },
    { key: "dorm_type",     label: "Room Type",   type: "enum",    options: ["Modern Single","Modern Double","Modern Triple","Traditional Single","Traditional Double","Traditional Triple","Apartment Style"] },
    { key: "tags",          label: "Tags",        type: "multi-enum", options: ["Quiet Floor","Study Floor","Social Floor","Historic","New Building","Central Location","Apartment Style","Modern"] },
    { key: "content",       label: "Content",     type: "text",    required: true  },
    { key: "created_at",    label: "Created",     type: "readonly" },
    { key: "updated_at",    label: "Updated",     type: "readonly" },
  ],
  testimonials: [
    { key: "id",         label: "ID",     type: "id"       },
    { key: "text",       label: "Text",   type: "text",    required: true  },
    { key: "author",     label: "Author", type: "text",    required: true  },
    { key: "rating",     label: "Rating", type: "number",  required: true,  min: 1, max: 5  },
    { key: "created_at", label: "Created",type: "readonly" },
    { key: "updated_at", label: "Updated",type: "readonly" },
  ],
  matchmaking_responses: [
    { key: "id",             label: "ID",             type: "id"       },
    { key: "user_id",        label: "User ID",        type: "readonly" },
    { key: "name",           label: "Name",           type: "text",    required: true },
    { key: "email",          label: "Email",          type: "text",    required: true },
    { key: "year_of_school", label: "Year",           type: "text"     },
    { key: "group_size",     label: "Group Size",     type: "text"     },
    { key: "budget",         label: "Budget",         type: "text"     },
    { key: "lease_term",     label: "Lease Term",     type: "text"     },
    { key: "furnished",      label: "Furnished",      type: "text"     },
    { key: "commute",        label: "Commute",        type: "text"     },
    { key: "medical_campus", label: "Medical Campus", type: "boolean"  },
    { key: "priorities",     label: "Priorities",     type: "json"     },
    { key: "student_type",   label: "Student Type",   type: "text"     },
    { key: "area",           label: "Area",           type: "text"     },
    { key: "notes",          label: "Notes",          type: "text"     },
    { key: "referral_source",label: "Referral",       type: "text"     },
    { key: "created_at",     label: "Created",        type: "readonly" },
  ],
};

// Static tables used as fallback before the dynamic schema loads
const STATIC_TABLES = Object.keys(SCHEMAS).sort();

// Returns a max-width style for a column based on its field definition
function colStyle(f) {
  switch (f.type) {
    case "id":        return { width: 80,  maxWidth: 80  };
    case "boolean":   return { width: 64,  maxWidth: 64  };
    case "number":    return { width: 80,  maxWidth: 96  };
    case "readonly":  return { width: 80,  maxWidth: 110 };
    case "enum":      return { width: 110, maxWidth: 140 };
    case "multi-enum":return { width: 120, maxWidth: 160 };
    case "date":      return { width: 130, maxWidth: 150 };
    case "images":    return { width: 90,  maxWidth: 90  };
    case "walk-times":return { width: 200, maxWidth: 260 };
    case "json":      return { width: 160, maxWidth: 240 };
    default:          return { minWidth: 120 };           // text — grows freely
  }
}

// ─── Matchmaking → Claude format ──────────────────────────────────────────────

function formatForClaude(row) {
  const fields = [
    "area", "budget", "commute", "email", "furnished",
    "group_size", "lease_term", "medical_campus", "name",
    "notes", "priorities", "referral_source", "student_type", "year_of_school",
  ];
  return fields
    .map((key) => {
      let val = row[key];
      if (Array.isArray(val)) val = val.join(", ");
      else if (val === true) val = "Yes";
      else if (val === false) val = "No";
      else val = val ?? "";
      return `* ${key}: ${val}`.trimEnd();
    })
    .join("\n");
}

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
          className="bg-white border border-gray-200 rounded shadow-lg max-h-56 overflow-y-auto"
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
          className="bg-white border border-gray-200 rounded shadow-lg py-1 max-h-56 overflow-y-auto"
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

function FieldInput({ fieldDef, value, pendingValue, onChange, users = [], fkLabel = null, refMaps = {} }) {
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
      <span className="block px-2 py-0.5 text-gray-400 font-mono text-xs break-all">
        {current == null ? "" : String(current)}
      </span>
    );
  }

  if (type === "readonly") {
    const display = current == null ? "" : (
      typeof current === "object" ? new Date(current).toLocaleString() : String(current)
    );
    return (
      <span className="block px-2 py-0.5 text-gray-400 text-xs break-words">
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
        step={fieldDef.step ?? "any"}
        min={fieldDef.min ?? undefined}
        max={fieldDef.max ?? undefined}
      />
    );
  }

  if (type === "walk-times") {
    const obj = current == null ? {} : (typeof current === "object" ? current : (() => {
      try { return JSON.parse(current); } catch { return {}; }
    })());
    const entries = Object.entries(obj);
    if (entries.length === 0) return <span className="block px-2 py-0.5 text-gray-400 text-xs">—</span>;
    return (
      <div className="px-2 py-1 flex flex-col gap-0.5 min-w-[180px]">
        {entries.map(([place, mins]) => (
          <div key={place} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-gray-700 truncate max-w-[140px]" title={place}>{place}</span>
            <span className="text-gray-500 whitespace-nowrap font-medium">{mins} min</span>
          </div>
        ))}
      </div>
    );
  }

  if (type === "date") {
    // Normalize ISO datetime strings (e.g. "2025-08-01T00:00:00Z") to "YYYY-MM-DD"
    const dateVal = current == null ? "" : String(current).slice(0, 10);
    return (
      <input
        type="date"
        value={dateVal}
        onChange={(e) => onChange(e.target.value || null)}
        className={`${baseText} min-w-[120px]`}
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

  if (type === "fk-search") {
    const map = refMaps[fieldDef.refTable] || {};
    const options = Object.entries(map).map(([id, label]) => ({ id, label }));
    return (
      <FkSearchDropdown
        options={options}
        value={current == null ? "" : String(current)}
        onChange={onChange}
        changed={changed}
      />
    );
  }

  if (type === "user-search") {
    return (
      <UserSearchDropdown
        users={users}
        value={current == null ? "" : String(current)}
        onChange={onChange}
        changed={changed}
      />
    );
  }

  if (type === "user-search-multi") {
    return (
      <UserSearchMultiDropdown
        users={users}
        value={Array.isArray(current) ? current : (current ? [current] : [])}
        onChange={onChange}
        changed={changed}
      />
    );
  }

  // text (default) — with optional FK label
  const display = current == null ? "" : String(current);

  if (fkLabel) {
    return (
      <div className="flex items-center gap-2 px-2 py-0.5 min-w-[160px]">
        <span className="text-xs text-gray-800 truncate flex-1 min-w-0">{fkLabel}</span>
        <span className="text-[10px] font-mono text-gray-400 shrink-0 opacity-75">{display}</span>
      </div>
    );
  }

  return (
    <ExpandingTextarea
      value={display}
      onChange={(v) => onChange(v)}
      className={`${baseText} min-w-[100px]`}
    />
  );
}

// ─── Cell Wrapper (overflow clip + copy on hover) ─────────────────────────────

function CellWrapper({ value, pendingValue, children }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const wrapperRef = useRef(null);

  function getCopyText() {
    const current = pendingValue !== undefined ? pendingValue : value;
    if (current == null) return "";
    if (typeof current === "object") return JSON.stringify(current);
    return String(current);
  }

  function handleCopy(e) {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(getCopyText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  useEffect(() => {
    if (!expanded) return;
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

  return (
    <div ref={wrapperRef} className="relative group" onClick={() => !expanded && setExpanded(true)}>
      <div className={expanded ? "overflow-visible" : "overflow-hidden"} style={expanded ? {} : { maxHeight: "2rem" }}>
        {children}
      </div>
      <button
        type="button"
        onMouseDown={handleCopy}
        className="absolute top-0 right-0 z-10 opacity-0 group-hover:opacity-100 p-0.5 bg-white/90 rounded text-gray-400 hover:text-gray-700 transition-opacity pointer-events-auto"
        title="Copy cell value"
      >
        {copied ? (
          <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ─── Image Manager Panel ───────────────────────────────────────────────────────

function ImageManagerPanel({ listingId, initialImages, dbTarget, isProd, onClose, onSaved }) {
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
    if (!confirm("Delete this image? This cannot be undone.")) return;
    if (isProd && !confirm("PRODUCTION: This will permanently delete this image from the PRODUCTION database. Are you absolutely sure?")) return;
    setPanelError(null);
    try {
      const res = await fetch("/api/admin/listing-images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-db-target": dbTarget },
        body: JSON.stringify({ listingId, imageUrl: url }),
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
        headers: { "Content-Type": "application/json", "x-db-target": dbTarget },
        body: JSON.stringify({ listingId, oldUrl: renamingUrl, newFilename: renameValue.trim() }),
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
    if (!confirm(`Upload ${files.length} photo(s)?`)) return;
    setUploading(true);
    setPanelError(null);
    try {
      // Step 1: get presigned PUT URLs from the server
      const presignRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          files: files.map((f) => ({ name: f.name, type: f.type })),
        }),
      });
      const presignData = await presignRes.json();
      if (!presignRes.ok) throw new Error(presignData.error || `Presign failed (HTTP ${presignRes.status})`);

      // Step 2: upload each file directly to R2 (bypasses Vercel size limit)
      await Promise.all(
        presignData.presigned.map(({ uploadUrl }, i) =>
          fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": files[i].type },
            body: files[i],
          }).then((r) => {
            if (!r.ok) throw new Error(`R2 upload failed for "${files[i].name}" (HTTP ${r.status})`);
          })
        )
      );

      // Step 3: tell the server which URLs were successfully uploaded
      const publicUrls = presignData.presigned.map((p) => p.publicUrl);
      const confirmRes = await fetch("/api/upload", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, urls: publicUrls }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error || `Failed to save images (HTTP ${confirmRes.status})`);

      setImages((prev) => [...prev, ...publicUrls]);
    } catch (e) {
      setPanelError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (isProd && !confirm("PRODUCTION: Saving image changes to the PRODUCTION database. Proceed?")) return;
    setSaving(true);
    setPanelError(null);
    try {
      const res = await fetch("/api/admin/listing-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-db-target": dbTarget },
        body: JSON.stringify({ listingId, images }),
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
                src={`/_next/image?url=${encodeURIComponent(url)}&w=128&q=15`}
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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [searchColumn, setSearchColumn] = useState("all");
  const [pendingChanges, setPendingChanges] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set((SCHEMAS["users"] || []).map((f) => f.key)));
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [imagePanel, setImagePanel] = useState(null);
  const colPickerRef = useRef(null);
  const [addRowOpen, setAddRowOpen] = useState(false);
  const [addRowFields, setAddRowFields] = useState({});
  const [addRowUnits, setAddRowUnits] = useState([]);
  const [addRowError, setAddRowError] = useState(null);
  const [addRowSaving, setAddRowSaving] = useState(false);

  // All users — used to populate the landlord_id user-search dropdown
  const [allUsers, setAllUsers] = useState([]);

  // Inline listing_units state
  const [unitsByListing, setUnitsByListing] = useState({});
  const [expandedListings, setExpandedListings] = useState(new Set());
  const [unitPendingChanges, setUnitPendingChanges] = useState({});
  const [addingUnitForListing, setAddingUnitForListing] = useState(null);
  const [newUnitFields, setNewUnitFields] = useState({});
  const [addingUnitSaving, setAddingUnitSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [addingUnitError, setAddingUnitError] = useState(null);

  // DB environment toggle — "prod" or "dev"
  const [dbTarget, setDbTarget] = useState("dev");
  const isProd = dbTarget === "prod";

  // FK lookup maps — id → human-readable label for reference columns
  const [refMaps, setRefMaps] = useState({ users: {}, listings: {}, dorms: {} });

  useEffect(() => {
    const h = { "x-db-target": dbTarget };
    Promise.all([
      fetch("/api/admin/users",    { headers: h }).then((r) => r.ok ? r.json() : []),
      fetch("/api/admin/listings", { headers: h }).then((r) => r.ok ? r.json() : []),
      fetch("/api/admin/dorms",    { headers: h }).then((r) => r.ok ? r.json() : []),
    ]).then(([users, listings, dorms]) => {
      const maps = { users: {}, listings: {}, dorms: {} };
      for (const u of (Array.isArray(users)    ? users    : [])) maps.users[u.id]    = u.name    || u.email   || u.id;
      for (const l of (Array.isArray(listings) ? listings : [])) maps.listings[l.id] = l.address || l.title   || l.id;
      for (const d of (Array.isArray(dorms)    ? dorms    : [])) maps.dorms[d.id]    = d.name    || d.id;
      setRefMaps(maps);
    }).catch(() => {});
  }, [dbTarget]);

  function resolveFk(colKey, id) {
    if (!id) return null;
    if (colKey === "user_id" || colKey === "landlord_id" || colKey === "reviewer_id") return refMaps.users[id]    || null;
    if (colKey === "listing_id")  return refMaps.listings[id] || null;
    if (colKey === "dorm_id")     return refMaps.dorms[id]    || null;
    return null;
  }

  // Dynamic schema fetched from Supabase — falls back to hardcoded SCHEMAS for known tables
  const [allTables, setAllTables] = useState(STATIC_TABLES);
  const [dynamicSchemas, setDynamicSchemas] = useState({});

  useEffect(() => {
    fetch("/api/admin/schema", { headers: { "x-db-target": dbTarget } })
      .then((r) => r.json())
      .then((d) => {
        if (d.tables) setAllTables(d.tables);
        if (d.schemas) setDynamicSchemas(d.schemas);
      })
      .catch(() => {});
  }, [dbTarget]);

  // Prefer the rich static SCHEMAS for known tables; fall back to dynamic for new ones
  function getSchema(table) {
    return SCHEMAS[table] || dynamicSchemas[table] || [];
  }

  const rawSchema = getSchema(activeTable);
  // Fall back to deriving columns from first row when schema hasn't loaded yet
  const schema = rawSchema.length > 0 ? rawSchema
    : rows.length > 0
      ? Object.keys(rows[0]).map((k) => ({
          key: k,
          label: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          type: k === "id" ? "id" : "text",
        }))
      : [];
  const visibleSchema = visibleColumns.size > 0
    ? schema.filter((f) => visibleColumns.has(f.key))
    : schema;

  useEffect(() => {
    function handleOutsideClick(e) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target)) {
        setColPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Load persisted db target on mount; fall back to server's NODE_ENV
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("admin_db_target") : null;
    if (stored === "prod" || stored === "dev") {
      setDbTarget(stored);
      return;
    }
    fetch("/api/admin/db-env")
      .then((r) => r.json())
      .then((d) => { if (d.env === "prod" || d.env === "dev") setDbTarget(d.env); })
      .catch(() => {});
  }, []);

  function toggleDbTarget() {
    const next = dbTarget === "prod" ? "dev" : "prod";
    if (next === "prod" && !confirm("Switch to PRODUCTION database?\n\nAll reads and writes will affect real user data. Proceed?")) return;
    setDbTarget(next);
    if (typeof window !== "undefined") localStorage.setItem("admin_db_target", next);
  }

  const [walkTimesStatus, setWalkTimesStatus] = useState(null);
  const [walkTimesRunning, setWalkTimesRunning] = useState(false);

  // View As feature
  const [viewAsQuery, setViewAsQuery] = useState("");
  const [viewAsResults, setViewAsResults] = useState([]);
  const [viewAsSearching, setViewAsSearching] = useState(false);
  const viewAsTimerRef = useRef(null);

  async function handleUpdateWalkTimes() {
    if (isProd && !confirm("Update walk times on PRODUCTION?\n\nThis will recalculate walk times for all listings in the production database.")) return;
    setWalkTimesRunning(true);
    setWalkTimesStatus(null);
    try {
      const res = await fetch("/api/admin/update-campus-walk-times", {
        method: "POST",
        headers: { "x-db-target": dbTarget },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setWalkTimesStatus({ ok: true, msg: `Walk times updated: ${data.updated}/${data.total} listings` + (data.skipped ? ` (${data.skipped} already complete)` : "") + (data.failed ? ` (${data.failed} failed)` : "") });
    } catch (e) {
      setWalkTimesStatus({ ok: false, msg: `Walk times error: ${e.message}` });
    } finally {
      setWalkTimesRunning(false);
    }
  }

  function handleViewAsSearch(q) {
    setViewAsQuery(q);
    clearTimeout(viewAsTimerRef.current);
    if (!q || q.length < 2) { setViewAsResults([]); return; }
    setViewAsSearching(true);
    viewAsTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/searchUsers?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setViewAsResults(Array.isArray(data) ? data : []);
      } catch { setViewAsResults([]); }
      finally { setViewAsSearching(false); }
    }, 300);
  }

  const loadTable = useCallback(async (table, target) => {
    setLoading(true);
    setError(null);
    setPendingChanges({});
    setUnitPendingChanges({});
    setExpandedListings(new Set());
    setUnitsByListing({});
    setSearch("");
    setSearchColumn("all");
    setSaveStatus(null);
    const dbHeader = { "x-db-target": target };
    try {
      const res = await fetch(`/api/admin/${table}`, { headers: dbHeader });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);

      // Also load listing_units and users when viewing listings
      if (table === "listings") {
        const [unitsRes, usersRes] = await Promise.all([
          fetch("/api/admin/listing_units", { headers: dbHeader }),
          fetch("/api/admin/users", { headers: dbHeader }),
        ]);
        if (unitsRes.ok) {
          const unitsData = await unitsRes.json();
          const grouped = {};
          for (const unit of (Array.isArray(unitsData) ? unitsData : [])) {
            if (!grouped[unit.listing_id]) grouped[unit.listing_id] = [];
            grouped[unit.listing_id].push(unit);
          }
          setUnitsByListing(grouped);
        }
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          setAllUsers(Array.isArray(usersData) ? usersData : []);
        }
      }
    } catch (e) {
      setError(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTable(activeTable, dbTarget);
  }, [activeTable, dbTarget, loadTable]);

  // Update visible columns whenever the active table or dynamic schemas change.
  // This runs with fresh closure values, fixing the stale-closure issue in loadTable's useCallback.
  useEffect(() => {
    const s = SCHEMAS[activeTable] || dynamicSchemas[activeTable] || [];
    if (s.length > 0) {
      setVisibleColumns(new Set(s.map((f) => f.key)));
    }
  }, [activeTable, dynamicSchemas]);

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
      const row = rows.find((r) => r.id === rowId);
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

  function toggleExpand(listingId) {
    setExpandedListings((prev) => {
      const next = new Set(prev);
      if (next.has(listingId)) next.delete(listingId); else next.add(listingId);
      return next;
    });
  }

  async function handleDeleteUnit(listingId, unitId) {
    if (!confirm("Delete this unit? This cannot be undone.")) return;
    if (isProd && !confirm("PRODUCTION: This will permanently delete this unit from the PRODUCTION database. Are you absolutely sure?")) return;
    try {
      const res = await fetch(`/api/admin/listing_units?id=${unitId}`, { method: "DELETE", headers: { "x-db-target": dbTarget } });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Delete failed");
        return;
      }
      setUnitsByListing((prev) => ({
        ...prev,
        [listingId]: (prev[listingId] || []).filter((u) => u.id !== unitId),
      }));
      setUnitPendingChanges((prev) => {
        const next = { ...prev };
        delete next[unitId];
        return next;
      });
    } catch (e) {
      alert(e.message || "Delete failed");
    }
  }

  function openAddUnit(listingId) {
    setNewUnitFields(blankUnit());
    setAddingUnitError(null);
    setAddingUnitForListing(listingId);
  }

  async function handleSaveNewUnit(listingId) {
    if (isProd && !confirm("PRODUCTION: Adding a new unit to the PRODUCTION database. Proceed?")) return;
    setAddingUnitSaving(true);
    setAddingUnitError(null);
    try {
      const res = await fetch("/api/admin/listing_units", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-db-target": dbTarget },
        body: JSON.stringify({ fields: { ...newUnitFields, listing_id: listingId } }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 201) throw new Error(data.error || `Error ${res.status}`);
      setUnitsByListing((prev) => ({
        ...prev,
        [listingId]: [...(prev[listingId] || []), data],
      }));
      setAddingUnitForListing(null);
      setNewUnitFields({});
    } catch (e) {
      setAddingUnitError(e.message);
    } finally {
      setAddingUnitSaving(false);
    }
  }

  function handleUnitCellChange(unitId, key, value) {
    setUnitPendingChanges((prev) => ({
      ...prev,
      [unitId]: { ...(prev[unitId] || {}), [key]: value },
    }));
    setSaveStatus(null);
  }

  async function handleConfirmUpdates() {
    const entries = Object.entries(pendingChanges);
    const unitEntries = Object.entries(unitPendingChanges);
    if (entries.length === 0 && unitEntries.length === 0) return;
    if (isProd && !confirm(`PRODUCTION: You are about to save ${entries.length + unitEntries.length} row(s) to the PRODUCTION database.\n\nThis will affect real user data. Proceed?`)) return;
    setSaving(true);
    setSaveStatus(null);
    let failed = 0;
    const errors = [];

    async function patchRow(url, id, updates) {
      try {
        const res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-db-target": dbTarget },
          body: JSON.stringify({ id, updates }),
        });
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try { const d = await res.json(); if (d?.error) msg = d.error; } catch {}
          errors.push(`[${id.slice(0, 8)}…] ${msg}`);
          failed++;
        }
      } catch (e) {
        errors.push(`[${String(id).slice(0, 8)}…] ${e.message}`);
        failed++;
      }
    }

    for (const [id, updates] of entries) {
      await patchRow(`/api/admin/${activeTable}`, id, updates);
    }

    // When saving listings, also normalize any legacy amenity values in the DB
    let migrateMsg = "";
    if (activeTable === "listings") {
      try {
        const res = await fetch(`/api/admin/migrate-amenities`, { method: "POST", headers: { "x-db-target": dbTarget } });
        const data = await res.json();
        if (!data.error && data.migrated > 0) {
          migrateMsg = ` · ${data.migrated} amenity row(s) normalized`;
        }
      } catch { /* non-fatal */ }
    }

    // Also save any pending unit changes when on listings view
    for (const [unitId, updates] of unitEntries) {
      await patchRow("/api/admin/listing_units", unitId, updates);
    }

    const totalSaved = entries.length + unitEntries.length - failed;
    setSaving(false);
    if (failed === 0) {
      setSaveStatus({ ok: true, msg: `${totalSaved} row(s) saved.${migrateMsg}` });
      setPendingChanges({});
      setUnitPendingChanges({});
      loadTable(activeTable, dbTarget);
    } else {
      const detail = errors.slice(0, 3).join("; ");
      setSaveStatus({ ok: false, msg: `${failed} row(s) failed: ${detail}` });
      // Still clear successfully-saved rows and reload
      if (totalSaved > 0) loadTable(activeTable, dbTarget);
    }
  }

  const pendingCount = Object.keys(pendingChanges).length + Object.keys(unitPendingChanges).length;

  async function handleDeleteRow(rowId) {
    if (!confirm(`Delete this row (ID: ${rowId})?\n\nThis action cannot be undone and will permanently remove the record from the database.`)) return;
    if (isProd && !confirm("PRODUCTION: You are about to permanently delete this row from the PRODUCTION database.\n\nThis affects real user data and cannot be reversed. Are you absolutely sure?")) return;
    try {
      const res = await fetch(`/api/admin/${activeTable}?id=${encodeURIComponent(rowId)}`, {
        method: "DELETE",
        headers: { "x-db-target": dbTarget },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `Delete failed (HTTP ${res.status})`);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== rowId));
      setPendingChanges((prev) => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
    } catch (e) {
      alert(e.message || "Delete failed");
    }
  }

  function blankUnit() {
    const u = {};
    for (const f of getSchema("listing_units")) {
      if (["id", "listing_id", "created_at", "updated_at"].includes(f.key)) continue;
      if (f.type === "boolean") u[f.key] = false;
      else if (f.type === "multi-enum") u[f.key] = [];
      else u[f.key] = "";
    }
    return u;
  }

  function openAddRow() {
    const initial = {};
    for (const f of schema) {
      if (f.type === "id" || f.type === "readonly" || f.type === "walk-times") continue;
      if (f.type === "boolean") initial[f.key] = false;
      else if (f.type === "multi-enum" || f.type === "images" || f.type === "user-search-multi") initial[f.key] = [];
      else initial[f.key] = "";
    }
    if (activeTable === "listings") {
      initial.lease_type = "standard";
      initial.lease_structure = "individual";
    }
    setAddRowFields(initial);
    setAddRowUnits(activeTable === "listings" ? [blankUnit()] : []);
    setAddRowError(null);
    setAddRowSaving(false);
    setAddRowOpen(true);
  }

  async function handleAddRowSubmit(e) {
    e.preventDefault();
    if (isProd && !confirm(`PRODUCTION: You are about to create a new row in the PRODUCTION database.\n\nThis will affect real user data. Proceed?`)) return;
    setAddRowSaving(true);
    setAddRowError(null);
    try {
      let fields = { ...addRowFields };

      // Strip UI sentinel values that must never reach the database
      for (const [k, v] of Object.entries(fields)) {
        if (v === "__open_panel__") fields[k] = [];
      }

      // Auto-generate description for listings when left blank
      if (activeTable === "listings" && !fields.description?.trim()) {
        const name = (fields.title?.trim() || fields.address?.split(",")[0]?.trim() || "This property");
        const validUnits = addRowUnits.filter((u) => u.bedrooms !== "" && u.bathrooms !== "");
        if (validUnits.length > 0) {
          const beds = validUnits.map((u) => Number(u.bedrooms)).filter((n) => !isNaN(n));
          const rents = validUnits.map((u) => Number(u.rent)).filter((n) => n > 0);
          const utils = Array.isArray(validUnits[0]?.utilities_included) ? validUnits[0].utilities_included : [];
          const minBed = Math.min(...beds);
          const maxBed = Math.max(...beds);
          const bedPart = minBed === maxBed ? `${minBed}-bedroom` : `${minBed} to ${maxBed} bedroom`;
          const pricePart = rents.length > 0 ? ` for prices as low as $${Math.min(...rents).toLocaleString()}` : "";
          const utilPart = utils.length > 0 ? ` with ${utils.join(", ")} included` : "";
          fields.description = `${name} offers ${bedPart} units${pricePart}${utilPart}.`;
        }
      }

      const res = await fetch(`/api/admin/${activeTable}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-db-target": dbTarget },
        body: JSON.stringify({ fields }),
      });
      const newRow = await res.json().catch(() => ({}));
      if (res.status !== 201) {
        setAddRowError(newRow.error || `Error ${res.status}`);
        return;
      }

      // For listings, create each unit draft
      if (activeTable === "listings" && newRow?.id) {
        const validUnits = addRowUnits.filter(
          (u) => u.bedrooms !== "" && u.bathrooms !== ""
        );
        for (const unit of validUnits) {
          const uRes = await fetch("/api/admin/listing_units", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-db-target": dbTarget },
            body: JSON.stringify({ fields: { ...unit, listing_id: newRow.id } }),
          });
          if (!uRes.ok) {
            const uData = await uRes.json().catch(() => ({}));
            setAddRowError(`Listing created, but a unit failed: ${uData.error || "unknown error"}`);
            setAddRowSaving(false);
            return;
          }
        }
      }

      setAddRowOpen(false);
      setAddRowFields({});
      setAddRowUnits([]);
      loadTable(activeTable, dbTarget);
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
      <div className={`text-white px-6 py-4 flex items-center justify-between gap-4 flex-wrap ${isProd ? "bg-red-950" : "bg-gray-900"}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold tracking-tight">Admin Dashboard</h1>
          {/* DB environment badge */}
          <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full uppercase tracking-widest border ${
            isProd
              ? "bg-red-500 border-red-400 text-white"
              : "bg-green-600 border-green-500 text-white"
          }`}>
            {isProd ? "PROD" : "DEV"}
          </span>
          {/* DB toggle */}
          <button
            onClick={toggleDbTarget}
            className={`px-3 py-1 text-xs rounded border font-medium transition-colors ${
              isProd
                ? "border-red-500 text-red-200 hover:bg-red-800"
                : "border-gray-600 text-gray-300 hover:bg-gray-700"
            }`}
          >
            Switch to {isProd ? "DEV" : "PROD"}
          </button>
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
            onClick={() => { setPendingChanges({}); setUnitPendingChanges({}); setSaveStatus(null); }}
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

      {/* PRODUCTION warning banner */}
      {isProd && (
        <div className="bg-red-600 text-white px-6 py-2 text-sm font-semibold flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          PRODUCTION DATABASE ACTIVE — All reads and writes affect real user data. Proceed with extreme caution.
        </div>
      )}

      <div className="px-6 py-5">
        {/* View As panel */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-800 mb-3">View As User</p>
          <div className="relative max-w-sm">
            <input
              type="text"
              placeholder="Search by name or email…"
              value={viewAsQuery}
              onChange={(e) => handleViewAsSearch(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            {viewAsSearching && (
              <span className="absolute right-3 top-2.5 text-xs text-gray-400">Searching…</span>
            )}
          </div>
          {viewAsResults.length > 0 && (
            <ul className="mt-2 border border-gray-200 rounded-lg overflow-hidden max-w-sm divide-y divide-gray-100">
              {viewAsResults.map((u) => (
                <li key={u.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{u.name || "—"}</p>
                    <p className="text-xs text-gray-400 truncate">{u.email}</p>
                    <p className="text-[10px] font-mono text-gray-300">{u.id}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase text-white ${
                      u.role === "super" ? "bg-red-500" : u.role === "landlord" ? "bg-blue-500" : "bg-gray-400"
                    }`}>
                      {u.role}
                    </span>
                    <a
                      href={`/dashboard/view-as/${u.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-2.5 py-1 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      View →
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Table tabs */}
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {allTables.map((t) => (
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
                  {activeTable === "listings" && (
                    <th className="border-b border-r border-gray-300 px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap w-20">Units</th>
                  )}
                  {activeTable === "matchmaking_responses" && (
                    <th className="border-b border-r border-gray-300 px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap w-16">Copy</th>
                  )}
                  {visibleSchema.map((f) => (
                    <th
                      key={f.key}
                      style={{ ...colStyle(f), maxWidth: undefined, width: undefined }}
                      className="border-b border-r border-gray-300 px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap"
                    >
                      {f.type === "walk-times" ? (
                        <div className="flex items-center gap-2">
                          <span>{f.label}</span>
                          <button
                            onClick={handleUpdateWalkTimes}
                            disabled={walkTimesRunning}
                            className="px-2 py-0.5 text-xs bg-purple-700 hover:bg-purple-600 text-white rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {walkTimesRunning ? "Updating…" : "Update"}
                          </button>
                          {walkTimesStatus && (
                            <span className={`text-xs font-normal ${walkTimesStatus.ok ? "text-green-500" : "text-red-500"}`}>
                              {walkTimesStatus.msg}
                            </span>
                          )}
                        </div>
                      ) : (
                        <>
                          {f.label}
                          {(f.type === "boolean" || f.type === "json" || f.type === "number" || f.type === "enum" || f.type === "multi-enum") && (
                            <span className="ml-1 text-gray-400 font-normal text-xs">({f.type})</span>
                          )}
                        </>
                      )}
                    </th>
                  ))}
                  <th className="border-b border-gray-300 px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap w-12 sticky right-0 bg-gray-200">
                    Del
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const rowId = row.id;
                  const pending = pendingChanges[rowId] || {};
                  const hasChanges = Object.keys(pending).length > 0;
                  const units = activeTable === "listings" ? (unitsByListing[rowId] || []) : [];
                  const isExpanded = expandedListings.has(rowId);
                  const unitSchema = getSchema("listing_units").filter((f) => f.key !== "listing_id");
                  const colSpan = visibleSchema.length + (activeTable === "listings" ? 1 : 0) + (activeTable === "matchmaking_responses" ? 1 : 0) + 1;
                  return (
                    <React.Fragment key={rowId}>
                      <tr className={hasChanges ? "bg-amber-50" : "hover:bg-gray-50"}>
                        {activeTable === "listings" && (
                          <td className="border-b border-r border-gray-200 px-2 py-0.5 align-middle">
                            <button
                              type="button"
                              onClick={() => toggleExpand(rowId)}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap font-medium"
                            >
                              <span className="text-gray-500">{isExpanded ? "▼" : "▶"}</span>
                              {units.length} unit{units.length !== 1 ? "s" : ""}
                            </button>
                          </td>
                        )}
                        {activeTable === "matchmaking_responses" && (
                          <td className="border-b border-r border-gray-200 px-2 py-0.5 align-middle">
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(formatForClaude(row));
                                setCopiedId(rowId);
                                setTimeout(() => setCopiedId((id) => id === rowId ? null : id), 2000);
                              }}
                              className={`text-xs font-medium px-2 py-0.5 rounded transition-colors whitespace-nowrap ${
                                copiedId === rowId
                                  ? "bg-green-100 text-green-700"
                                  : "bg-gray-100 hover:bg-gray-200 text-gray-600"
                              }`}
                            >
                              {copiedId === rowId ? "✓ Copied" : "Copy"}
                            </button>
                          </td>
                        )}
                        {visibleSchema.map((f) => (
                          <td key={f.key} style={colStyle(f)} className="border-b border-r border-gray-200 px-1 py-0.5 align-top">
                            <CellWrapper value={row[f.key]} pendingValue={pending[f.key]}>
                              <FieldInput
                                fieldDef={f}
                                value={row[f.key]}
                                pendingValue={pending[f.key]}
                                onChange={(v) => handleCellChange(rowId, f.key, v)}
                                users={allUsers}
                                fkLabel={resolveFk(f.key, row[f.key])}
                                refMaps={refMaps}
                              />
                            </CellWrapper>
                          </td>
                        ))}
                        <td className="border-b border-gray-200 px-1 py-0.5 align-middle text-center sticky right-0 bg-white">
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(rowId)}
                            className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Delete row"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                      {activeTable === "listings" && isExpanded && (
                        <tr>
                          <td colSpan={colSpan} className="border-b border-gray-200 bg-blue-50 px-6 py-3">
                            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">
                              Units — {row.address || rowId}
                            </p>
                            {units.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">No units found for this listing.</p>
                            ) : (
                              <div className="overflow-auto max-h-60 rounded border border-blue-200">
                                <table className="w-auto bg-white text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-blue-100 sticky top-0 z-10">
                                      <th className="border-b border-r border-blue-200 px-2 py-1.5 w-8" />
                                      {unitSchema.map((f) => (
                                        <th key={f.key} style={{ ...colStyle(f), maxWidth: undefined, width: undefined }} className="border-b border-r border-blue-200 px-2 py-1.5 text-left font-semibold text-blue-800 whitespace-nowrap">
                                          {f.label}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {units.map((unit) => {
                                      const unitPending = unitPendingChanges[unit.id] || {};
                                      const unitHasChanges = Object.keys(unitPending).length > 0;
                                      return (
                                        <tr key={unit.id} className={unitHasChanges ? "bg-amber-50" : "hover:bg-blue-50"}>
                                          <td className="border-b border-r border-blue-100 px-1 py-0.5 align-middle text-center">
                                            <button
                                              type="button"
                                              onClick={() => handleDeleteUnit(rowId, unit.id)}
                                              className="text-gray-300 hover:text-red-500 transition-colors leading-none text-base px-1"
                                              title="Delete unit"
                                            >
                                              &times;
                                            </button>
                                          </td>
                                          {unitSchema.map((f) => (
                                            <td key={f.key} style={{ ...colStyle(f), width: undefined, maxWidth: undefined }} className="border-b border-r border-blue-100 px-1 py-0.5 align-top">
                                              <CellWrapper value={unit[f.key]} pendingValue={unitPending[f.key]}>
                                                <FieldInput
                                                  fieldDef={f}
                                                  value={unit[f.key]}
                                                  pendingValue={unitPending[f.key]}
                                                  onChange={(v) => handleUnitCellChange(unit.id, f.key, v)}
                                                  fkLabel={resolveFk(f.key, unit[f.key])}
                                                />
                                              </CellWrapper>
                                            </td>
                                          ))}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {addingUnitForListing !== rowId && (
                              <div className="mt-2">
                                <button
                                  type="button"
                                  onClick={() => openAddUnit(rowId)}
                                  className="px-2 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded"
                                >
                                  + Add Unit
                                </button>
                              </div>
                            )}
                            {addingUnitForListing === rowId && (
                              <div className="mt-3 border border-blue-300 rounded-lg bg-white p-3">
                                <p className="text-xs font-semibold text-blue-700 mb-2">New Unit</p>
                                {addingUnitError && (
                                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">{addingUnitError}</p>
                                )}
                                <div className="flex flex-wrap gap-x-3 gap-y-2 mb-2">
                                  {unitSchema.filter((f) => f.type !== "id" && f.type !== "readonly").map((f) => (
                                    <div key={f.key} className={`flex flex-col gap-0.5 ${f.type === "multi-enum" ? "w-full" : "w-28"}`}>
                                      <label className="text-xs text-gray-500">
                                        {f.label}
                                        {f.required && <span className="ml-0.5 text-red-400">*</span>}
                                      </label>
                                      <FieldInput
                                        fieldDef={f}
                                        value={newUnitFields[f.key]}
                                        pendingValue={undefined}
                                        onChange={(v) => setNewUnitFields((prev) => ({ ...prev, [f.key]: v }))}
                                      />
                                    </div>
                                  ))}
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => { setAddingUnitForListing(null); setAddingUnitError(null); }}
                                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveNewUnit(rowId)}
                                    disabled={addingUnitSaving}
                                    className="px-3 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    {addingUnitSaving ? "Saving…" : "Save Unit"}
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={(visibleSchema.length || 1) + (activeTable === "listings" ? 1 : 0) + (activeTable === "matchmaking_responses" ? 1 : 0) + 1} className="text-center py-10 text-gray-400">
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
      {addRowOpen && (() => {
        const isListings = activeTable === "listings";
        const listingFields = schema.filter(
          (f) => f.type !== "id" && f.type !== "readonly" && f.type !== "walk-times"
        );
        const unitFields = getSchema("listing_units").filter(
          (f) => !["id", "listing_id", "created_at", "updated_at"].includes(f.key)
        );
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className={`bg-white rounded-lg shadow-xl w-full ${isListings ? "max-w-4xl" : "max-w-lg"} max-h-[90vh] flex flex-col`}>
              {/* Modal header */}
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800 capitalize">
                  Add {activeTable.replace(/_/g, " ")} Row
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
                <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

                  {/* ── Listing fields ── */}
                  <div>
                    {isListings && (
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Listing Details</p>
                    )}
                    <div className={`grid gap-3 ${isListings ? "grid-cols-2" : "grid-cols-1"}`}>
                      {listingFields.map((f) => (
                        <div key={f.key} className={`flex flex-col gap-1 ${f.key === "description" ? "col-span-2" : ""}`}>
                          <label className="text-xs font-medium text-gray-600">
                            {f.label}
                            {f.required && <span className="ml-0.5 text-red-500">*</span>}
                          </label>
                          {isListings && f.key === "address" ? (
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
                              className="w-full px-2 py-1 rounded text-xs border border-gray-300 hover:border-gray-400 focus:border-blue-400 focus:outline-none"
                            />
                          ) : (
                            <FieldInput
                              fieldDef={f}
                              value={addRowFields[f.key]}
                              pendingValue={undefined}
                              onChange={(v) => setAddRowFields((prev) => ({ ...prev, [f.key]: v }))}
                              users={allUsers}
                              refMaps={refMaps}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Units section (listings only) ── */}
                  {isListings && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Units ({addRowUnits.length})
                        </p>
                        <button
                          type="button"
                          onClick={() => setAddRowUnits((prev) => [...prev, blankUnit()])}
                          className="px-2.5 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded"
                        >
                          + Add Unit
                        </button>
                      </div>
                      {addRowUnits.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">No units yet. Click &quot;+ Add Unit&quot; to add one.</p>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {addRowUnits.map((unit, idx) => (
                            <div key={idx} className="border border-blue-200 rounded-lg bg-blue-50 p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-blue-700">Unit {idx + 1}</span>
                                <button
                                  type="button"
                                  onClick={() => setAddRowUnits((prev) => prev.filter((_, i) => i !== idx))}
                                  className="text-gray-400 hover:text-red-500 text-base leading-none"
                                >
                                  &times;
                                </button>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                {unitFields.map((f) => (
                                  <div key={f.key} className={`flex flex-col gap-0.5 ${f.type === "multi-enum" ? "col-span-3" : ""}`}>
                                    <label className="text-xs text-gray-500">
                                      {f.label}
                                      {f.required && <span className="ml-0.5 text-red-400">*</span>}
                                    </label>
                                    <FieldInput
                                      fieldDef={f}
                                      value={unit[f.key]}
                                      pendingValue={undefined}
                                      onChange={(v) =>
                                        setAddRowUnits((prev) => {
                                          const next = [...prev];
                                          next[idx] = { ...next[idx], [f.key]: v };
                                          return next;
                                        })
                                      }
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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
                    {addRowSaving ? "Creating…" : isListings && addRowUnits.filter(u => u.bedrooms !== "" && u.bathrooms !== "").length > 0
                      ? `Create Listing + ${addRowUnits.filter(u => u.bedrooms !== "" && u.bathrooms !== "").length} Unit(s)`
                      : "Create Row"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </div>
    {imagePanel && (
      <ImageManagerPanel
        listingId={imagePanel.listingId}
        initialImages={imagePanel.images}
        dbTarget={dbTarget}
        isProd={isProd}
        onClose={() => setImagePanel(null)}
        onSaved={(newImages) => {
          setRows((prev) =>
            prev.map((r) => r.id === imagePanel.listingId ? { ...r, images: newImages } : r)
          );
          setImagePanel(null);
        }}
      />
    )}
    </>
  );
}
