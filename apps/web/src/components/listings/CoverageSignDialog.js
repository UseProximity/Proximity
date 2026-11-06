"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import toast from "react-hot-toast";
import AgreementSigningFlow from "@/app/dashboard/landlord/_sections/AgreementSigningFlow";

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
 * properties, says whether this is the agreement itself (first time: it covers
 * them and everything else they have live) or an updated list of their covered
 * properties to initial (they already signed), and takes their name, title and
 * authority to sign. Then the license question pops up while the document is
 * prepared, and the signing page opens (AgreementSigningFlow). Once Documenso
 * confirms the signature, `onSigned` runs: the caller publishes again. Closing it
 * leaves everything as a draft.
 *
 * Props: uncovered [{ listingId, address }], onSigned(), onClose().
 */
export default function CoverageSignDialog({ uncovered, onSigned, onClose }) {
  const [view, setView] = useState(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [signing, setSigning] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    getJson("/api/billing/gate")
      .then((d) => {
        setView(d.agreement ?? null);
        setName((n) => n || d.accountName || "");
      })
      .catch(() => setView({}));
  }, []);

  useEffect(() => {
    if (signing) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, signing]);

  const hasMaster = view?.status === "signed";
  const ids = uncovered.map((u) => u.listingId).filter(Boolean);
  const alsoLive = (view?.uncoveredLive ?? []).filter((p) => !ids.includes(p.listingId));

  const start = (e) => {
    e.preventDefault();
    setSigning({ signerName: name, signerTitle: title, authorized, listingIds: ids });
  };

  if (signing) {
    return (
      <AgreementSigningFlow
        body={signing}
        onFinished={(result) => {
          if (result === "signed") return onSigned();
          if (result === "closed") return onClose();
          // Signed, but Documenso has not finished sealing it yet: the webhook will
          // record it shortly, and publishing again then goes straight through.
          toast("Signed. We are still saving your copy. Publish again in a minute.", { duration: 10000 });
          onClose("pending");
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Add to your commission agreement">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
          <h2 className="flex-1 text-base font-semibold text-gray-900">
            {hasMaster ? "Add to your commission agreement" : "Sign your commission agreement"}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={() => onClose()}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Not now
          </button>
        </div>

        <form onSubmit={start} className="space-y-4 overflow-y-auto px-5 py-4 text-sm text-gray-700">
          {view === null ? (
            <p className="text-gray-400">Checking your agreement...</p>
          ) : (
            <>
              <p>
                {hasMaster
                  ? "To publish, add these properties to your commission agreement. You initial an updated list of your properties, not the whole agreement again."
                  : "To publish, sign the commission agreement. This agreement covers these properties:"}
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
                You will initial each page of the property list. Your drafts stay saved whatever you choose.{" "}
                <a href={PAYMENTS_URL} className="underline">
                  Read it first or ask for changes under Payments
                </a>
                .
              </p>
              <label className="block">
                Your full name
                <input
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                  value={name}
                  maxLength={100}
                  autoComplete="name"
                  placeholder="First and last name"
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <span className="mt-1 block text-xs text-gray-500">First and last, as it should appear on the agreement.</span>
              </label>
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
              <button
                type="submit"
                disabled={!authorized || !title.trim() || name.trim().split(/\s+/).length < 2}
                className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                Review and sign
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
