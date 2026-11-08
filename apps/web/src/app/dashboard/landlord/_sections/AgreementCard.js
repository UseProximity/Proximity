"use client";

import { useCallback, useEffect, useState } from "react";
import AgreementSigningFlow from "./AgreementSigningFlow";
import CollapsibleSection from "./CollapsibleSection";

const STATUS = {
  signed: { label: "Signed", className: "bg-green-100 text-green-800" },
  needs_resign: { label: "New version to sign", className: "bg-amber-100 text-amber-800" },
  in_progress: { label: "Started, not signed yet", className: "bg-amber-100 text-amber-800" },
  not_signed: { label: "Not signed", className: "bg-gray-100 text-gray-700" },
};

// 11/05/2026: agreement dates never show a time (Wyatt, 2026-11-05).
const dateOnly = (iso) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Chicago" });

const BUTTON = "px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60";

export function Requirement({ done, children }) {
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
 * "Before you can publish a listing": what the listing gate needs, at the top of
 * the Payments tab (Wyatt, 2026-11-06). Only requirements that are switched on.
 */
export function PublishChecklist({ gate, hasActivePaymentMethod }) {
  if (!gate.requirePaymentMethod && !gate.requireAgreement) return null;
  return (
    <section className="rounded-lg border border-gray-100 bg-white px-4 py-4 shadow-sm">
      <p className="text-sm font-semibold text-gray-900">Before you can publish a listing</p>
      <ul className="mt-2 space-y-1.5">
        {gate.requirePaymentMethod && <Requirement done={hasActivePaymentMethod}>Add an active payment method</Requirement>}
        {gate.requireAgreement && (
          <Requirement done={gate.agreement?.status === "signed"}>
            Sign the marketing agreement. New properties are added to it when you publish them.
          </Requirement>
        )}
      </ul>
      {!gate.allowed && <p className="mt-2 text-xs text-gray-500">Your drafts are saved. You can publish them as soon as these are done.</p>}
    </section>
  );
}

// The button that opens the signing popup (AgreementSigningFlow): details,
// Exhibit A and the license question all happen there (Wyatt, 2026-11-07).
function SignButton({ children, busy, onClick }) {
  return (
    <button type="button" disabled={busy} onClick={onClick} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
      {children}
    </button>
  );
}

function PropertyList({ items }) {
  return (
    <ul className="space-y-1 text-sm">
      {items.map((p) => (
        <li key={p.listingId} className="text-gray-800">
          {p.address}
          {p.wholeBuilding ? (
            <span className="text-xs text-gray-500"> (whole building)</span>
          ) : p.units?.length ? (
            <span className="text-xs text-gray-500"> (units: {p.units.join(", ")})</span>
          ) : null}
          {p.missingUnits?.length ? <span className="text-xs text-amber-700"> (not yet on it: {p.missingUnits.join(", ")})</span> : null}
        </li>
      ))}
    </ul>
  );
}

// The landlord's signed documents, each one PDF (Wyatt, 2026-11-06): the
// marketing agreement with its original Exhibit A, and an Exhibit A amendment
// for each time properties were added, showing Exhibit A before and after.
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
  // Oldest first: the agreement, then its amendments in the order they were signed.
  const shown = docs
    .filter((d) => d.status === "signed" || d.status === "superseded")
    .sort((a, b) => String(a.signedAt ?? a.createdAt).localeCompare(String(b.signedAt ?? b.createdAt)));
  if (!shown.length) return <p className="text-sm text-gray-500">No signed documents yet.</p>;
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {shown.map((d) => {
        const before = new Set((d.previous ?? []).map((e) => e.listingId));
        const added = d.kind === "amendment" ? d.properties.filter((e) => !before.has(e.listingId)) : [];
        return (
          <li key={`${d.kind}:${d.id}`} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1 text-gray-800">
              {d.kind === "amendment" ? "Exhibit A amendment" : "Marketing agreement"}, signed {d.signedAt ? dateOnly(d.signedAt) : ""}
              {d.status === "superseded" ? <span className="text-xs text-gray-400"> (replaced)</span> : null}
              <span className="block text-xs text-gray-500">
                {d.kind === "amendment"
                  ? `Adds ${added.map((e) => e.address).join("; ") || "properties"}`
                  : `Exhibit A: ${d.properties.length} ${d.properties.length === 1 ? "property" : "properties"}`}
              </span>
            </span>
            {(d.hasSignedFile || d.hasSignedExhibit) && (
              <button type="button" disabled={busy} className={BUTTON} onClick={() => open({ kind: d.kind, id: d.id })}>
                View
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/*
 * The marketing agreement on the Payments tab: where the landlord stands, which
 * properties it covers, signing it (or initialing an updated Exhibit A for
 * properties not covered yet), and every signed document. It folds to its header
 * when there is nothing to do. The checklist only lists a requirement that is
 * switched on. `changeRequests` is the "Request changes" panel, at the bottom.
 */
export default function AgreementCard({ gate, hasActivePaymentMethod, onChanged, busy, user, changeRequests = null }) {
  const agreement = gate.agreement;
  const status = STATUS[agreement.status] ?? STATUS.not_signed;
  const signedOk = agreement.status === "signed";
  const [signing, setSigning] = useState(null);
  const [error, setError] = useState(null);
  const [docsKey, setDocsKey] = useState(0);
  const uncoveredLive = agreement.uncoveredLive ?? [];
  const covered = agreement.covered ?? [];

  const enrollmentWindow = gate.enrollment;
  const needsAgreement = enrollmentWindow?.includeAgreement && !signedOk;
  const showWindow = enrollmentWindow?.deadline && (!hasActivePaymentMethod || needsAgreement);
  const deadline = enrollmentWindow?.deadline
    ? new Date(`${enrollmentWindow.deadline}T12:00:00Z`).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", timeZone: "UTC" })
    : null;
  // Open when there is something to sign; folded once it is all done.
  // Their negotiated agreement (an accepted change request) is ready to sign.
  const negotiated = signedOk && agreement.canSign ? agreement.negotiatedReady : null;
  const needsAction = !signedOk || !!agreement.amendment || uncoveredLive.length > 0 || !!negotiated;

  // Opens one signed document as a single PDF in a new tab (opened first, so it is not blocked as a popup).
  const openFile = useCallback(async ({ kind, id }) => {
    setError(null);
    const tab = window.open("", "_blank");
    try {
      const qs = new URLSearchParams({ kind, ...(id ? { id } : {}) });
      const res = await fetch(`/api/billing/agreement/file?${qs}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not open that document.");
      }
      const link = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = link;
      else window.open(link, "_blank");
    } catch (e) {
      tab?.close();
      setError(e.message);
    }
  }, []);

  const start = (body) => {
    setError(null);
    setSigning(body);
  };

  const finished = useCallback(
    (result) => {
      setSigning(null);
      if (result !== "closed") setDocsKey((k) => k + 1);
      onChanged(result);
    },
    [onChanged]
  );

  const masterIntro =
    agreement.status === "needs_resign"
      ? `We have updated the agreement${agreement.liveVersionLabel ? ` (${agreement.liveVersionLabel})` : ""}. Please review and sign the new version.`
      : agreement.status === "in_progress"
        ? "You started signing the agreement. Pick up where you left off."
        : "Review the agreement and sign it here. It takes about two minutes and covers the properties you have live.";

  const summary = signedOk
    ? `Signed ${agreement.signedAt ? dateOnly(agreement.signedAt) : ""}. Covers ${covered.length} ${covered.length === 1 ? "property" : "properties"}.`
    : "The agreement sets out the fee Proximity charges when it brings you a tenant.";

  return (
    <CollapsibleSection
      id="marketing-agreement"
      title="Marketing agreement"
      defaultOpen={needsAction}
      badge={<span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>{status.label}</span>}
      summary={summary}
      banner={
        showWindow ? (
          <div className="rounded-t-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Proximity now collects fees in the app. Please {needsAgreement ? "add a payment method and sign the marketing agreement" : "add a payment method"} by{" "}
            <strong>{deadline}</strong>. A bank account (ACH) is the recommended option.
          </div>
        ) : null
      }
    >
      <div className="space-y-4 px-4 py-4">
        {(signedOk || agreement.status === "needs_resign") && agreement.signedAt && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-gray-600">
              {signedOk ? "Signed" : "You signed the previous agreement"} {dateOnly(agreement.signedAt)}
              {agreement.signerName ? ` by ${agreement.signerName}` : ""}
              {agreement.signerTitle ? `, ${agreement.signerTitle}` : ""}
              {agreement.signedVersionLabel ? ` (${agreement.signedVersionLabel})` : ""}.
            </p>
            {(agreement.hasSignedFile || agreement.hasSignedExhibit) && (
              <button type="button" disabled={busy} className={BUTTON} onClick={() => openFile({ kind: "master" })}>
                View marketing agreement
              </button>
            )}
          </div>
        )}

        {signedOk && (
          <div>
            <p className="text-sm font-medium text-gray-900">This agreement covers these properties ({covered.length}):</p>
            {covered.length ? <PropertyList items={covered} /> : <p className="text-sm text-gray-500">None yet. Properties are added when you publish them.</p>}
          </div>
        )}

        {negotiated && (
          <div className="rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-900 space-y-2">
            <p>
              Your negotiated agreement{negotiated.label ? ` (${negotiated.label})` : ""} is ready to sign. It replaces your current agreement,
              and every property it covers stays covered. Until you sign, your current agreement still applies.
            </p>
            <SignButton busy={busy || !!signing} onClick={() => start({ listingIds: [] })}>
              Review and sign
            </SignButton>
          </div>
        )}

        {agreement.amendment && !negotiated && (
          <div className="rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-900 space-y-2">
            <p>
              You started an Exhibit A amendment adding {agreement.amendment.adding.join("; ")}. Sign it to publish{" "}
              {agreement.amendment.adding.length === 1 ? "that property" : "those properties"}.
            </p>
            <SignButton busy={busy || !!signing} onClick={() => start({ listingIds: [] })}>
              Continue signing
            </SignButton>
          </div>
        )}

        {signedOk && !agreement.amendment && !negotiated && uncoveredLive.length > 0 && (
          <div className="space-y-2 rounded-md border border-amber-200 px-3 py-3">
            <p className="text-sm text-gray-800">
              {uncoveredLive.length === 1 ? "This live property is" : "These live properties are"} not fully on your agreement yet. Add{" "}
              {uncoveredLive.length === 1 ? "it" : "them"} with an Exhibit A amendment:
            </p>
            <PropertyList items={uncoveredLive} />
            <SignButton busy={busy || !!signing} onClick={() => start({ listingIds: uncoveredLive.map((p) => p.listingId) })}>
              Review and sign the amendment
            </SignButton>
          </div>
        )}

        {agreement.declinedAt && (
          <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
            You declined the agreement on {dateOnly(agreement.declinedAt)}. You can review and sign it whenever you are ready, or ask for changes below.
          </p>
        )}

        {!signedOk && agreement.canSign && (
          <>
            <p className="text-sm text-gray-700">{masterIntro}</p>
            <SignButton busy={busy || !!signing} onClick={() => start({ listingIds: [] })}>
              {agreement.status === "in_progress" ? "Continue signing" : "Review and sign"}
            </SignButton>
          </>
        )}

        {!signedOk && !agreement.canSign && (
          <p className="text-sm text-gray-600">
            The agreement is not ready to sign here yet. We will email you when it is. Questions? Email info@useproximity.org.
          </p>
        )}

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        <div className="border-t border-gray-100 pt-3">
          <p className="text-sm font-medium text-gray-900">Your signed documents</p>
          <div className="mt-1">
            <Documents key={docsKey} open={openFile} busy={busy} />
          </div>
        </div>

        {changeRequests}
      </div>

      {signing && <AgreementSigningFlow listingIds={signing.listingIds ?? []} user={user} onFinished={finished} />}
    </CollapsibleSection>
  );
}
