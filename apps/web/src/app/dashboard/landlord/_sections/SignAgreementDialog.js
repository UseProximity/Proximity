"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import Spinner from "./Spinner";
import DeclineDetailsForm from "./DeclineDetailsForm";

// Documenso's signing page, embedded. Loaded only when the dialog opens.
const EmbedSignDocument = dynamic(() => import("@documenso/embed-react").then((m) => m.EmbedSignDocument), {
  ssr: false,
  loading: () => (
    <div className="flex justify-center py-20">
      <Spinner label="Opening the agreement..." />
    </div>
  ),
});

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * Signing the marketing agreement without leaving the Payments tab. Documenso's
 * page runs in the frame; when it says the landlord finished (or declined) we ask
 * our server, which checks with Documenso directly, so the card updates at once
 * instead of waiting for the webhook. `token` and `host` come from
 * /api/billing/agreement/sign. `kind` is master (the agreement with Exhibit A) or
 * amendment (an Exhibit A amendment: Exhibit A before and after), as that route answered.
 */
export default function SignAgreementDialog({ token, host, name, email, kind = "master", onClose, onFinished }) {
  const [phase, setPhase] = useState("signing"); // signing | saving | declined | error
  const [message, setMessage] = useState(null);
  const [reason, setReason] = useState("");
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && phase !== "saving" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  // The webhook and this check can race. Documenso seals the signed PDFs after the
  // signature (longer with Exhibit A attached), so keep asking for about a minute.
  const confirm = useCallback(async () => {
    for (let i = 0; i < 20; i += 1) {
      const r = await post("/api/billing/agreement/sync").catch(() => null);
      const done =
        r?.result === "signed" ||
        (kind === "amendment" ? r?.agreement?.status === "signed" && !r?.agreement?.amendment : r?.agreement?.status === "signed");
      if (done) return r.agreement;
      await wait(3000);
    }
    return null;
  }, [kind]);

  const completed = useCallback(async () => {
    setPhase("saving");
    const agreement = await confirm();
    onFinished(agreement ? "signed" : "pending");
  }, [confirm, onFinished]);

  // Documenso's reject popup hands us the reason: it prefills the change request form.
  const rejected = useCallback(async (data) => {
    setReason(typeof data?.reason === "string" ? data.reason : "");
    await post("/api/billing/agreement/sync").catch(() => null);
    setPhase("declined");
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label="Sign the marketing agreement">
      <div className="flex h-full max-h-[56rem] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
          <h2 className="flex-1 text-base font-semibold text-gray-900">
            {kind === "amendment" ? "Exhibit A amendment" : "Marketing agreement"}
          </h2>
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
          <div className="flex justify-center py-20">
            <Spinner label="Signed. Saving your copy..." />
          </div>
        )}
        {phase === "declined" && <DeclineDetailsForm reason={reason} kind={kind} onClose={onClose} />}
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
