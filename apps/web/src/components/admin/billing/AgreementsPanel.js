"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, fmtDate } from "@/components/admin/adminShared";

async function call(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500";

const STATUS_BADGE = {
  not_sent: ["gray", "Not sent"],
  sent: ["amber", "Sent"],
  signed: ["green", "Signed"],
};

function GateSwitch({ label, help, on, busy, onToggle }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{help}</p>
      </div>
      <Badge color={on ? "green" : "gray"}>{on ? "ON" : "OFF"}</Badge>
      <button
        type="button"
        disabled={busy}
        onClick={onToggle}
        className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
      >
        {on ? "Turn off" : "Turn on"}
      </button>
    </div>
  );
}

/*
 * Commission agreements and the listing gate. There is no e-signature provider
 * yet, so each step is recorded by hand: mark an agreement sent, then signed
 * (with the signed PDF if you have it). The two switches decide whether a
 * landlord needs an active payment method and a signed agreement to publish a
 * listing. Both start off, so turn them on at launch, after landlords have been
 * told.
 */
export default function AgreementsPanel({ search }) {
  const [settings, setSettings] = useState(null);
  const [agreements, setAgreements] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [action, setAction] = useState("send");
  const [signerName, setSignerName] = useState("");
  const [signedAt, setSignedAt] = useState("");
  const [file, setFile] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([call("/api/admin/billing/gate-settings"), call("/api/admin/billing/agreements")]);
      setSettings(s);
      setAgreements(a.agreements);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, success) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (success) setNotice(success);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (field, label) => {
    const next = !settings[field];
    const text = next
      ? `Turn ON: ${label}?\n\nLandlords without this will be unable to publish new listings, units or offerings. Make sure they have been told first. Drafts stay saved.`
      : `Turn OFF: ${label}?`;
    if (!window.confirm(text)) return;
    return run(() => call("/api/admin/billing/gate-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: next }) }), "Saved.");
  };

  const submit = (e) => {
    e.preventDefault();
    const form = new FormData();
    form.set("landlordEmail", email);
    form.set("action", action);
    if (action === "sign") {
      form.set("signerName", signerName);
      if (signedAt) form.set("signedAt", signedAt);
      if (file) form.set("file", file);
    }
    return run(async () => {
      await call("/api/admin/billing/agreements", { method: "POST", body: form });
      setFile(null);
    }, action === "send" ? "Marked as sent." : action === "sign" ? "Marked as signed." : "Agreement voided.");
  };

  const openSigned = (agreement) =>
    run(async () => {
      const { url } = await call(`/api/admin/billing/agreements/${agreement.id}/file`);
      window.open(url, "_blank", "noopener,noreferrer");
    });

  const voidOne = (agreement) => {
    if (!window.confirm(`Void the agreement for ${agreement.landlord.email}? A new one can then be started.`)) return;
    return run(() => call("/api/admin/billing/agreements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ landlordEmail: agreement.landlord.email, action: "void" }) }), "Agreement voided.");
  };

  const shown = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    if (!agreements) return [];
    return q ? agreements.filter((a) => [a.landlord.email, a.landlord.name].some((v) => String(v ?? "").toLowerCase().includes(q))) : agreements;
  }, [agreements, search]);

  if (!settings && !error) return <p className="py-10 text-center text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-5">
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</div>}

      {settings && (
        <div className="rounded-lg border border-gray-100 bg-white p-4 space-y-4 max-w-2xl">
          <p className="text-sm text-gray-600">
            To publish a listing, a landlord must have these. Both start OFF so nothing is blocked until landlords have
            been told and had time to set up.
          </p>
          <GateSwitch
            label="Require an active payment method"
            help="Blocks publishing a new listing, unit or offering without one."
            on={settings.requirePaymentMethod}
            busy={busy}
            onToggle={() => toggle("requirePaymentMethod", "require an active payment method")}
          />
          <GateSwitch
            label="Require a signed commission agreement"
            help="Leave off until the agreement is ready."
            on={settings.requireAgreement}
            busy={busy}
            onToggle={() => toggle("requireAgreement", "require a signed commission agreement")}
          />
        </div>
      )}

      <form onSubmit={submit} className="rounded-lg border border-gray-100 bg-white p-4 space-y-3 max-w-2xl">
        <p className="text-sm font-medium text-gray-900">Record an agreement step</p>
        <div className="flex flex-wrap gap-3">
          <label className="block flex-1 min-w-[14rem] text-sm font-medium text-gray-700">
            Landlord email
            <input className={`${FIELD} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Step
            <select className={`${FIELD} mt-1`} value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="send">Mark as sent</option>
              <option value="sign">Mark as signed</option>
              <option value="void">Void</option>
            </select>
          </label>
        </div>
        {action === "sign" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <label className="block flex-1 min-w-[14rem] text-sm font-medium text-gray-700">
                Signed by
                <input className={`${FIELD} mt-1`} value={signerName} onChange={(e) => setSignerName(e.target.value)} required />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Date signed (optional)
                <input className={`${FIELD} mt-1`} type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />
              </label>
            </div>
            <label className="block text-sm font-medium text-gray-700">
              Signed PDF (optional, up to 4 MB)
              <input
                className="mt-1 block w-full text-sm"
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save"}
        </button>
      </form>

      {agreements && shown.length === 0 && (
        <p className="rounded-lg border border-gray-100 bg-white px-4 py-6 text-sm text-gray-500">No agreements recorded yet.</p>
      )}
      {shown.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
          {shown.map((a) => {
            const [color, label] = STATUS_BADGE[a.status] ?? ["gray", a.status];
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">
                    {a.landlord.name || "Unnamed landlord"}
                    {a.landlord.email && <span className="text-xs text-gray-400"> ({a.landlord.email})</span>}
                  </p>
                  <p className="text-xs text-gray-500">
                    Version {a.version}
                    {a.status === "signed" && ` · signed ${fmtDate(a.signedAt)}${a.signerName ? ` by ${a.signerName}` : ""}`}
                  </p>
                </div>
                <Badge color={color}>{label}</Badge>
                {a.hasSignedFile && (
                  <button type="button" disabled={busy} onClick={() => openSigned(a)} className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                    Signed copy
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => voidOne(a)} className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60">
                  Void
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
