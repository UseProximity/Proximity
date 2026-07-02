"use client";

/*
 * CopyLinkBox: shows the ambassador's shareable /refer/<userId> link + copy button.
 * The absolute URL is built from window.location.origin so it's correct in dev & prod.
 *
 * Countdown: live countdown to the ambassador competition deadline (July 1).
 *
 * PaymentMethodBox: lets the ambassador save how they want to be paid (Zelle/Venmo) +
 * their username, persisted to users.payment_method / users.payment_handle.
 */

import { useState, useEffect } from "react";

// ─── Countdown to July 1 ───────────────────────────────────────────────────────
// Counts down to 00:00 on the upcoming July 1 (this year, or next year once it has
// passed). Ticks every second on the client; renders nothing until mounted so the
// server and client markup match.

function getDeadline() {
  const now = new Date();
  const year = now.getFullYear();
  const julyFirst = new Date(year, 6, 1, 0, 0, 0, 0); // month is 0-indexed → 6 = July
  return now < julyFirst ? julyFirst : new Date(year + 1, 6, 1, 0, 0, 0, 0);
}

function timeParts(msLeft) {
  const clamped = Math.max(0, msLeft);
  const totalSeconds = Math.floor(clamped / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export function Countdown() {
  const [msLeft, setMsLeft] = useState(null);

  useEffect(() => {
    const deadline = getDeadline();
    const tick = () => setMsLeft(deadline.getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Avoid hydration mismatch: render a stable placeholder until mounted.
  const parts = msLeft == null ? null : timeParts(msLeft);
  const isOver = msLeft != null && msLeft <= 0;

  const cells = [
    { label: "days", value: parts?.days },
    { label: "hrs", value: parts?.hours },
    { label: "min", value: parts?.minutes },
    { label: "sec", value: parts?.seconds },
  ];

  return (
    <div className="bg-gradient-to-r from-red-600 to-red-500 rounded-xl shadow-sm p-4 text-white">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold">
            {isOver ? "Competition closed" : "Competition ends July 1"}
          </div>
          <div className="text-xs text-red-100">
            {isOver ? "Winners will be announced soon." : "Get your referrals in before the deadline!"}
          </div>
        </div>
        <div className="flex gap-2">
          {cells.map((c) => (
            <div
              key={c.label}
              className="bg-white/15 rounded-lg px-2.5 py-1.5 text-center min-w-[44px]"
            >
              <div className="text-lg font-bold leading-none tabular-nums">
                {c.value == null ? "--" : String(c.value).padStart(2, "0")}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-red-100 mt-0.5">
                {c.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CopyLinkBox({ userId }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const link = origin ? `${origin}/refer/${userId}` : "";

  function copy() {
    if (!link) return;
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <label className="block text-sm font-semibold text-gray-800 mb-1.5">
        Your referral link
      </label>
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          placeholder="Loading…"
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
        />
        <button
          onClick={copy}
          disabled={!link}
          className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold whitespace-nowrap disabled:opacity-50"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Share this with students who’ve lived somewhere — every review they submit through
        it is credited to you.
      </p>
    </div>
  );
}

// ─── PaymentMethodBox ──────────────────────────────────────────────────────────
// Lets the ambassador pick how they'd like to be paid (Zelle/Venmo) and enter their
// username. Loads the current value from /api/referralPayment and saves changes back.

export function PaymentMethodBox() {
  const [method, setMethod] = useState("");
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // "saved" | "error" | null
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/referralPayment");
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setMethod(data.method || "");
        setHandle(data.handle || "");
      } catch {
        /* non-blocking */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handlePlaceholder =
    method === "venmo" ? "@your-venmo" : method === "zelle" ? "email or phone" : "username";

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setError("");
    setStatus(null);

    if (!method) return setError("Choose Zelle or Venmo.");
    if (!handle.trim()) return setError("Enter your payment username.");

    setSaving(true);
    try {
      const res = await fetch("/api/referralPayment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, handle: handle.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data.error || "Could not save.");
        return;
      }
      setStatus("saved");
      setTimeout(() => setStatus(null), 2000);
    } catch {
      setStatus("error");
      setError("Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const radioClass = (m) =>
    `flex-1 px-3 py-2 rounded-lg border text-sm font-semibold text-center cursor-pointer transition ${
      method === m
        ? "border-red-500 bg-red-50 text-red-700"
        : "border-gray-300 text-gray-600 hover:border-gray-400"
    }`;

  return (
    <form onSubmit={save} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <label className="block text-sm font-semibold text-gray-800 mb-1.5">
        How should we pay you?
      </label>
      <p className="text-xs text-gray-400 mb-3">
        If you win a prize, we&apos;ll send it here. You can update this anytime.
      </p>

      <div className="flex gap-2 mb-3">
        {["zelle", "venmo"].map((m) => (
          <label key={m} className={radioClass(m)}>
            <input
              type="radio"
              name="payment-method"
              value={m}
              checked={method === m}
              onChange={() => setMethod(m)}
              className="sr-only"
            />
            {m === "zelle" ? "Zelle" : "Venmo"}
          </label>
        ))}
      </div>

      <input
        type="text"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        placeholder={loading ? "Loading…" : handlePlaceholder}
        disabled={loading}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 disabled:bg-gray-50"
      />

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

      <div className="flex items-center gap-3 mt-3">
        <button
          type="submit"
          disabled={saving || loading}
          className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-green-600 font-medium">Saved!</span>
        )}
      </div>
    </form>
  );
}
