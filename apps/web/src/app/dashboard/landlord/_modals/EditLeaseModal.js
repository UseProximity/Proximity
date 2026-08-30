"use client";

/*
 * Edit ONE offering — the counterpart to ListingFormPanel for a landlord whose
 * stake at a property is a lease rather than the property record.
 *
 * The editable surface is deliberately narrow: their own terms, and nothing that
 * belongs to the building or to another landlord. That mirrors the API
 * (/api/leases/[leaseId]), which re-asserts owner_id on the write, so this form
 * cannot offer a field the server would refuse anyway.
 */

import { useState } from "react";
import toast from "react-hot-toast";

const TERMS = [4, 5, 6, 9, 10, 12];

export default function EditLeaseModal({ property, lease, onClose, onSaved }) {
  const [rent, setRent] = useState(lease.rent ?? "");
  const [terms, setTerms] = useState(lease.leaseTermMonths ?? []);
  const [furnished, setFurnished] = useState(lease.furnished ?? false);
  const [availableFrom, setAvailableFrom] = useState(lease.availableFrom ?? "");
  const [unavailable, setUnavailable] = useState(!!lease.unavailable);
  const [saving, setSaving] = useState(false);

  const toggleTerm = (m) =>
    setTerms((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => a - b)));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/leases/${lease.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rent: rent === "" ? null : Number(rent),
          leaseTermMonths: terms,
          furnished,
          availableFrom: availableFrom || null,
          unavailable,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Could not save your changes.");
        return;
      }
      toast.success("Your listing was updated.");
      await onSaved?.();
      onClose();
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  };

  const unitName = lease.unitLabel ?? `${lease.bedrooms ?? "?"} bed · ${lease.bathrooms ?? "?"} bath`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-2xl">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Edit your listing</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            {unitName} at {property.title || property.address}
          </p>
          <p className="mt-2 text-xs text-gray-400">
            These are your terms only. The property&apos;s own details are managed by its owner.
          </p>
        </div>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Rent (per month)</span>
          <input
            type="number"
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            placeholder="Leave blank for “Contact for pricing”"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          />
        </label>

        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Lease lengths you accept</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {TERMS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => toggleTerm(m)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  terms.includes(m)
                    ? "bg-red-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {m} mo
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Available from</span>
          <input
            type="date"
            value={availableFrom ? String(availableFrom).slice(0, 10) : ""}
            onChange={(e) => setAvailableFrom(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={furnished} onChange={(e) => setFurnished(e.target.checked)} />
          Comes furnished
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={unavailable} onChange={(e) => setUnavailable(e.target.checked)} />
          Currently unavailable (hide from students)
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
