"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/admin/adminShared";
import { formatCents } from "@/lib/billing/money";
import { billingFetch } from "@/components/admin/billing/billingFetch";

async function call(url, options) {
  const res = await billingFetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const send = (url, method, body) =>
  call(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const OUTCOMES = {
  payment_started: ["green", "Invoiced, payment started"],
  invoiced: ["green", "Invoiced"],
  payment_failed: ["red", "Invoiced, payment failed"],
  deferred: ["gray", "Under $5, rolls to next month"],
  already_billed: ["gray", "Already billed this month"],
  nothing_to_bill: ["gray", "Nothing to bill"],
  unchanged: ["gray", "Already complete"],
  error: ["red", "Error"],
};

function Who({ landlord }) {
  return (
    <span className="text-xs text-gray-700">
      {landlord?.name || "Unnamed landlord"}
      {landlord?.email && <span className="text-gray-400"> ({landlord.email})</span>}
    </span>
  );
}

function DryRunResult({ result }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">
        Dry run for <strong>{result.billingPeriod.slice(0, 7)}</strong>: {result.newInvoiceCount} new invoice
        {result.newInvoiceCount === 1 ? "" : "s"}, <strong>{formatCents(result.grandTotalCents)}</strong> in total.
        Nothing was created.
        {result.invoices.length > result.newInvoiceCount &&
          ` ${result.invoices.length - result.newInvoiceCount} landlord(s) were already invoiced this month, so their new charges wait for next month and are not in the total.`}
        {result.openInvoices > 0 && ` ${result.openInvoices} open invoice(s) will be re-checked.`}
      </p>
      {result.invoices.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
          {result.invoices.map((inv) => (
            <li key={inv.landlord.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Who landlord={inv.landlord} />
                <p className="text-xs text-gray-500">{inv.chargeCount} charge{inv.chargeCount === 1 ? "" : "s"}</p>
              </div>
              {!inv.hasActivePaymentMethod && <Badge color="amber">No active payment method</Badge>}
              {inv.waitsForNextMonth && <Badge color="gray">Already invoiced, waits for next month</Badge>}
              <span className="text-sm font-semibold text-gray-900">{formatCents(inv.totalCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {result.deferred.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Under $5, not invoiced (rolls to next month)</p>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
            {result.deferred.map((d) => (
              <li key={d.landlordId} className="flex items-center gap-3 px-4 py-2">
                <div className="flex-1"><Who landlord={d.landlord} /></div>
                <span className="text-sm text-gray-700">{formatCents(d.totalCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LiveResult({ result }) {
  const s = result.summary;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">
        Billing run for <strong>{result.billingPeriod.slice(0, 7)}</strong>: {s.invoiced} invoiced, {s.paymentFailed} payment
        failed, {s.deferred} under $5, {s.alreadyBilled} already billed, {s.errors} error{s.errors === 1 ? "" : "s"}.
        {s.errors > 0 && " Run it again to finish the ones that errored; it picks up where it stopped."}
      </p>
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
        {result.results.map((r, i) => {
          const [color, label] = OUTCOMES[r.outcome] ?? ["gray", r.outcome];
          return (
            <li key={`${r.landlordId}-${i}`} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="font-mono text-xs text-gray-500">{String(r.landlordId).slice(0, 8)}</span>
              <Badge color={color}>{label}</Badge>
              {r.error && <span className="text-xs text-red-700">{r.error}</span>}
              <span className="ml-auto text-sm text-gray-700">{r.totalCents != null ? formatCents(r.totalCents) : ""}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function BillingRunPanel() {
  const [settings, setSettings] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await call("/api/admin/billing/run-settings"));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const dryRun = () => act(async () => setResult(await send("/api/admin/billing/run", "POST", { dryRun: true })));

  const liveRun = () => {
    if (!window.confirm("Create real invoices now and charge each landlord's default payment method?\n\nRun a dry run first to check the totals.")) return;
    return act(async () => setResult(await send("/api/admin/billing/run", "POST", { dryRun: false, confirm: true })));
  };

  const toggle = () => {
    const next = !settings.enabled;
    const text = next
      ? "Turn automatic monthly billing ON?\n\nOn the first Monday of each month the app will create real invoices and charge landlords without anyone clicking. Only do this after checking a dry run."
      : "Turn automatic monthly billing OFF? The monthly run will only compute a dry run.";
    if (!window.confirm(text)) return;
    return act(async () => setSettings(await send("/api/admin/billing/run-settings", "PUT", { enabled: next })));
  };

  return (
    <div className="space-y-4">
      {settings && (
        <div className="rounded-lg border border-gray-100 bg-white p-4 space-y-2 max-w-2xl">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium text-gray-900">Automatic monthly billing</p>
            <Badge color={settings.enabled ? "green" : "gray"}>{settings.enabled ? "ON" : "OFF (dry run only)"}</Badge>
            <button
              type="button"
              disabled={busy}
              onClick={toggle}
              className="ml-auto px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {settings.enabled ? "Turn off" : "Turn on"}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Billing happens on the first Monday of each month (America/Chicago). Next billing day:{" "}
            <strong>{settings.nextBillingDay}</strong>
            {settings.isBillingDay && " (today)"}. Current period: {settings.billingPeriod.slice(0, 7)}. While this is off, the
            Monday cron only computes a dry run and creates nothing.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={dryRun}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-60"
        >
          {busy ? "Working..." : "Run dry run"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={liveRun}
          className="px-4 py-2 rounded-lg border border-red-300 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          Run billing now
        </button>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {result && (result.dryRun ? <DryRunResult result={result} /> : <LiveResult result={result} />)}
    </div>
  );
}
