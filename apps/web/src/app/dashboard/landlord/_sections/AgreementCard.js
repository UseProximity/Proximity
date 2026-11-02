"use client";

import { useState } from "react";
import SignAgreementDialog from "./SignAgreementDialog";

const STATUS = {
  signed: { label: "Signed", className: "bg-green-100 text-green-800" },
  needs_resign: { label: "New version to sign", className: "bg-amber-100 text-amber-800" },
  in_progress: { label: "Started, not signed yet", className: "bg-amber-100 text-amber-800" },
  not_signed: { label: "Not signed", className: "bg-gray-100 text-gray-700" },
};

const dateOnly = (iso) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

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

const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";

// The title and "authorised to sign" confirmation, then the button that opens the agreement.
function SignForm({ agreement, busy, onStart }) {
  const [title, setTitle] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const resign = agreement.status === "needs_resign";

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ signerTitle: title, authorized });
      }}
    >
      <p className="text-sm text-gray-700">
        {resign
          ? `We have updated the agreement${agreement.liveVersionLabel ? ` (${agreement.liveVersionLabel})` : ""}. Please review and sign the new version.`
          : agreement.status === "in_progress"
            ? "You started signing the agreement. Pick up where you left off."
            : "Review the agreement and sign it here. It takes about two minutes."}
      </p>
      <label className="block max-w-sm text-sm font-medium text-gray-700">
        Your title
        <input
          className={`${FIELD} mt-1`}
          value={title}
          maxLength={100}
          placeholder="Owner, Property Manager, ..."
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} required />
        <span>I am authorised to sign this agreement for the landlord or company that owns these listings.</span>
      </label>
      <button
        type="submit"
        disabled={busy || !title.trim() || !authorized}
        className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
      >
        {agreement.status === "in_progress" ? "Continue signing" : "Review and sign"}
      </button>
    </form>
  );
}

/*
 * The commission agreement, and the checklist of what is needed before a listing
 * can be published. A landlord signs here, in Documenso's page embedded in a
 * dialog, and can open their signed copy afterwards. The checklist only lists a
 * requirement that is switched on, so it says nothing until it matters.
 */
export default function AgreementCard({ gate, hasActivePaymentMethod, onOpenSigned, onChanged, busy, user }) {
  const agreement = gate.agreement;
  const status = STATUS[agreement.status] ?? STATUS.not_signed;
  const signedOk = agreement.status === "signed";
  const showChecklist = gate.requirePaymentMethod || gate.requireAgreement;
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  // The launch enrollment window: a reminder with the date, until they have set up.
  const enrollmentWindow = gate.enrollment;
  const needsAgreement = enrollmentWindow?.includeAgreement && !signedOk;
  const showWindow = enrollmentWindow?.deadline && (!hasActivePaymentMethod || needsAgreement);
  const deadline = enrollmentWindow?.deadline
    ? new Date(`${enrollmentWindow.deadline}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null;

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
      else setSession({ token: data.token, host: data.host });
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

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
        <p className="mt-1 text-sm text-gray-500">The agreement sets out the fee Proximity charges when it brings you a tenant.</p>
      </div>

      {showChecklist && (
        <div className="px-4 pt-4">
          <p className="text-sm font-medium text-gray-900">Before you can publish a listing</p>
          <ul className="mt-2 space-y-1.5">
            {gate.requirePaymentMethod && <Requirement done={hasActivePaymentMethod}>Add an active payment method</Requirement>}
            {gate.requireAgreement && <Requirement done={signedOk}>Sign the commission agreement</Requirement>}
          </ul>
          {!gate.allowed && <p className="mt-2 text-xs text-gray-500">Your drafts are saved. You can publish them as soon as these are done.</p>}
        </div>
      )}

      <div className="space-y-3 px-4 py-4">
        {(signedOk || agreement.status === "needs_resign") && agreement.signedAt && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-gray-600">
              {signedOk ? "Signed" : "You signed the previous version"} {dateOnly(agreement.signedAt)}
              {agreement.signerName ? ` by ${agreement.signerName}` : ""}
              {agreement.signerTitle ? `, ${agreement.signerTitle}` : ""}
              {agreement.signedVersionLabel ? ` (${agreement.signedVersionLabel})` : ""}.
            </p>
            {agreement.hasSignedFile && (
              <button
                type="button"
                disabled={busy}
                onClick={onOpenSigned}
                className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                View signed copy
              </button>
            )}
          </div>
        )}

        {agreement.declinedAt && (
          <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
            You declined the agreement on {dateOnly(agreement.declinedAt)}. You can review and sign it whenever you are ready.
          </p>
        )}

        {!signedOk && agreement.canSign && <SignForm agreement={agreement} busy={busy || starting} onStart={start} />}

        {!signedOk && !agreement.canSign && (
          <p className="text-sm text-gray-600">
            The agreement is not ready to sign here yet. We will email you when it is. Questions? Email info@useproximity.org.
          </p>
        )}

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </div>

      {session && (
        <SignAgreementDialog
          token={session.token}
          host={session.host}
          name={user?.name}
          email={user?.email}
          onClose={() => {
            setSession(null);
            onChanged("closed");
          }}
          onFinished={(result) => {
            setSession(null);
            onChanged(result);
          }}
        />
      )}
    </section>
  );
}
