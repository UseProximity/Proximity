"use client";

import { useState, useRef, useEffect } from "react";
import AddressSearchInput from "@/components/listings/AddressSearchInput";
import { clampCount } from "@/utils/unitCounts";
import {
  adminFetch, insertRow, deleteRow, prodConfirm,
  fmtMoney, fmtDate, termLabel, shortId,
  Stars, Badge, GearButton, TrashButton,
  InlineToggle, InlineNumber, usePending,
} from "@/components/admin/adminShared";
import { unitIsAvailable, listingIsUnavailable } from "@/lib/listings/unitAvailability";

const AMENITY_COLS = ["air_conditioning","dishwasher","gym","laundry","mailroom","microwave","oven","parking","pets_allowed","pool","refrigerator","rooftop","storage","stove","study_room"];
const UTILITY_COLS = ["electric","gas","heat","water","internet","trash","cable","sewer","cooling"];

// listing_amenities / listing_utilities are one row per listing; PostgREST may
// embed them as a one-element array or a bare object depending on FK detection.
function oneRow(v) {
  if (Array.isArray(v)) return v[0] || null;
  return v || null;
}

function sortedImages(listing) {
  return [...(listing.listing_images || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// Effective availability, mirroring the browse API exactly — same helper, so
// the two cannot drift. Leases now DO gate availability: a unit whose every
// offering has been withdrawn is not one a student can take (a unit carrying no
// offering at all still counts as available; see unitAvailability.js).
function availability(listing) {
  if (listing.unavailable) return { label: "Hidden (override)", color: "red" };
  if (listingIsUnavailable(listing)) return { label: "No live offerings", color: "red" };
  return { label: "Available", color: "green" };
}

// Whether any rent will display on the frontend (an active lease with a rent)
function hasListedRent(listing) {
  return (listing.listing_units || []).some((u) =>
    (u.unit_leases || []).some((l) => l.is_active && l.rent != null));
}

function unitLabel(u) {
  return u.title || `${u.bedrooms ?? "?"} BR / ${u.bathrooms ?? "?"} BA`;
}

// ─── Toggle-able chip grid for listing_amenities / listing_utilities ─────────
// Toggles are staged (amber ring) and applied by the header "Save Changes".

function BoolChipGrid({ listingId, table, row, cols, isReadOnly }) {
  const pending = usePending();
  const base = row || {};

  return (
    <div className="flex flex-wrap gap-1">
      {cols.map((col) => {
        const staged = pending?.get(table, listingId, col);
        const changed = staged !== undefined;
        const on = changed ? staged === true : base[col] === true;
        return (
          <button
            key={col}
            type="button"
            disabled={isReadOnly}
            onClick={() => pending.stage(table, listingId, col, !on, base[col] === true)}
            className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
              on
                ? "bg-blue-50 border-blue-300 text-blue-700"
                : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
            } ${changed ? "ring-2 ring-amber-400" : ""} ${isReadOnly ? "cursor-default" : "cursor-pointer"}`}
          >
            {col.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}

// ─── Landlord chips + add/remove ──────────────────────────────────────────────
// Changes are staged as the full replacement user_ids set; applied on Save
// Changes (the server emails newly added landlords at that point).

function LandlordSection({ listing, allUsers, isReadOnly }) {
  const pending = usePending();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const links = listing.listing_landlords || [];
  const baseIds = links.map((l) => l.user_id);
  const staged = pending?.get("listing_landlords", listing.id, "user_ids");
  const changed = staged !== undefined;
  const currentIds = changed ? staged : baseIds;

  useEffect(() => {
    if (!open) return;
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function stageIds(ids) {
    pending.stage("listing_landlords", listing.id, "user_ids", ids, baseIds);
    setOpen(false);
    setQuery("");
  }

  function nameFor(id) {
    const link = links.find((l) => l.user_id === id);
    if (link) return link.users?.name || link.users?.email || shortId(id);
    const u = allUsers.find((u) => u.id === id);
    return u?.name || u?.email || shortId(id);
  }

  const lq = query.trim().toLowerCase();
  const matches = lq.length < 2 ? [] : allUsers
    .filter((u) => !currentIds.includes(u.id))
    .filter((u) => (u.name || "").toLowerCase().includes(lq) || (u.email || "").toLowerCase().includes(lq))
    .slice(0, 8);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {currentIds.length === 0 && <span className="text-xs text-gray-400 italic">No landlords linked</span>}
      {currentIds.map((id) => {
        const isPrimary = links.find((l) => l.user_id === id)?.is_primary;
        const isNew = changed && !baseIds.includes(id);
        return (
          <span key={id} className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border ${
            isNew ? "bg-amber-50 border-amber-400 text-amber-800" : "bg-blue-50 border-blue-200 text-blue-800"
          }`}>
            {isPrimary && <span title="Primary landlord" className="text-amber-500">★</span>}
            <span>{nameFor(id)}</span>
            {isNew && <span className="text-[9px] uppercase font-semibold text-amber-500">new</span>}
            {!isReadOnly && (
              <button
                type="button"
                onClick={() => stageIds(currentIds.filter((x) => x !== id))}
                className={`font-bold leading-none ${isNew ? "text-amber-400 hover:text-red-500" : "text-blue-300 hover:text-red-500"}`}
              >
                &times;
              </button>
            )}
          </span>
        );
      })}
      {changed && baseIds.filter((id) => !currentIds.includes(id)).map((id) => (
        <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-red-200 bg-red-50 text-red-500 line-through">
          {nameFor(id)}
          <button type="button" onClick={() => stageIds([...currentIds, id])} className="no-underline text-red-400 hover:text-gray-600 font-bold leading-none" title="Undo removal">↺</button>
        </span>
      ))}
      {!isReadOnly && (
        <div ref={ref} className="relative">
          <input
            type="text"
            value={query}
            placeholder="+ add landlord…"
            onFocus={() => setOpen(true)}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            className="w-36 px-2 py-0.5 text-xs border border-dashed border-gray-300 rounded-full focus:outline-none focus:border-blue-400"
          />
          {open && matches.length > 0 && (
            <div className="absolute z-40 top-full left-0 mt-1 w-72 max-h-52 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg">
              {matches.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onMouseDown={() => stageIds([...currentIds, u.id])}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2"
                >
                  <span className="flex-1 truncate text-gray-800">{u.name || "(no name)"}</span>
                  <span className="text-gray-400 truncate">{u.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add-lease / add-unit mini forms ──────────────────────────────────────────

const TERM_OPTIONS = [
  { months: 4, label: "Summer" },
  { months: 5, label: "Semester" },
  { months: 10, label: "10-month" },
  { months: 12, label: "12-month" },
];

function AddLeaseForm({ unitId, dbTarget, isProd, onDone, onCancel }) {
  const [rent, setRent] = useState("");
  const [terms, setTerms] = useState([12]);
  const [availableFrom, setAvailableFrom] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (rent === "" || isNaN(Number(rent))) { alert("Rent is required"); return; }
    if (!prodConfirm(isProd, "Add a new lease to this unit.")) return;
    setSaving(true);
    try {
      await insertRow("unit_leases", {
        unit_id: unitId,
        rent: Number(rent),
        is_active: true,
        lease_term_months: terms,
        available_from: availableFrom || null,
      }, dbTarget);
      onDone();
    } catch (err) {
      alert(`Add lease failed: ${err.message}`);
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pl-6 py-1.5 bg-blue-50/50 rounded text-xs">
      <input type="number" placeholder="Rent ($)" value={rent} onChange={(e) => setRent(e.target.value)} className="w-20 px-2 py-0.5 border border-gray-300 rounded focus:outline-none focus:border-blue-400" />
      {TERM_OPTIONS.map((t) => (
        <label key={t.months} className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={terms.includes(t.months)}
            onChange={() => setTerms((prev) => prev.includes(t.months) ? prev.filter((m) => m !== t.months) : [...prev, t.months])}
            className="w-3 h-3 accent-blue-600"
          />
          <span className="text-gray-600">{t.label}</span>
        </label>
      ))}
      <input type="date" value={availableFrom} onChange={(e) => setAvailableFrom(e.target.value)} className="px-2 py-0.5 border border-gray-300 rounded focus:outline-none focus:border-blue-400" />
      <button type="button" disabled={saving} onClick={submit} className="px-2.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">{saving ? "Adding…" : "Add"}</button>
      <button type="button" onClick={onCancel} className="px-2 py-0.5 border border-gray-300 rounded hover:bg-white">Cancel</button>
    </div>
  );
}

function AddUnitForm({ listingId, dbTarget, isProd, onDone, onCancel }) {
  const [beds, setBeds] = useState("");
  const [baths, setBaths] = useState("");
  const [area, setArea] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (beds === "" || baths === "") { alert("Beds and baths are required"); return; }
    if (!prodConfirm(isProd, "Add a new unit to this listing.")) return;
    setSaving(true);
    try {
      await insertRow("listing_units", {
        listing_id: listingId,
        bedrooms: Number(beds),
        bathrooms: Number(baths),
        area: area === "" ? null : Number(area),
      }, dbTarget);
      onDone();
    } catch (err) {
      alert(`Add unit failed: ${err.message}`);
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
      <input type="number" min="0" placeholder="Beds" value={beds} onChange={(e) => setBeds(clampCount(e.target.value))} className="w-16 px-2 py-0.5 border border-gray-300 rounded focus:outline-none focus:border-blue-400" />
      <span className="text-gray-400">BR /</span>
      <input type="number" min="0" step="0.5" placeholder="Baths" value={baths} onChange={(e) => setBaths(clampCount(e.target.value))} className="w-16 px-2 py-0.5 border border-gray-300 rounded focus:outline-none focus:border-blue-400" />
      <span className="text-gray-400">BA</span>
      <input type="number" min="0" placeholder="Area (sqft)" value={area} onChange={(e) => setArea(clampCount(e.target.value))} className="w-24 px-2 py-0.5 border border-gray-300 rounded focus:outline-none focus:border-blue-400" />
      <button type="button" disabled={saving} onClick={submit} className="px-2.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">{saving ? "Adding…" : "Add unit"}</button>
      <button type="button" onClick={onCancel} className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
    </div>
  );
}

// ─── New listing modal ────────────────────────────────────────────────────────

function NewListingModal({ dbTarget, isProd, onClose, onCreated }) {
  const [fields, setFields] = useState({ address: "", title: "", contact_name: "", contact_email: "", contact_phone: "" });
  const [units, setUnits] = useState([{ bedrooms: "", bathrooms: "", area: "", rent: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function setField(k, v) { setFields((prev) => ({ ...prev, [k]: v })); }
  function setUnit(i, k, v) { setUnits((prev) => prev.map((u, idx) => (idx === i ? { ...u, [k]: v } : u))); }

  async function submit(e) {
    e.preventDefault();
    if (!fields.address.trim()) { setError("Address is required"); return; }
    if (!prodConfirm(isProd, "Create a new listing.")) return;
    setSaving(true);
    setError(null);
    try {
      const listing = await insertRow("listings", { ...fields, lease_type: "standard" }, dbTarget);
      for (const u of units.filter((u) => u.bedrooms !== "" && u.bathrooms !== "")) {
        const unit = await insertRow("listing_units", {
          listing_id: listing.id,
          bedrooms: Number(u.bedrooms),
          bathrooms: Number(u.bathrooms),
          area: u.area === "" ? null : Number(u.area),
        }, dbTarget);
        if (u.rent !== "" && !isNaN(Number(u.rent))) {
          await insertRow("unit_leases", {
            unit_id: unit.id,
            rent: Number(u.rent),
            is_active: true,
            lease_term_months: [12],
          }, dbTarget);
        }
      }
      onCreated(listing.id);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const inputClass = "w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">New Listing</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">{error}</div>}
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Address *</label>
            <AddressSearchInput
              value={fields.address}
              onChange={(e) => setField("address", e.target.value)}
              onSelectSuggestion={(feature) => {
                const [lng, lat] = feature.center;
                setFields((prev) => ({ ...prev, address: feature.place_name, latitude: lat, longitude: lng }));
              }}
              placeholder="Start typing an address…"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Display name</label>
            <input type="text" value={fields.title} onChange={(e) => setField("title", e.target.value)} className={inputClass} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Contact name</label>
              <input type="text" value={fields.contact_name} onChange={(e) => setField("contact_name", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Contact email</label>
              <input type="email" value={fields.contact_email} onChange={(e) => setField("contact_email", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Contact phone</label>
              <input type="text" value={fields.contact_phone} onChange={(e) => setField("contact_phone", e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Units</label>
              <button type="button" onClick={() => setUnits((prev) => [...prev, { bedrooms: "", bathrooms: "", area: "", rent: "" }])} className="text-xs text-blue-600 hover:underline">+ Add another</button>
            </div>
            <div className="space-y-1.5">
              {units.map((u, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  <input type="number" min="0" placeholder="Beds" value={u.bedrooms} onChange={(e) => setUnit(i, "bedrooms", clampCount(e.target.value))} className="w-16 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:border-blue-400" />
                  <input type="number" min="0" step="0.5" placeholder="Baths" value={u.bathrooms} onChange={(e) => setUnit(i, "bathrooms", clampCount(e.target.value))} className="w-16 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:border-blue-400" />
                  <input type="number" min="0" placeholder="Sqft" value={u.area} onChange={(e) => setUnit(i, "area", clampCount(e.target.value))} className="w-20 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:border-blue-400" />
                  <input type="number" min="0" placeholder="Rent ($/mo)" value={u.rent} onChange={(e) => setUnit(i, "rent", clampCount(e.target.value))} className="w-24 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:border-blue-400" />
                  {units.length > 1 && (
                    <button type="button" onClick={() => setUnits((prev) => prev.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-500 font-bold">&times;</button>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-gray-400">Units with rent get an active 12-month lease; adjust terms afterwards.</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-100">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
            {saving ? "Creating…" : "Create listing"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Expanded listing detail ──────────────────────────────────────────────────

function Section({ title, count, children, action }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
          {title}{count != null && <span className="ml-1 text-gray-400 normal-case">({count})</span>}
        </h4>
        {action}
      </div>
      {children}
    </div>
  );
}

function ListingDetail({ listing, allUsers, dbTarget, isProd, isReadOnly, onOpenGear, onOpenImages, onRefresh }) {
  const [addingUnit, setAddingUnit] = useState(false);
  const [addingLeaseFor, setAddingLeaseFor] = useState(null);

  const units = [...(listing.listing_units || [])].sort((a, b) => (a.bedrooms ?? 0) - (b.bedrooms ?? 0));
  const images = sortedImages(listing);
  const reviews = [...(listing.listing_reviews || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const amenities = oneRow(listing.listing_amenities);
  const utilities = oneRow(listing.listing_utilities);

  async function handleDelete(table, id, what) {
    if (!confirm(`Delete this ${what}? This cannot be undone.`)) return;
    if (!prodConfirm(isProd, `Permanently delete this ${what}.`)) return;
    try {
      await deleteRow(table, id, dbTarget);
      onRefresh();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  return (
    <div className="px-4 pb-4 pt-1 space-y-4 border-t border-gray-100 bg-gray-50/60">
      {/* Units & leases */}
      <Section
        title="Units & Leases"
        count={units.length}
        action={!isReadOnly && !addingUnit && (
          <button type="button" onClick={() => setAddingUnit(true)} className="text-xs text-blue-600 hover:underline">+ Add unit</button>
        )}
      >
        {addingUnit && (
          <AddUnitForm listingId={listing.id} dbTarget={dbTarget} isProd={isProd} onDone={() => { setAddingUnit(false); onRefresh(); }} onCancel={() => setAddingUnit(false)} />
        )}
        {units.length === 0 && !addingUnit && <p className="text-xs text-gray-400 italic">No units — the listing shows no rent or availability without them.</p>}
        <div className="space-y-2">
          {units.map((u) => {
            const leases = [...(u.unit_leases || [])].sort((a, b) => (b.is_active === true) - (a.is_active === true));
            return (
              <div key={u.id} className={`rounded-lg border border-l-4 bg-white ${u.deleted_at ? "border-red-200 border-l-red-300 opacity-60" : "border-gray-200 border-l-blue-400"}`}>
                <div className="flex items-center gap-3 px-3 py-1.5 bg-blue-50/40 rounded-tr-lg">
                  <Badge color="blue">unit</Badge>
                  <span className="text-xs font-semibold text-gray-800 min-w-[110px]">{unitLabel(u)}</span>
                  <span className="text-xs text-gray-500">
                    <InlineNumber table="listing_units" id={u.id} field="area" value={u.area} disabled={isReadOnly} className="w-16" /> sqft
                  </span>
                  <Badge color={unitIsAvailable(u) ? "green" : "red"}>
                    {unitIsAvailable(u) ? "available" : "no live offering"}
                  </Badge>
                  {u.deleted_at && <Badge color="red">deleted</Badge>}
                  <span className="ml-auto flex items-center gap-0.5">
                    {!isReadOnly && <TrashButton title="Delete unit" onClick={() => handleDelete("listing_units", u.id, "unit")} />}
                    <GearButton onClick={() => onOpenGear("listing_units", u)} />
                  </span>
                </div>
                <div className="pl-6 pr-3 py-2 space-y-1">
                  {leases.length === 0 && <p className="text-[11px] text-gray-400 italic">No leases — the unit still shows as available (terms unknown), but no rent will display.</p>}
                  {leases.map((l) => {
                    const future = l.available_from && new Date(l.available_from) > new Date();
                    return (
                    <div key={l.id} className={`flex flex-wrap items-center gap-2 text-xs rounded border-l-4 py-1 pl-2 pr-1 ${l.is_active ? "border-l-purple-400 bg-purple-50/50" : "border-l-purple-200 bg-gray-50 opacity-70"}`}>
                      <Badge color="purple">lease</Badge>
                      <InlineNumber table="unit_leases" id={l.id} field="rent" value={l.rent} disabled={isReadOnly} prefix="$" className="w-20" />
                      <span className="text-gray-500">
                        {(Array.isArray(l.lease_term_months) ? l.lease_term_months : []).map(termLabel).join(", ") || "no terms"}
                      </span>
                      {!l.is_active ? (
                        <Badge color="gray" title="Inactive — this lease's rent and terms don't display on the site">inactive</Badge>
                      ) : future ? (
                        <Badge color="amber" title="Active, becomes available on this date">available {fmtDate(l.available_from)}</Badge>
                      ) : (
                        <Badge color="green" title="Active — this lease's rent and terms display on the site">available now</Badge>
                      )}
                      {l.sublease && <Badge color="purple">sublease</Badge>}
                      <InlineToggle table="unit_leases" id={l.id} field="is_active" value={l.is_active} disabled={isReadOnly} label="Active" />
                      <span className="ml-auto flex items-center gap-0.5">
                        {!isReadOnly && <TrashButton title="Delete lease" onClick={() => handleDelete("unit_leases", l.id, "lease")} />}
                        <GearButton onClick={() => onOpenGear("unit_leases", l)} />
                      </span>
                    </div>
                    );
                  })}
                  {addingLeaseFor === u.id ? (
                    <AddLeaseForm unitId={u.id} dbTarget={dbTarget} isProd={isProd} onDone={() => { setAddingLeaseFor(null); onRefresh(); }} onCancel={() => setAddingLeaseFor(null)} />
                  ) : (
                    !isReadOnly && (
                      <button type="button" onClick={() => setAddingLeaseFor(u.id)} className="text-[11px] text-blue-600 hover:underline">+ Add lease</button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Landlords */}
      <Section title="Landlords" count={(listing.listing_landlords || []).length}>
        <LandlordSection listing={listing} allUsers={allUsers} isReadOnly={isReadOnly} />
      </Section>

      {/* Photos */}
      <Section
        title="Photos"
        count={images.length}
        action={
          <button type="button" onClick={() => onOpenImages(listing.id, images.map((i) => i.url))} className="text-xs text-blue-600 hover:underline">
            Manage photos
          </button>
        }
      >
        {images.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No photos</p>
        ) : (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {images.slice(0, 10).map((img) => (
              <div key={img.id} className="relative flex-shrink-0">
                <img
                  src={`/_next/image?url=${encodeURIComponent(img.url)}&w=128&q=15`}
                  alt={img.alt_text || "listing photo"}
                  className="w-20 h-14 object-cover rounded border border-gray-200"
                  onError={(e) => { e.target.style.display = "none"; }}
                />
                {img.source === "street_view" && (
                  <span className="absolute bottom-0.5 left-0.5 px-1 rounded bg-black/60 text-white text-[9px]">SV</span>
                )}
              </div>
            ))}
            {images.length > 10 && <span className="self-center text-xs text-gray-400 whitespace-nowrap">+{images.length - 10} more</span>}
          </div>
        )}
      </Section>

      {/* Reviews */}
      <Section title="Reviews" count={reviews.length}>
        {reviews.length === 0 && <p className="text-xs text-gray-400 italic">No reviews</p>}
        <div className="space-y-1.5">
          {reviews.map((r) => (
            <div key={r.id} className={`flex items-start gap-2 px-3 py-1.5 rounded-lg border bg-white ${r.deleted_at ? "border-red-200 opacity-60" : "border-gray-200"}`}>
              <Stars rating={r.rating} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-800 truncate">{r.comment || <span className="italic text-gray-400">(no comment)</span>}</p>
                <p className="text-[10px] text-gray-400">
                  {r.anonymous ? "Anonymous" : (r.name || "Unnamed")} · {fmtDate(r.created_at)}
                  {r.deleted_at && " · deleted"}
                </p>
              </div>
              <InlineToggle table="listing_reviews" id={r.id} field="legitimacy" value={r.legitimacy} disabled={isReadOnly} label="Verified" />
              {!isReadOnly && <TrashButton title="Delete review" onClick={() => handleDelete("listing_reviews", r.id, "review")} />}
              <GearButton onClick={() => onOpenGear("listing_reviews", r)} />
            </div>
          ))}
        </div>
      </Section>

      {/* Amenities & utilities */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Section title="Amenities">
          <BoolChipGrid listingId={listing.id} table="listing_amenities" row={amenities} cols={AMENITY_COLS} isReadOnly={isReadOnly} />
        </Section>
        <Section title="Utilities included">
          <BoolChipGrid listingId={listing.id} table="listing_utilities" row={utilities} cols={UTILITY_COLS} isReadOnly={isReadOnly} />
        </Section>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function ListingsView({ data, search, dbTarget, isProd, isReadOnly, onOpenGear, onOpenImages, onRefresh }) {
  const [expanded, setExpanded] = useState(new Set());
  const [newListingOpen, setNewListingOpen] = useState(false);
  const [allUsers, setAllUsers] = useState([]);

  // User list for the landlord picker — names/emails only
  useEffect(() => {
    adminFetch("/api/admin/hierarchy/users", dbTarget)
      .then((users) => setAllUsers((users || []).map((u) => ({ id: u.id, name: u.name, email: u.email }))))
      .catch(() => setAllUsers([]));
  }, [dbTarget]);

  const listings = data || [];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? listings.filter((l) =>
        [l.address, l.title, l.city, l.id, ...(l.listing_landlords || []).map((ll) => ll.users?.name || "")]
          .some((v) => (v || "").toLowerCase().includes(q)))
    : listings;

  const availableCount = listings.filter((l) => availability(l).color === "green").length;

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {filtered.length} of {listings.length} listings · {availableCount} available
        </p>
        {!isReadOnly && (
          <button type="button" onClick={() => setNewListingOpen(true)} className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded">
            + New listing
          </button>
        )}
      </div>

      {filtered.map((l) => {
        const isOpen = expanded.has(l.id);
        const avail = availability(l);
        const units = l.listing_units || [];
        const cover = sortedImages(l)[0];
        const primary = (l.listing_landlords || []).find((ll) => ll.is_primary) || (l.listing_landlords || [])[0];
        const reviews = (l.listing_reviews || []).filter((r) => !r.deleted_at);
        const avgRating = reviews.length ? reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length : null;

        return (
          <div key={l.id} className={`rounded-xl border bg-white shadow-sm ${l.deleted_at ? "border-red-200" : "border-gray-200"}`}>
            <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none" onClick={() => toggleExpand(l.id)}>
              <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
              {cover ? (
                <img src={`/_next/image?url=${encodeURIComponent(cover.url)}&w=96&q=15`} alt="" className="w-12 h-9 object-cover rounded border border-gray-200 flex-shrink-0" onError={(e) => { e.target.style.visibility = "hidden"; }} />
              ) : (
                <div className="w-12 h-9 rounded bg-gray-100 border border-gray-200 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{l.title || l.address}</p>
                <p className="text-[11px] text-gray-400 truncate">
                  {l.title ? `${l.address} · ` : ""}{primary?.users?.name || "no landlord"}
                  {avgRating != null && ` · ${avgRating.toFixed(1)}★ (${reviews.length})`}
                </p>
              </div>
              <span className="hidden sm:block text-xs text-gray-600 whitespace-nowrap">
                {l.min_rent != null ? (l.min_rent === l.max_rent ? fmtMoney(l.min_rent) : `${fmtMoney(l.min_rent)}–${fmtMoney(l.max_rent)}`) : "—"}
              </span>
              <span className="hidden sm:block text-xs text-gray-500 whitespace-nowrap">
                {units.length} unit{units.length !== 1 ? "s" : ""}
              </span>
              <Badge color={avail.color}>{avail.label}</Badge>
              {avail.color === "green" && !hasListedRent(l) && (
                <Badge color="gray" title="Available on the site, but no active lease has a rent, so no price displays">no rent listed</Badge>
              )}
              {l.deleted_at && <Badge color="red">deleted</Badge>}
              <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                <InlineToggle table="listings" id={l.id} field="unavailable" value={l.unavailable} disabled={isReadOnly} label="Hide" />
                <GearButton onClick={() => onOpenGear("listings", l)} />
              </span>
            </div>
            {isOpen && (
              <ListingDetail
                listing={l}
                allUsers={allUsers}
                dbTarget={dbTarget}
                isProd={isProd}
                isReadOnly={isReadOnly}
                onOpenGear={onOpenGear}
                onOpenImages={onOpenImages}
                onRefresh={onRefresh}
              />
            )}
          </div>
        );
      })}

      {filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-gray-400">No listings match.</p>
      )}

      {newListingOpen && (
        <NewListingModal
          dbTarget={dbTarget}
          isProd={isProd}
          onClose={() => setNewListingOpen(false)}
          onCreated={() => { setNewListingOpen(false); onRefresh(); }}
        />
      )}
    </div>
  );
}
