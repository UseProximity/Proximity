"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

// Documenso's signing page, embedded. Loaded only when the dialog opens.
const EmbedSignDocument = dynamic(() => import("@documenso/embed-react").then((m) => m.EmbedSignDocument), {
  ssr: false,
  loading: () => <p className="py-20 text-center text-sm text-gray-400">Opening the agreement...</p>,
});

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * Signing the commission agreement without leaving the Payments tab. Documenso's
 * page runs in the frame; when it says the landlord finished (or declined) we ask
 * our server, which checks with Documenso directly, so the card updates at once
 * instead of waiting for the webhook. `token` and `host` come from
 * /api/billing/agreement/sign.
 */
export default function SignAgreementDialog({ token, host, name, email, onClose, onFinished }) {
  const [phase, setPhase] = useState("signing"); // signing | saving | declined | error
  const [message, setMessage] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && phase !== "saving" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  // The webhook and this check can race; a few tries cover Documenso finishing the PDF.
  const confirm = useCallback(async () => {
    for (let i = 0; i < 6; i += 1) {
      const r = await post("/api/billing/agreement/sync").catch(() => null);
      if (r?.agreement?.status === "signed") return r.agreement;
      await wait(2000);
    }
    return null;
  }, []);

  const completed = useCallback(async () => {
    setPhase("saving");
    const agreement = await confirm();
    onFinished(agreement ? "signed" : "pending");
  }, [confirm, onFinished]);

  const rejected = useCallback(async () => {
    await post("/api/billing/agreement/sync").catch(() => null);
    setPhase("declined");
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label="Sign the commission agreement">
      <div className="flex h-full max-h-[56rem] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
          <h2 className="flex-1 text-base font-semibold text-gray-900">Commission agreement</h2>
          <button
            ref={closeRef}
            type="button"
            disabled={phase === "saving"}
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Close
          </button>
        </div>

        {phase === "signing" && (
          <EmbedSignDocument
            className="h-full w-full flex-1 border-0"
            host={host}
            token={token}
            name={name || undefined}
            email={email || undefined}
            lockEmail
            allowDocumentRejection
            onDocumentCompleted={completed}
            onDocumentRejected={rejected}
            onDocumentError={(err) => {
              setMessage(err || null);
              setPhase("error");
            }}
          />
        )}
        {phase === "saving" && (
          <p className="py-20 text-center text-sm text-gray-600">Signed. Saving your copy...</p>
        )}
        {phase === "declined" && (
          <div className="space-y-2 px-6 py-16 text-center text-sm text-gray-700">
            <p>You declined to sign. We have let the team know, and someone will be in touch.</p>
            <p>You can sign later from this page. Until then you cannot publish new listings if the agreement is required.</p>
          </div>
        )}
        {phase === "error" && (
          <div className="space-y-2 px-6 py-16 text-center text-sm text-gray-700">
            <p>The agreement could not be opened. Close this window and try again in a few minutes.</p>
            {message && <p className="text-xs text-gray-400">{message}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
