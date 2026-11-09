"use client";

import { useCallback, useEffect, useState } from "react";

async function call(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");
  return body;
}

const dateOnly = (iso) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/*
 * Autopay on the landlord's Payments tab (decisions of 2026-11-04). Off unless
 * the landlord turns it on: they choose one active saved method and tick the
 * authorisation shown for it, word for word what is stored. Each invoice is then
 * charged a few business days after it is emailed, and the email says when.
 * `methods` is passed so the card refreshes when a method is added or removed.
 */
export default function AutopayCard({ methods }) {
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setState(await call("/api/billing/autopay"));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, methods]);

  const choices = state?.choices ?? [];
  const selected = choices.find((c) => c.id === choice) ?? null;

  const startEditing = () => {
    setChoice(choices.find((c) => c.id !== state?.method?.id)?.id ?? choices[0]?.id ?? null);
    setAgreed(false);
    setEditing(true);
  };

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      setState(await fn());
      setEditing(false);
      setAgreed(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const turnOn = (e) => {
    e.preventDefault();
    if (!selected || !agreed) return;
    return act(() =>
      call("/api/billing/autopay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethodId: selected.id, authorized: true }),
      })
    );
  };

  const turnOff = () => {
    if (!window.confirm("Turn off autopay? Your invoices will wait for you to pay them.")) return;
    return act(() => call("/api/billing/autopay", { method: "DELETE" }));
  };

  if (!state) {
    return error ? <p className="text-sm text-red-700">{error}</p> : null;
  }

  return (
    <section id="autopay" className="bg-white rounded-lg border border-gray-100 shadow-sm">
      <div className="px-4 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-gray-900">Autopay</h2>
          <p className="mt-1 text-sm text-gray-500">
            Optional. With autopay on, each invoice is charged to the method you choose {state.businessDays} business
            days after we email it, so you always see the amount and date first.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            state.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
          }`}
        >
          {state.enabled ? "On" : "Off"}
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        {state.enabled && (
          <div className="text-sm text-gray-700 space-y-1">
            <p>
              Charging <span className="font-medium text-gray-900">{state.method?.description ?? "your chosen method"}</span>
              {state.authorizedAt ? `, since ${dateOnly(state.authorizedAt)}` : ""}.
            </p>
            {state.consecutiveFailures > 0 && (
              <p className="text-xs text-amber-800">
                The last autopay payment did not go through. If the next one fails too, autopay turns off and we will
                email you.
              </p>
            )}
          </div>
        )}

        {!state.enabled && !editing && (
          <p className="text-sm text-gray-600">
            {choices.length
              ? "Autopay is off. Invoices wait for you to pay them here."
              : "Autopay is off. Add a payment method below; once it is active you can choose it for autopay. A bank account can be chosen once it is verified."}
          </p>
        )}

        {editing ? (
          <form onSubmit={turnOn} className="space-y-3">
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-gray-900">Charge invoices to</legend>
              {choices.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="autopay-method"
                    checked={choice === c.id}
                    onChange={() => {
                      setChoice(c.id);
                      setAgreed(false);
                    }}
                  />
                  {c.description}
                </label>
              ))}
            </fieldset>
            {selected && (
              <label className="flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>{selected.consentText}</span>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={busy || !selected || !agreed}
                className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
              >
                {state.enabled ? "Use this method" : "Turn on autopay"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {choices.length > 0 && (!state.enabled || choices.some((c) => c.id !== state.method?.id)) && (
              <button
                type="button"
                disabled={busy}
                onClick={startEditing}
                className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {state.enabled ? "Change method" : "Turn on autopay"}
              </button>
            )}
            {state.enabled && (
              <button
                type="button"
                disabled={busy}
                onClick={turnOff}
                className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Turn off autopay
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
