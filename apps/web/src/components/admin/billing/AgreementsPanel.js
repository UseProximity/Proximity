"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, fmtDate } from "@/components/admin/adminShared";
import AgreementVersions from "./agreements/AgreementVersions";
import LandlordAgreementList from "./agreements/LandlordAgreementList";
import { FIELD, PRIMARY, call } from "./agreements/shared";

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

// Recording a paper-signed agreement (or clearing one) by hand.
function ManualRecord({ busy, run }) {
  const [email, setEmail] = useState("");
  const [action, setAction] = useState("sign");
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [signedAt, setSignedAt] = useState("");
  const [file, setFile] = useState(null);

  const submit = (e) => {
    e.preventDefault();
    if (action === "void" && !window.confirm(`Void the agreement for ${email}? A Documenso copy still waiting is cancelled too.`)) return;
    const form = new FormData();
    form.set("landlordEmail", email);
    form.set("action", action);
    if (action === "sign") {
      form.set("signerName", signerName);
      if (signerTitle) form.set("signerTitle", signerTitle);
      if (signedAt) form.set("signedAt", signedAt);
      if (file) form.set("file", file);
    }
    return run(async () => {
      await call("/api/admin/billing/agreements", { method: "POST", body: form });
      setFile(null);
    }, action === "send" ? "Marked as sent." : action === "sign" ? "Recorded as signed." : "Agreement voided.");
  };

  return (
    <details className="rounded-lg border border-gray-100 bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium text-gray-900">Record a paper agreement by hand</summary>
      <form onSubmit={submit} className="mt-3 space-y-3 max-w-2xl">
        <p className="text-xs text-gray-500">
          For a landlord who signed on paper, or to void an agreement. Landlords normally sign in the app.
        </p>
        <div className="flex flex-wrap gap-3">
          <label className="block flex-1 min-w-[14rem] text-sm font-medium text-gray-700">
            Landlord email
            <input className={`${FIELD} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Step
            <select className={`${FIELD} mt-1`} value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="sign">Record as signed</option>
              <option value="send">Mark as sent</option>
              <option value="void">Void</option>
            </select>
          </label>
        </div>
        {action === "sign" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <label className="block flex-1 min-w-[12rem] text-sm font-medium text-gray-700">
                Signed by
                <input className={`${FIELD} mt-1`} value={signerName} onChange={(e) => setSignerName(e.target.value)} required />
              </label>
              <label className="block flex-1 min-w-[10rem] text-sm font-medium text-gray-700">
                Title (optional)
                <input className={`${FIELD} mt-1`} value={signerTitle} maxLength={100} onChange={(e) => setSignerTitle(e.target.value)} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Date signed (optional)
                <input className={`${FIELD} mt-1`} type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />
              </label>
            </div>
            <label className="block text-sm font-medium text-gray-700">
              Signed PDF (optional, up to 4 MB)
              <input className="mt-1 block w-full text-sm" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        )}
        <button type="submit" disabled={busy} className={PRIMARY}>
          {busy ? "Saving..." : "Save"}
        </button>
      </form>
    </details>
  );
}

/*
 * Landlords and agreements: the commission agreement document and its versions,
 * the two listing requirements, and every landlord's agreement and payment status,
 * with the signing email to send. A paper signature can still be recorded by hand.
 */
export default function AgreementsPanel({ search }) {
  const [settings, setSettings] = useState(null);
  const [versions, setVersions] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const [s, v, e] = await Promise.all([
        call("/api/admin/billing/gate-settings"),
        call("/api/admin/billing/agreement-versions"),
        call("/api/admin/billing/enrollment").catch(() => null),
      ]);
      setSettings(s);
      setVersions(v);
      setEnrollment(e);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Runs an action, then reloads everything. A string returned by `fn` is shown as the notice.
  const run = async (fn, success) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      setNotice(typeof result === "string" ? result : success ?? null);
      await load();
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
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
    return run(
      () => call("/api/admin/billing/gate-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: next }) }),
      "Saved."
    );
  };

  if (!settings && !error) return <p className="py-10 text-center text-sm text-gray-400">Loading...</p>;

  const deadlineNote =
    enrollment?.deadline && !enrollment.enforcedAt
      ? `Both turn on automatically on the enrollment deadline, ${fmtDate(`${enrollment.deadline}T12:00:00Z`)}${enrollment.includeAgreement ? "" : " (the agreement only if the enrollment email asks for it)"}.`
      : enrollment?.enforcedAt
        ? `Switched on automatically at the enrollment deadline on ${fmtDate(enrollment.enforcedAt)}.`
        : "Set an enrollment deadline (Launch enrollment) to have them turn on automatically.";

  return (
    <div className="space-y-5">
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</div>}

      {settings && (
        <div className="rounded-lg border border-gray-100 bg-white p-4 space-y-4">
          <p className="text-sm text-gray-600">To publish a listing, a landlord must have these. {deadlineNote}</p>
          <GateSwitch
            label="Require an active payment method"
            help="Blocks publishing a new listing, unit or offering without one."
            on={settings.requirePaymentMethod}
            busy={busy}
            onToggle={() => toggle("requirePaymentMethod", "require an active payment method")}
          />
          <GateSwitch
            label="Require a signed commission agreement"
            help="Make an agreement version live before turning this on."
            on={settings.requireAgreement}
            busy={busy}
            onToggle={() => toggle("requireAgreement", "require a signed commission agreement")}
          />
        </div>
      )}

      {versions && (
        <AgreementVersions versions={versions.versions} documensoConnected={versions.documensoConnected} busy={busy} run={run} />
      )}

      <LandlordAgreementList search={search} busy={busy} run={run} reloadKey={reloadKey} />

      <ManualRecord busy={busy} run={run} />
    </div>
  );
}
