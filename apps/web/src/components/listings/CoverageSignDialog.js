"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SignAgreementDialog from "@/app/dashboard/landlord/_sections/SignAgreementDialog";

const PAYMENTS_URL = "/dashboard/landlord?tab=payments#commission-agreement";

async function getJson(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

/*
 * Shown when a publish is refused only because the properties are not on the
 * landlord's commission agreement yet (listing gate, `uncovered`). It names the
 * properties, says whether this is the agreement itself (first time: Exhibit A
 * lists them and everything else they have live) or a short Exhibit A amendment
 * (they already signed), takes their title and authority to sign, and opens the
 * signing page. Once Documenso confirms the signature, `onSigned` runs: the
 * caller publishes again. Closing it leaves everything as a draft.
 *
 * Props: uncovered [{ listingId, address }], onSigned(), onClose().
 */
export default function CoverageSignDialog({ uncovered, onSigned, onClose }) {
  const [view, setView] = useState(null);
  const [title, setTitle] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [signing, setSigning] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    getJson("/api/billing/gate")
      .then((d) => setView(d.agreement ?? null))
      .catch(() => setView({}));
  }, []);

  useEffect(() => {
    if (signing) return undefined;
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, signing]);

  const hasMaster = view?.status === "signed";
  const ids = uncovered.map((u) => u.listingId).filter(Boolean);
  const alsoLive = (view?.uncoveredLive ?? []).filter((p) => !ids.includes(p.listingId));

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await getJson("/api/billing/agreement/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerTitle: title, authorized, listingIds: ids }),
      });
      if (r.alreadySigned) return onSigned();
      setSigning(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (signing) {
    return (
      <SignAgreementDialog
        token={signing.token}
        host={signing.host}
        kind={signing.kind}
        onClose={onClose}
        onFinished={(result) => {
          if (result === "signed") onSigned();
          else onClose("pending");
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Add to your commission agreement">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
          <h2 className="flex-1 text-base font-semibold text-gray-900">
            {hasMaster ? "Add to your commission agreement" : "Sign your commission agreement"}
          </h2>
          <button
            ref={closeRef}
            type="button"
            disabled={busy}
            onClick={() => onClose()}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Not now
          </button>
        </div>

        <form onSubmit={start} className="space-y-4 px-5 py-4 text-sm text-gray-700">
          {view === null ? (
            <p className="text-gray-400">Checking your agreement...</p>
          ) : (
            <>
              <p>
                {hasMaster
                  ? "To publish, these properties need to be added to Exhibit A of your commission agreement. You will sign a short amendment, not the whole agreement again."
                  : "To publish, sign the commission agreement. Its Exhibit A lists the properties it covers:"}
              </p>
              <ul className="space-y-1 rounded-md bg-gray-50 px-3 py-2">
                {uncovered.map((u) => (
                  <li key={u.listingId ?? u.address} className="font-medium text-gray-900">
                    {u.address}
                  </li>
                ))}
                {alsoLive.map((p) => (
                  <li key={p.listingId} className="text-gray-700">
                    {p.address} <span className="text-xs text-gray-400">(already live)</span>
                  </li>
                ))}
              </ul>
              {hasMaster && view?.covered?.length > 0 && (
                <p className="text-xs text-gray-500">
                  Already covered: {view.covered.map((c) => c.address).join("; ")}.
                </p>
              )}
              <p className="text-xs text-gray-500">
                You will initial each Exhibit A page. Your drafts stay saved whatever you choose.{" "}
                <a href={PAYMENTS_URL} className="underline">
                  Read it first or ask for changes under Payments
                </a>
                .
              </p>
              <label className="block">
                Your title
                <input
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                  value={title}
                  maxLength={100}
                  placeholder="Owner, Property Manager"
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
                <span>I am authorised to sign for this landlord or company.</span>
              </label>
              {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={busy || !authorized || !title.trim()}
                className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {busy ? "Opening..." : hasMaster ? "Review and sign the amendment" : "Review and sign"}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

/*
 * Open the dialog from anywhere (a toast handler, a form submit). Resolves
 * "signed" once the landlord has signed (after onSigned ran), or "closed".
 */
export function openCoverageDialog({ uncovered, onSigned }) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (result) => {
      root.unmount();
      host.remove();
      resolve(result);
    };
    root.render(
      <CoverageSignDialog
        uncovered={uncovered}
        onClose={() => done("closed")}
        onSigned={async () => {
          try {
            await onSigned?.();
          } finally {
            done("signed");
          }
        }}
      />
    );
  });
}

// True when the only thing stopping a publish is that the properties are not covered yet.
export function needsCoverageOnly(data) {
  return (
    data?.code === "billing_setup_required" &&
    Array.isArray(data.missing) &&
    data.missing.length === 1 &&
    data.missing[0] === "agreement" &&
    Array.isArray(data.uncovered) &&
    data.uncovered.length > 0
  );
}
