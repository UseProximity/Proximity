"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import CollapsibleSection from "./CollapsibleSection";
import AgreementSigningFlow from "./AgreementSigningFlow";
import LicenseDisclosureFields, { useLicenseDisclosure } from "@/components/account/LicenseDisclosureFields";

/*
 * A payer: someone else who signs the marketing agreement and pays for a
 * landlord account (Project B, Wyatt 2026-11-09).
 *
 *   NamePayerForm      the landlord names them (name, email, and the landlord's own
 *                      license answer when they have none: it still shows on
 *                      their listings)
 *   PayerCard          the landlord's view once named: Pending, Declined or Signed,
 *                      with Resend and Change signer. Never the agreement itself.
 *   PaidForAccounts    the payer's view: each account they pay for, its covered
 *                      properties, what waits for their signature (Sign) and Void.
 */

const dateOnly = (iso) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Chicago" });
const INPUT = "mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-red-400 focus:outline-none";
const BUTTON = "px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60";
const PRIMARY = "rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60";

async function call(url, { method = "GET", body } = {}) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function PayerFields({ name, email, setName, setEmail, idPrefix }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm text-gray-700" htmlFor={`${idPrefix}-name`}>
        Their full name
        <input id={`${idPrefix}-name`} className={INPUT} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={100} />
      </label>
      <label className="block text-sm text-gray-700" htmlFor={`${idPrefix}-email`}>
        Their email
        <input id={`${idPrefix}-email`} type="email" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" maxLength={254} />
      </label>
    </div>
  );
}

// Inside the agreement card, for a landlord who has not signed: hand signing and paying to someone else.
export function NamePayerForm({ onDone, onCancel }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const license = useLicenseDisclosure();
  const needsLicense = !license.loading && !license.saved;

  const submit = async (e) => {
    e.preventDefault();
    if (needsLicense && !license.ready) return setError("Answer the real estate license question first.");
    setBusy(true);
    setError(null);
    try {
      await call("/api/billing/payer", { method: "POST", body: { name, email, ...(needsLicense && { licenseDisclosure: license.payload() }) } });
      toast.success(`We emailed ${name.trim()} the agreement and a link to sign.`);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-gray-200 px-3 py-3">
      <p className="text-sm text-gray-800">
        If the owner (or someone else) signs and pays instead of you, enter their details. We email them the agreement and the Missouri
        Broker Disclosure Form with a link to sign. Invoices go to them, and you see your charges here. Your listings wait as drafts until
        they sign.
      </p>
      <PayerFields name={name} email={email} setName={setName} setEmail={setEmail} idPrefix="payer" />
      {needsLicense && (
        <div className="border-t border-gray-100 pt-3">
          <p className="text-sm font-medium text-gray-900">Your real estate license</p>
          <p className="text-xs text-gray-500">Missouri requires this on your listings, whoever signs the agreement.</p>
          <div className="mt-2">
            <LicenseDisclosureFields state={license} idPrefix="payer-license" />
          </div>
        </div>
      )}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={PRIMARY} disabled={busy || !name.trim() || !email.trim() || license.loading}>
          {busy ? "Sending..." : "Send to sign"}
        </button>
      </div>
    </form>
  );
}

const STATUS = {
  pending: { label: "Pending", className: "bg-amber-100 text-amber-800" },
  declined: { label: "Declined", className: "bg-red-100 text-red-800" },
  signed: { label: "Signed", className: "bg-green-100 text-green-800" },
};

// The landlord's agreement card once a payer is named: status only (Wyatt, 2026-11-09).
export function PayerCard({ view, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const status = STATUS[view.status] ?? STATUS.pending;

  const act = async (body, done) => {
    setBusy(true);
    try {
      const r = await call("/api/billing/payer", { method: "PATCH", body });
      toast.success(done);
      setChanging(false);
      onChanged(r.payer);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CollapsibleSection
      id="marketing-agreement"
      title="Marketing agreement"
      defaultOpen
      badge={<span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>{status.label}</span>}
      summary={`Signed and paid by ${view.payer.name}.`}
    >
      <div className="space-y-4 px-4 py-4">
        <p className="text-sm text-gray-700">
          {view.status === "signed"
            ? `${view.payer.name} signed the agreement for your account${view.signedAt ? ` on ${dateOnly(view.signedAt)}` : ""}. They receive and pay your invoices.`
            : view.status === "declined"
              ? `${view.payer.name} declined to sign. Our team is in touch with them. Questions? Email info@useproximity.org.`
              : `Waiting for ${view.payer.name} (${view.payer.email}) to sign. We emailed them on ${dateOnly(view.payer.invitedAt)}.`}
        </p>

        {view.waiting.length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-900">Waiting for {view.payer.name} to sign ({view.waiting.length}):</p>
            <ul className="mt-1 space-y-1 text-sm text-gray-800">
              {view.waiting.map((w) => (
                <li key={w.listingId}>
                  {w.address} <span className="text-xs text-gray-500">(draft, sent {dateOnly(w.since)})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-gray-900">Covered ({view.covered.length}):</p>
          {view.covered.length ? (
            <ul className="mt-1 space-y-1 text-sm text-gray-800">
              {view.covered.map((c) => (
                <li key={c.listingId}>{c.address}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">Nothing yet. Your listings are covered once {view.payer.name} signs.</p>
          )}
        </div>

        {view.status !== "signed" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} disabled={busy} onClick={() => act({ action: "resend" }, `Emailed ${view.payer.name} again.`)}>
              Resend
            </button>
            {view.canChange && (
              <button type="button" className={BUTTON} disabled={busy} onClick={() => setChanging((c) => !c)}>
                Change signer
              </button>
            )}
          </div>
        )}
        {!view.canChange && (
          <p className="text-xs text-gray-500">{view.payer.name} has signed for your account, so only they can void it.</p>
        )}

        {changing && (
          <form
            className="space-y-3 rounded-md border border-gray-200 px-3 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              act({ action: "change", name, email }, `We emailed ${name.trim()} the agreement and a link to sign.`);
            }}
          >
            <p className="text-sm text-gray-700">The link we sent {view.payer.name} stops working, and anything waiting moves to the new signer.</p>
            <PayerFields name={name} email={email} setName={setName} setEmail={setEmail} idPrefix="change-payer" />
            <div className="flex justify-end gap-2">
              <button type="button" className={BUTTON} onClick={() => setChanging(false)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className={PRIMARY} disabled={busy || !name.trim() || !email.trim()}>
                Send to sign
              </button>
            </div>
          </form>
        )}
      </div>
    </CollapsibleSection>
  );
}

/*
 * In the payer's agreement section (Wyatt, 2026-11-09: listed under the
 * agreement, not among their own listings): every account they pay for.
 */
export function PaidForAccounts({ accounts, onChanged }) {
  const [signing, setSigning] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [busy, setBusy] = useState(false);
  // Only one master per payer at a time: an addendum for another account waits for it.
  const firstNeedingAgreement = accounts.find((a) => a.needs === "agreement")?.landlordId ?? null;

  const voidFor = async (account) => {
    setBusy(true);
    try {
      const r = await call("/api/billing/payees", { method: "POST", body: { action: "void", landlordId: account.landlordId, confirm: true } });
      toast.success(`Voided for ${account.accountName}. ${r.released} ${r.released === 1 ? "property" : "properties"} came off your agreement.`);
      setVoiding(null);
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!accounts.length) return null;
  return (
    <div className="space-y-3 border-t border-gray-100 pt-3">
      <p className="text-sm font-medium text-gray-900">Properties you pay for</p>
      {accounts.map((a) => {
        const blocked = a.needs === "agreement" && firstNeedingAgreement !== a.landlordId;
        return (
          <div key={a.landlordId} className="rounded-md border border-gray-100 px-3 py-3">
            <p className="text-sm font-semibold text-gray-900">
              {a.accountName}
              {a.accountEmail && a.accountEmail !== a.accountName ? <span className="ml-1 text-xs font-normal text-gray-500">({a.accountEmail})</span> : null}
            </p>
            {a.covered.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-sm text-gray-800">
                {a.covered.map((c) => (
                  <li key={c.listingId}>{c.address}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-gray-500">No properties covered yet.</p>
            )}
            {a.needs && (
              <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-2">
                <p>
                  {a.needs === "agreement" ? "Sign the marketing agreement" : "Sign an addendum"} to cover
                  {a.waiting.length ? ` ${a.waiting.length === 1 ? "this property" : `these ${a.waiting.length} properties`}:` : " their listings."}
                  {a.declined ? " You declined the last copy; you can sign whenever you are ready." : ""}
                </p>
                {a.waiting.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-5">
                    {a.waiting.map((w) => (
                      <li key={w.listingId}>{w.address}</li>
                    ))}
                  </ul>
                )}
                {blocked ? (
                  <p className="text-xs">Sign the agreement for your other account first. This one opens right after.</p>
                ) : (
                  <button type="button" className={PRIMARY} disabled={busy || !!signing} onClick={() => setSigning(a.landlordId)}>
                    Review and sign
                  </button>
                )}
              </div>
            )}
            <div className="mt-2">
              {voiding === a.landlordId ? (
                <div className="space-y-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800">
                  <p>
                    Void your agreement for {a.accountName}? Their properties come off your agreement and they will need a new one before
                    publishing. Your agreement stays in force for everything else.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className={BUTTON} disabled={busy} onClick={() => setVoiding(null)}>
                      Keep it
                    </button>
                    <button type="button" className={PRIMARY} disabled={busy} onClick={() => voidFor(a)}>
                      Void for this account
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="text-xs text-gray-500 underline hover:text-gray-700" onClick={() => setVoiding(a.landlordId)}>
                  Stop paying for this account
                </button>
              )}
            </div>
          </div>
        );
      })}
      {signing && (
        <AgreementSigningFlow
          accountId={signing}
          onFinished={(result) => {
            setSigning(null);
            onChanged(result);
          }}
        />
      )}
    </div>
  );
}
