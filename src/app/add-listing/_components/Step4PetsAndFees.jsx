"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";

const FEE_BASES = ["flat","per_person","per_bed","per_unit","per_day","per_bedroom_per_month","percentage"];

export default function Step7PetsAndFees({ state, dispatch, onNext, onBack }) {
  const { listingId } = state;
  const [petPolicy, setPetPolicy] = useState("");
  const [fees, setFees] = useState([]);
  const [feeTypes, setFeeTypes] = useState([]);
  const [concessions, setConcessions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [addingFee, setAddingFee] = useState(false);
  const [addingConcession, setAddingConcession] = useState(false);
  const [newFee, setNewFee] = useState({ fee_type_id: "", amount: "", basis: "flat", refundable: false });
  const [newConcession, setNewConcession] = useState({ description: "", amount: "", amount_type: "", conditions: "" });

  useEffect(() => {
    if (!listingId) return;
    Promise.all([
      fetch(`/api/landlord/listings/${listingId}/pet-policy`).then((r) => r.json()),
      fetch(`/api/landlord/listings/${listingId}/fees`).then((r) => r.json()),
      fetch(`/api/landlord/listings/${listingId}/concessions`).then((r) => r.json()),
      fetch("/api/fee-types").then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([pp, f, c, ft]) => {
      setPetPolicy(pp?.policy_text || "");
      setFees(Array.isArray(f) ? f : []);
      setConcessions(Array.isArray(c) ? c : []);
      setFeeTypes(Array.isArray(ft) ? ft : []);
    });
  }, [listingId]);

  const savePetPolicy = async () => {
    setSaving(true);
    const res = await fetch(`/api/landlord/listings/${listingId}/pet-policy`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy_text: petPolicy }),
    });
    setSaving(false);
    if (res.ok) toast.success("Pet policy saved"); else toast.error("Failed to save");
  };

  const addFee = async () => {
    if (!newFee.fee_type_id || !newFee.amount) { toast.error("Fee type and amount required"); return; }
    const res = await fetch(`/api/landlord/listings/${listingId}/fees`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newFee, amount: Number(newFee.amount) }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "Failed to add fee"); return; }
    setFees((p) => [...p, data]);
    setNewFee({ fee_type_id: "", amount: "", basis: "flat", refundable: false });
    setAddingFee(false);
    toast.success("Fee added");
  };

  const removeFee = async (id) => {
    await fetch(`/api/landlord/listings/${listingId}/fees/${id}`, { method: "DELETE" });
    setFees((p) => p.filter((f) => f.id !== id));
  };

  const addConcession = async () => {
    if (!newConcession.description.trim()) { toast.error("Description required"); return; }
    const res = await fetch(`/api/landlord/listings/${listingId}/concessions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newConcession, amount: newConcession.amount ? Number(newConcession.amount) : null }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "Failed to add concession"); return; }
    setConcessions((p) => [...p, data]);
    setNewConcession({ description: "", amount: "", amount_type: "", conditions: "" });
    setAddingConcession(false);
    toast.success("Concession added");
  };

  const removeConcession = async (id) => {
    await fetch(`/api/landlord/listings/${listingId}/concessions/${id}`, { method: "DELETE" });
    setConcessions((p) => p.filter((c) => c.id !== id));
  };

  return (
    <div className="space-y-7">
      {/* Pet policy */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Pet policy</h3>
        <textarea
          value={petPolicy}
          onChange={(e) => setPetPolicy(e.target.value)}
          rows={3}
          placeholder="Describe your pet policy…"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <button onClick={savePetPolicy} disabled={saving}
          className="mt-2 px-4 py-1.5 text-sm bg-gray-800 text-white rounded hover:bg-gray-900 disabled:opacity-50">
          {saving ? "Saving…" : "Save policy"}
        </button>
      </div>

      {/* Fees */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-800">Fees</h3>
          <button onClick={() => setAddingFee(true)} className="text-xs text-red-600 hover:text-red-700 font-medium">+ Add fee</button>
        </div>

        {fees.length > 0 && (
          <div className="space-y-2 mb-3">
            {fees.map((f) => (
              <div key={f.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                <span className="font-medium">{f.fee_types?.display_label || f.fee_type_id}</span>
                <span className="text-gray-600">${Number(f.amount).toLocaleString()} <span className="text-xs text-gray-400">{f.basis}</span></span>
                <button onClick={() => removeFee(f.id)} className="text-xs text-red-500 hover:text-red-700 ml-2">Remove</button>
              </div>
            ))}
          </div>
        )}

        {addingFee && (
          <div className="bg-gray-50 border border-red-200 rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fee type</label>
                <select value={newFee.fee_type_id} onChange={(e) => setNewFee((p) => ({ ...p, fee_type_id: e.target.value }))}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm bg-white">
                  <option value="">Select…</option>
                  {feeTypes.map((ft) => <option key={ft.id} value={ft.id}>{ft.display_label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount ($)</label>
                <input type="number" value={newFee.amount} onChange={(e) => setNewFee((p) => ({ ...p, amount: e.target.value }))}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Basis</label>
                <select value={newFee.basis} onChange={(e) => setNewFee((p) => ({ ...p, basis: e.target.value }))}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm bg-white">
                  {FEE_BASES.map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div className="flex items-end pb-1.5">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={newFee.refundable} onChange={(e) => setNewFee((p) => ({ ...p, refundable: e.target.checked }))} className="h-4 w-4 rounded" />
                  Refundable
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={addFee} className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">Add fee</button>
              <button onClick={() => setAddingFee(false)} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Concessions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-800">Concessions & offers</h3>
          <button onClick={() => setAddingConcession(true)} className="text-xs text-red-600 hover:text-red-700 font-medium">+ Add concession</button>
        </div>

        {concessions.length > 0 && (
          <div className="space-y-2 mb-3">
            {concessions.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-green-50 rounded-lg border border-green-200 text-sm">
                <span className="font-medium text-green-800">{c.description}</span>
                {c.amount && <span className="text-green-700">${Number(c.amount).toLocaleString()} {c.amount_type}</span>}
                <button onClick={() => removeConcession(c.id)} className="text-xs text-red-500 hover:text-red-700 ml-2">Remove</button>
              </div>
            ))}
          </div>
        )}

        {addingConcession && (
          <div className="bg-gray-50 border border-red-200 rounded-lg p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description *</label>
              <input type="text" value={newConcession.description} onChange={(e) => setNewConcession((p) => ({ ...p, description: e.target.value }))}
                placeholder="e.g. 1 month free on 12-month lease" className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount (optional)</label>
                <input type="number" value={newConcession.amount} onChange={(e) => setNewConcession((p) => ({ ...p, amount: e.target.value }))}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                <select value={newConcession.amount_type} onChange={(e) => setNewConcession((p) => ({ ...p, amount_type: e.target.value }))}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm bg-white">
                  <option value="">—</option>
                  <option value="flat">Flat ($)</option>
                  <option value="percentage">Percentage (%)</option>
                  <option value="months_free">Months free</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={addConcession} className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">Add</button>
              <button onClick={() => setAddingConcession(false)} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
            </div>
          </div>
        )}
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
