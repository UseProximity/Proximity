"use client";

import { useEffect, useRef, useState } from "react";
import SignAgreementDialog from "./SignAgreementDialog";
import Spinner from "./Spinner";
import LicenseDisclosureFields, { useLicenseDisclosure } from "@/components/account/LicenseDisclosureFields";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The sign route. While another call for this landlord holds the signing lock
// (the background prepare still finishing), it answers 409 "already being
// prepared": wait and ask again rather than show that.
async function post(body, { retries = 0 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch("/api/billing/agreement/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (res.status === 409 && data.code === "in_progress" && attempt < retries) {
      await wait(1500);
      continue;
    }
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
}

/*
 * What happens after "Review and sign" (Payments tab and the publish dialog):
 *
 *   1. A popup asks the real estate license question (or shows the saved answer
 *      to confirm). Meanwhile the document is built and opened in Documenso in
 *      the background (prepare: true), so it is ready by the time they answer.
 *   2. Their answer is saved to their account (never printed on the agreement)
 *      and the document opens in Documenso's signing page, with everything
 *      filled but the signature and initials.
 *
 * `body` is what the sign route needs besides the license answer: signerName,
 * signerTitle, authorized and, from the publish dialog, listingIds.
 * onFinished(result): "signed" | "pending" (signed, still saving) | "closed".
 */
export default function AgreementSigningFlow({ body, user = null, onFinished }) {
  const license = useLicenseDisclosure();
  const [phase, setPhase] = useState("license"); // license | opening | signing
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [preparing, setPreparing] = useState(true);
  const prepared = useRef(null);
  const closeRef = useRef(null);

  // Start preparing the document as soon as the popup opens (once, even when
  // React runs this effect twice in development).
  useEffect(() => {
    closeRef.current?.focus();
    if (prepared.current) return;
    prepared.current = post({ ...body, prepare: true })
      .catch(() => null) // the open call below makes the copy itself if this failed
      .finally(() => setPreparing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "license") return undefined;
    const onKey = (e) => e.key === "Escape" && onFinished("closed");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onFinished]);

  const open = async (e) => {
    e.preventDefault();
    if (!license.ready) return;
    setPhase("opening");
    setError(null);
    try {
      const ready = await prepared.current;
      if (ready?.alreadySigned) return onFinished("signed");
      const r = await post({ ...body, licenseDisclosure: license.payload() }, { retries: 20 });
      if (r.alreadySigned) return onFinished("signed");
      setSession(r);
      setPhase("signing");
    } catch (err) {
      setError(err.message);
      setPhase("license");
      // The next try prepares again if it has to.
      prepared.current = Promise.resolve(null);
    }
  };

  if (phase === "signing" && session) {
    return (
      <SignAgreementDialog
        token={session.token}
        host={session.host}
        kind={session.kind}
        name={user?.name}
        email={user?.email}
        onClose={() => onFinished("closed")}
        onFinished={onFinished}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Real estate license">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
          <h2 className="flex-1 text-base font-semibold text-gray-900">Before you sign: real estate license</h2>
          <button
            ref={closeRef}
            type="button"
            disabled={phase === "opening"}
            onClick={() => onFinished("closed")}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
        </div>

        {phase === "opening" ? (
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <Spinner label={preparing ? "Preparing your agreement..." : "Opening your agreement..."} />
            <p className="text-xs text-gray-500">This takes a few seconds.</p>
          </div>
        ) : (
          <form onSubmit={open} className="space-y-4 overflow-y-auto px-5 py-4 text-sm text-gray-700">
            <p>We ask this before you sign and keep it on your account. It is not printed on the agreement.</p>
            {license.loading ? <Spinner label="Loading..." /> : <LicenseDisclosureFields state={license} idPrefix="sign-license" />}
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={!license.ready}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                Continue to the agreement
              </button>
              {preparing && <Spinner label="Preparing your agreement..." className="text-xs" />}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
