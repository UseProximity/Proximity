"use client";

import { useState } from "react";

const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500";

/*
 * The "create test charge" tool: puts a charge on a landlord account so the
 * dashboard, contest flow, review clock and billing run can be tried before the
 * Triggering project creates real ones. Only shown where the API allows it (never
 * on production).
 */
export default function TestChargeForm({ onCreated }) {
  const [email, setEmail] = useState("billing-landlord@example.com");
  const [amount, setAmount] = useState("25.00");
  const [triggerType, setTriggerType] = useState("test_charge");
  const [description, setDescription] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/admin/billing/test-charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ landlordEmail: email, amount, triggerType, description, confirm }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not create the charge.");
      setDone(`Created a ${body.status} charge.`);
      onCreated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-gray-100 bg-white p-4 max-w-lg">
      <p className="text-sm text-gray-600">
        Creates a test charge on a landlord account. Test charges are flagged and cannot be created on production.
      </p>
      <label className="block text-sm font-medium text-gray-700">
        Landlord email
        <input className={`${FIELD} mt-1`} value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <div className="flex gap-3">
        <label className="block flex-1 text-sm font-medium text-gray-700">
          Amount (dollars)
          <input className={`${FIELD} mt-1`} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label className="block flex-1 text-sm font-medium text-gray-700">
          Trigger type
          <input className={`${FIELD} mt-1`} value={triggerType} onChange={(e) => setTriggerType(e.target.value)} required />
        </label>
      </div>
      <label className="block text-sm font-medium text-gray-700">
        Description (optional)
        <input className={`${FIELD} mt-1`} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        Confirm it straight away (start the 7 day review)
      </label>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {done && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>}
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-60"
      >
        {busy ? "Creating..." : "Create test charge"}
      </button>
    </form>
  );
}
