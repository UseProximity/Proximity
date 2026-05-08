"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";

const BLANK = { bedrooms: "", bathrooms: "", area: "", pricing_basis: "per_unit", rent: "", lease_term_months: "12", available_from: "", sublease: false, total_bedrooms: "", total_bathrooms: "" };

function LeaseRow({ lease, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(!lease.id);
  const [form, setForm] = useState({ ...BLANK, ...lease });

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async () => {
    if (!form.bedrooms || !form.bathrooms || !form.rent) {
      toast.error("Bedrooms, bathrooms, and rent are required"); return;
    }
    await onUpdate(form);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-lg">
        <div className="flex gap-4 text-sm text-gray-700">
          <span><strong>{lease.bedrooms}</strong> bed / <strong>{lease.bathrooms}</strong> bath</span>
          {lease.area && <span>{lease.area} sq ft</span>}
          <span className="font-semibold text-gray-900">
            ${Number(lease.rent).toLocaleString()}<span className="text-xs font-normal text-gray-500">/{lease.pricing_basis === "per_bed" ? "bed" : "mo"}</span>
          </span>
          <span className="text-gray-500">{lease.lease_term_months}mo</span>
          {lease.sublease && (
            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
              Sublease{lease.total_bedrooms ? ` (${lease.bedrooms}/${lease.total_bedrooms}BR)` : ""}
            </span>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setEditing(true)} className="text-xs text-gray-500 hover:text-red-600">Edit</button>
          <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700">Remove</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border border-red-200 rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[["bedrooms","Bedrooms","number"],["bathrooms","Bathrooms","number"],["area","Area (sq ft)","number"],["rent","Rent ($)","number"]].map(([k, label, type]) => (
          <div key={k}>
            <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
            <input type={type} value={form[k]} onChange={set(k)} inputMode="decimal"
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
          </div>
        ))}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Pricing basis</label>
          <select value={form.pricing_basis} onChange={set("pricing_basis")}
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">
            <option value="per_unit">Per unit / month</option>
            <option value="per_bed">Per bed / month</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Term (months)</label>
          <input type="number" value={form.lease_term_months} onChange={set("lease_term_months")}
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Available from</label>
          <input type="date" value={form.available_from} onChange={set("available_from")}
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Unit group label (optional)</label>
          <input type="text" value={form.unit_group_label || ""} onChange={set("unit_group_label")} placeholder="e.g. Apt 4B"
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
        </div>
      </div>
      {/* Lease type — Standard or Sublease */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Lease type</label>
        <div className="flex gap-2">
          {[["Standard", false], ["Sublease", true]].map(([label, val]) => (
            <button
              key={label}
              type="button"
              onClick={() => setForm((p) => ({ ...p, sublease: val, total_bedrooms: val ? p.total_bedrooms : "", total_bathrooms: val ? p.total_bathrooms : "" }))}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium border transition ${
                form.sublease === val
                  ? val ? "bg-blue-600 text-white border-blue-600" : "bg-gray-800 text-white border-gray-800"
                  : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Total unit size — only shown for subleases */}
      {form.sublease && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-blue-800">
            This offer covers only part of the unit. Enter the full unit size below.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Total bedrooms in unit</label>
              <input type="number" value={form.total_bedrooms} onChange={set("total_bedrooms")} inputMode="numeric" placeholder="e.g. 4"
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Total bathrooms in unit</label>
              <input type="number" value={form.total_bathrooms} onChange={set("total_bathrooms")} inputMode="decimal" placeholder="e.g. 2"
                className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <p className="text-xs text-blue-600">
            Leased: {form.bedrooms || "?"} bed / {form.bathrooms || "?"} bath out of {form.total_bedrooms || "?"} bed / {form.total_bathrooms || "?"} bath total
          </p>
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button onClick={save} className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">Save</button>
        {lease.id && <button onClick={() => setEditing(false)} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>}
      </div>
    </div>
  );
}

export default function Step6LeaseTerms({ state, dispatch, onNext, onBack }) {
  const { listingId } = state;
  const [leases, setLeases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!listingId) return;
    fetch(`/api/landlord/leases?listing_id=${listingId}`)
      .then((r) => r.json())
      .then((data) => { setLeases(Array.isArray(data) ? data : []); setLoading(false); });
  }, [listingId]);

  const saveNew = async (form) => {
    const res = await fetch("/api/landlord/leases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, listing_id: listingId,
        bedrooms: Number(form.bedrooms), bathrooms: Number(form.bathrooms),
        rent: Number(form.rent), lease_term_months: Number(form.lease_term_months),
        area: form.area ? Number(form.area) : null }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "Failed to save"); return; }
    setLeases((p) => [...p, data]);
    setAdding(false);
    toast.success("Lease offer added");
  };

  const saveExisting = async (form) => {
    const res = await fetch(`/api/landlord/leases/${form.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, bedrooms: Number(form.bedrooms), bathrooms: Number(form.bathrooms),
        rent: Number(form.rent), lease_term_months: Number(form.lease_term_months),
        area: form.area ? Number(form.area) : null }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "Failed to update"); return; }
    setLeases((p) => p.map((l) => l.id === data.id ? data : l));
    toast.success("Lease offer updated");
  };

  const remove = async (id) => {
    await fetch(`/api/landlord/leases/${id}`, { method: "DELETE" });
    setLeases((p) => p.filter((l) => l.id !== id));
  };

  if (loading) return <div className="py-12 text-center text-sm text-gray-500">Loading lease terms…</div>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Lease offers</h2>
        <p className="text-sm text-gray-500">Add the different configurations and terms available (e.g. 1BR·12mo, 2BR·10mo).</p>
      </div>

      <div className="space-y-3">
        {leases.map((l) => (
          <LeaseRow key={l.id} lease={l} onUpdate={saveExisting} onDelete={() => remove(l.id)} />
        ))}
        {adding && <LeaseRow lease={BLANK} onUpdate={saveNew} onDelete={() => setAdding(false)} />}
      </div>

      {!adding && (
        <button onClick={() => setAdding(true)}
          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-red-400 hover:text-red-600 transition">
          + Add lease offer
        </button>
      )}

      {leases.length === 0 && !adding && (
        <p className="text-xs text-yellow-700 bg-yellow-50 rounded p-3">
          Add at least one lease offer so students can see the rent and availability.
        </p>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">← Back</button>
        <button onClick={onNext} disabled={leases.length === 0}
          className="px-6 py-2 bg-red-600 text-white rounded-md font-medium hover:bg-red-700 disabled:opacity-50 text-sm transition">
          Continue →
        </button>
      </div>
    </div>
  );
}
