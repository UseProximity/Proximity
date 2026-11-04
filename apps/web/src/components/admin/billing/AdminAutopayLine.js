"use client";

import { useState } from "react";
import { fmtDate } from "@/components/admin/adminShared";

/*
 * One landlord's autopay, in the admin landlord list. Admins can see it and turn
 * it off (for example when the landlord asks by email); the landlord is emailed
 * that it is off. Only the landlord can turn it on.
 */
export default function AdminAutopayLine({ landlordId, autopay }) {
  const [current, setCurrent] = useState(autopay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!current) return <p>Autopay off.</p>;

  const turnOff = async () => {
    if (!window.confirm("Turn off this landlord's autopay? They will be emailed that it is off, and only they can turn it back on.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/billing/autopay/${landlordId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not turn off autopay.");
      setCurrent(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p>
        Autopay on: {current.methodDescription ?? "method on file"}
        {current.authorizedAt ? ` (since ${fmtDate(current.authorizedAt)})` : ""}
        {current.consecutiveFailures ? ` · ${current.consecutiveFailures} failed in a row` : ""}
      </p>
      <button type="button" disabled={busy} onClick={turnOff} className="text-xs text-red-700 underline disabled:opacity-60">
        Turn off
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
