"use client";

import { useCallback, useEffect, useState } from "react";
import SignAgreementDialog from "./SignAgreementDialog";

const STATUS = {
  signed: { label: "Signed", className: "bg-green-100 text-green-800" },
  needs_resign: { label: "New version to sign", className: "bg-amber-100 text-amber-800" },
  expired: { label: "Term ended, sign again", className: "bg-amber-100 text-amber-800" },
  in_progress: { label: "Started, not signed yet", className: "bg-amber-100 text-amber-800" },
  not_signed: { label: "Not signed", className: "bg-gray-100 text-gray-700" },
};

const dateOnly = (iso) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const rate = (r) => (r == null ? null : `${Number(r).toLocaleString("en-US", { maximumFractionDigits: 3 })}%`);

const BUTTON = "px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60";
const FIELD = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";

function Requirement({ done, children }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
          done ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        }`}
        aria-hidden="true"
      >
        {done ? "✓" : "!"}
      </span>
      <span className={done ? "text-gray-600" : "text-gray-900"}>{children}</span>
    </li>
  );
}

// The signer's full name and title, the "authorised to sign" confirmation, then the button that opens the document.
const fullName = (n) => n.trim().split(/\s+/).length >= 2;

function SignForm({ intro, button, busy, onStart, defaultName = "" }) {
  const [name, setName] = useState(defaultName);
  const [title, setTitle] = useState("");
  const [authorized, setAuthorized] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ signerName: name, signerTitle: title, authorized });
      }}
    >
      {intro && <p className="text-sm text-gray-700">{intro}</p>}
      <label className="block max-w-sm text-sm font-medium text-gray-700">
        Your full name
        <input className={`${FIELD} mt-1`} value={name} maxLength={100} autoComplete="name" placeholder="First and last name" onChange={(e) => setName(e.target.value)} required />
        <span className="mt-1 block text-xs font-normal text-gray-500">First and last, as it should appear on the agreement.</span>
      </label>
      <label className="block max-w-sm text-sm font-medium text-gray-700">
        Your title
        <input className={`${FIELD} mt-1`} value={title} maxLength={100} placeholder="Owner, Property Manager, ..." onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} required />
        <span>I am authorised to sign this agreement for the landlord or company that owns these listings.</span>
      </label>
      <button
        type="submit"
        disabled={busy || !fullName(name) || !title.trim() || !authorized}
        className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
      >
        {button}
      </button>
    </form>
  );
}

function PropertyList({ items }) {
  return (
    <ul className="space-y-1 text-sm">
      {items.map((p) => (
        <li key={p.listingId} className="text-gray-800">
          {p.address}
          {p.units?.length ? <span className="text-xs text-gray-500"> ({p.units.join(", ")})</span> : null}
        </li>
      ))}
    </ul>
  );
}

// Every signed document: the agreement and Exhibit A of each master, and each amendment.
function Documents({ open, busy }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch("/api/billing/agreement/documents")
      .then((r) => r.json())
      .then((d) => setDocs(d.documents ?? []))
      .catch(() => setError("Could not load your documents."));
  }, []);
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!docs) return <p className="text-sm text-gray-400">Loading...</p>;
  const shown = docs.filter((d) => d.status === "signed" || d.status === "superseded");
  if (!shown.length) return <p className="text-sm text-gray-500">No signed documents yet.</p>;
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {shown.map((d) => (
        <li key={`${d.kind}:${d.id}`} className="flex flex-wrap items-center gap-2 py-2">
          <span className="min-w-0 flex-1 text-gray-800">
            {d.kind === "amendment" ? "Exhibit A amendment" : "Commission agreement"}
            {d.versionLabel ? ` (${d.versionLabel})` : ""}, signed {d.signedAt ? dateOnly(d.signedAt) : ""}
            {d.status === "superseded" ? <span className="text-xs text-gray-400"> (replaced)</span> : null}
            <span className="block text-xs text-gray-500">
              {d.properties.length} {d.properties.length === 1 ? "property" : "properties"}
              {d.kind === "amendment" && d.previous ? `, ${d.properties.length - d.previous.length} added` : ""}
            </span>
          </span>
          {d.hasSignedFile && (
            <button type="button" disabled={busy} className={BUTTON} onClick={() => open({ kind: d.kind, id: d.id, part: "agreement" })}>
              {d.kind === "amendment" ? "Amendment" : "Agreement"}
            </button>
          )}
          {d.hasSignedExhibit && (
            <button type="button" disabled={busy} className={BUTTON} onClick={() => open({ kind: d.kind, id: d.id, part: "exhibit" })}>
              Exhibit A
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/*
 * The commission agreement on the Payments tab: where the landlord stands, which
 * properties it covers (Exhibit A), signing it or an amendment for properties not
 * covered yet, and every signed document. The checklist only lists a requirement
 * that is switched on. `changeRequests` is the "Request changes" panel, rendered
 * at the bottom.
 */
export default function AgreementCard({ gate, hasActivePaymentMethod, onChanged, busy, user, changeRequests = null }) {
  const agreement = gate.agreement;
  const status = STATUS[agreement.status] ?? STATUS.not_signed;
  const signedOk = agreement.status === "signed";
  const showChecklist = gate.requirePaymentMethod || gate.requireAgreement;
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsKey, setDocsKey] = useState(0);
  const uncoveredLive = agreement.uncoveredLive ?? [];
  const covered = agreement.covered ?? [];

  const enrollmentWindow = gate.enrollment;
  const needsAgreement = enrollmentWindow?.includeAgreement && !signedOk;
  const showWindow = enrollmentWindow?.deadline && (!hasActivePaymentMethod || needsAgreement);
  const deadline = enrollmentWindow?.deadline
    ? new Date(`${enrollmentWindow.deadline}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null;

  const openFile = useCallback(async ({ kind, id, part }) => {
    setError(null);
    try {
      const qs = new URLSearchParams({ kind, part, ...(id ? { id } : {}) });
      const res = await fetch(`/api/billing/agreement/file?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not open that document.");
      window.open(data.url, "_blank", "noopener");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const start = async (body) => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/agreement/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      if (data.alreadySigned) onChanged("signed");
      else setSession({ token: data.token, host: data.host, kind: data.kind });
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const masterIntro =
    agreement.status === "needs_resign"
      ? `We have updated the agreement${agreement.liveVersionLabel ? ` (${agreement.liveVersionLabel})` : ""}. Please review and sign the new version.`
      : agreement.status === "expired"
        ? "Your agreement's one-year term has ended. Sign the current version to keep publishing new listings."
        : agreement.status === "in_progress"
          ? "You started signing the agreement. Pick up where you left off."
          : "Review the agreement and sign it here. It takes about two minutes. Its Exhibit A lists the properties you have live.";

  return (
    <section id="commission-agreement" className="scroll-mt-24 bg-white rounded-lg border border-gray-100 shadow-sm">
      {showWindow && (
        <div className="rounded-t-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Proximity now collects fees in the app. Please {needsAgreement ? "add a payment method and sign the commission agreement" : "add a payment method"} by{" "}
          <strong>{deadline}</strong>. A bank account (ACH) is the recommended option.
        </div>
      )}
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-base font-semibold text-gray-900">Commission agreement</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>{status.label}</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          The agreement sets out the fee Proximity charges when it brings you a tenant. Its Exhibit A lists the properties it covers.
        </p>
      </div>

      {showChecklist && (
        <div className="px-4 pt-4">
          <p className="text-sm font-medium text-gray-900">Before you can publish a listing</p>
          <ul className="mt-2 space-y-1.5">
            {gate.requirePaymentMethod && <Requirement done={hasActivePaymentMethod}>Add an active payment method</Requirement>}
            {gate.requireAgreement && (
              <Requirement done={signedOk}>Sign the commission agreement. New properties are added to it when you publish them.</Requirement>
            )}
          </ul>
          {!gate.allowed && <p className="mt-2 text-xs text-gray-500">Your drafts are saved. You can publish them as soon as these are done.</p>}
        </div>
      )}

      <div className="space-y-4 px-4 py-4">
        {(signedOk || agreement.status === "needs_resign" || agreement.status === "expired") && agreement.signedAt && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-gray-600">
              {signedOk ? "Signed" : "You signed the previous agreement"} {dateOnly(agreement.signedAt)}
              {agreement.signerName ? ` by ${agreement.signerName}` : ""}
              {agreement.signerTitle ? `, ${agreement.signerTitle}` : ""}
              {agreement.signedVersionLabel ? ` (${agreement.signedVersionLabel})` : ""}.
              {signedOk && agreement.termEnd ? ` Runs until ${dateOnly(agreement.termEnd)}.` : ""}
              {agreement.commissionRatePercent != null ? ` Commission rate ${rate(agreement.commissionRatePercent)}.` : ""}
            </p>
            {agreement.hasSignedFile && (
              <button type="button" disabled={busy} className={BUTTON} onClick={() => openFile({ kind: "master", part: "agreement" })}>
                View agreement
              </button>
            )}
            {agreement.hasSignedExhibit && (
              <button type="button" disabled={busy} className={BUTTON} onClick={() => openFile({ kind: "master", part: "exhibit" })}>
                View Exhibit A
              </button>
            )}
          </div>
        )}

        {signedOk && (
          <div>
            <p className="text-sm font-medium text-gray-900">Covered properties ({covered.length})</p>
            {covered.length ? <PropertyList items={covered} /> : <p className="text-sm text-gray-500">None yet. Properties are added when you publish them.</p>}
          </div>
        )}

        {agreement.amendment && (
          <div className="rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-900 space-y-2">
            <p>
              You started an Exhibit A amendment adding {agreement.amendment.adding.join("; ")}. Sign it to publish{" "}
              {agreement.amendment.adding.length === 1 ? "that property" : "those properties"}.
            </p>
            <SignForm button="Continue signing" defaultName={gate.accountName ?? ""} busy={busy || starting} onStart={(b) => start(b)} />
          </div>
        )}

        {signedOk && !agreement.amendment && uncoveredLive.length > 0 && (
          <div className="space-y-2 rounded-md border border-amber-200 px-3 py-3">
            <p className="text-sm text-gray-800">
              {uncoveredLive.length === 1 ? "This live property is" : "These live properties are"} not on your agreement yet. Add{" "}
              {uncoveredLive.length === 1 ? "it" : "them"} with a short amendment:
            </p>
            <PropertyList items={uncoveredLive} />
            <SignForm
              defaultName={gate.accountName ?? ""}
              button="Review and sign the amendment"
              busy={busy || starting}
              onStart={(b) => start({ ...b, listingIds: uncoveredLive.map((p) => p.listingId) })}
            />
          </div>
        )}

        {agreement.declinedAt && (
          <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
            You declined the agreement on {dateOnly(agreement.declinedAt)}. You can review and sign it whenever you are ready, or ask for changes below.
          </p>
        )}

        {!signedOk && agreement.canSign && (
          <>
            {uncoveredLive.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-900">Exhibit A will list</p>
                <PropertyList items={uncoveredLive} />
              </div>
            )}
            <SignForm
              defaultName={gate.accountName ?? ""}
              intro={masterIntro}
              button={agreement.status === "in_progress" ? "Continue signing" : "Review and sign"}
              busy={busy || starting}
              onStart={start}
            />
          </>
        )}

        {!signedOk && !agreement.canSign && (
          <p className="text-sm text-gray-600">
            The agreement is not ready to sign here yet. We will email you when it is. Questions? Email info@useproximity.org.
          </p>
        )}

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        <div className="border-t border-gray-100 pt-3">
          <button type="button" className="text-sm font-medium text-gray-700 underline" onClick={() => setDocsOpen((o) => !o)}>
            {docsOpen ? "Hide your signed documents" : "Your signed documents"}
          </button>
          {docsOpen && (
            <div className="mt-2">
              <Documents key={docsKey} open={openFile} busy={busy} />
            </div>
          )}
        </div>

        {changeRequests}
      </div>

      {session && (
        <SignAgreementDialog
          token={session.token}
          host={session.host}
          kind={session.kind}
          name={user?.name}
          email={user?.email}
          onClose={() => {
            setSession(null);
            onChanged("closed");
          }}
          onFinished={(result) => {
            setSession(null);
            setDocsKey((k) => k + 1);
            onChanged(result);
          }}
        />
      )}
    </section>
  );
}
