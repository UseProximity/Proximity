"use client";

const STATUS = {
  none: { label: "Not sent", className: "bg-gray-100 text-gray-700" },
  not_sent: { label: "Not sent", className: "bg-gray-100 text-gray-700" },
  sent: { label: "Sent, awaiting signature", className: "bg-amber-100 text-amber-800" },
  signed: { label: "Signed", className: "bg-green-100 text-green-800" },
  voided: { label: "Not sent", className: "bg-gray-100 text-gray-700" },
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

/*
 * The commission agreement, and the checklist of what is needed before a listing
 * can be published. The checklist only lists a requirement that is switched on, so
 * it says nothing until it matters. Until an e-signature provider is chosen the
 * team sends the agreement and records it as signed here by hand.
 */
export default function AgreementCard({ gate, hasActivePaymentMethod, onOpenSigned, busy }) {
  const agreement = gate.agreement;
  const status = STATUS[agreement.status] ?? STATUS.none;
  const showChecklist = gate.requirePaymentMethod || gate.requireAgreement;

  // The launch enrollment window: a reminder with the date, until they have set up.
  const enrollmentWindow = gate.enrollment;
  const needsAgreement = enrollmentWindow?.includeAgreement && agreement.status !== "signed";
  const showWindow = enrollmentWindow?.deadline && (!hasActivePaymentMethod || needsAgreement);
  const deadline = enrollmentWindow?.deadline
    ? new Date(`${enrollmentWindow.deadline}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null;

  return (
    <section className="bg-white rounded-lg border border-gray-100 shadow-sm">
      {showWindow && (
        <div className="rounded-t-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Proximity now collects fees in the app. Please {needsAgreement ? "add a payment method and sign the commission agreement" : "add a payment method"} by{" "}
          <strong>{deadline}</strong>. A bank account (ACH) is the recommended option.
        </div>
      )}
      <div className="px-4 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Commission agreement</h2>
        <p className="mt-1 text-sm text-gray-500">
          The agreement sets out the fee Proximity charges when it brings you a tenant. The team sends it to you and
          records it here once it is signed.
        </p>
      </div>

      {showChecklist && (
        <div className="px-4 pt-4">
          <p className="text-sm font-medium text-gray-900">Before you can publish a listing</p>
          <ul className="mt-2 space-y-1.5">
            {gate.requirePaymentMethod && (
              <Requirement done={hasActivePaymentMethod}>Add an active payment method</Requirement>
            )}
            {gate.requireAgreement && (
              <Requirement done={agreement.status === "signed"}>Sign the commission agreement</Requirement>
            )}
          </ul>
          {!gate.allowed && (
            <p className="mt-2 text-xs text-gray-500">
              Your drafts are saved. You can publish them as soon as these are done.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 px-4 py-4">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>{status.label}</span>
        {agreement.status === "signed" && (
          <span className="text-sm text-gray-600">
            Signed {agreement.signedAt ? dateOnly(agreement.signedAt) : ""}
            {agreement.signerName ? ` by ${agreement.signerName}` : ""}
          </span>
        )}
        {agreement.status === "signed" && agreement.hasSignedFile && (
          <button
            type="button"
            disabled={busy}
            onClick={onOpenSigned}
            className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            View signed copy
          </button>
        )}
        {agreement.status === "sent" && (
          <span className="text-sm text-gray-600">Sign it and send it back to info@useproximity.org.</span>
        )}
        {(agreement.status === "none" || agreement.status === "not_sent") && (
          <span className="text-sm text-gray-600">
            Questions, or want it sooner? Email info@useproximity.org.
          </span>
        )}
      </div>
    </section>
  );
}
