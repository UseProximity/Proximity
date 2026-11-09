"use client";

import { useState } from "react";
import { createRoot } from "react-dom/client";
import toast from "react-hot-toast";
import AgreementSigningFlow from "@/app/dashboard/landlord/_sections/AgreementSigningFlow";

/*
 * Shown when a publish is refused only because the properties are not on the
 * landlord's marketing agreement yet (listing gate, `uncovered`). It is the
 * signing popup (AgreementSigningFlow: details, Exhibit A, license), opened for
 * the properties being published, which are always on Exhibit A. Once Documenso
 * confirms the signature, `onSigned` runs: the caller publishes again. Closing it
 * leaves everything as a draft.
 *
 * Props: uncovered [{ listingId, address, missingUnits? }], onSigned(), onClose().
 */
/*
 * A landlord with a payer (Project B, Wyatt 2026-11-09) never signs: they confirm
 * that what they are publishing goes to their payer's addendum. It stays a draft
 * until the payer signs, then goes live and the landlord is emailed.
 */
function SendToPayerDialog({ uncovered, payer, onSent, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ids = [...new Set(uncovered.map((u) => u.listingId).filter(Boolean))];
  const names = [...new Set(uncovered.map((u) => u.address).filter((a) => a && a !== "This listing"))];
  const what = names.length ? names.join("; ") : ids.length === 1 ? "this listing" : "these listings";
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/payer/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingIds: ids }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send it. Please try again.");
      toast.success(`Sent to ${payer.name}. It goes live as soon as they sign.`, { duration: 8000 });
      onSent();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="send-to-payer-title">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 id="send-to-payer-title" className="text-base font-semibold text-gray-900">
          Send to {payer.name} to sign
        </h2>
        <p className="mt-2 text-sm text-gray-700">
          {payer.name} is your authorized signer, so {what} will be added to an addendum for them to sign. It stays a draft until they
          sign, then it goes live and we email you.
        </p>
        {ids.length === 0 && <p className="mt-2 text-sm text-red-700">Save it first, then publish again.</p>}
        {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60">
            Keep as draft
          </button>
          <button type="button" onClick={send} disabled={busy || ids.length === 0} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {busy ? "Sending..." : `Send to ${payer.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CoverageSignDialog({ uncovered, onSigned, onClose }) {
  const ids = uncovered.map((u) => u.listingId).filter(Boolean);
  // The units the publish check found uncovered (a withdrawn listing put back, say):
  // they go on the document so the retry goes through (Wyatt, 2026-11-07).
  const requiredUnits = Object.fromEntries(uncovered.filter((u) => u.listingId && u.missingUnits?.length).map((u) => [u.listingId, u.missingUnits]));
  const names = uncovered.map((u) => (u.missingUnits?.length ? `${u.address} (units ${u.missingUnits.join(", ")})` : u.address));
  const intro = `To publish ${names.join("; ")}, ${names.length === 1 ? "it needs" : "they need"} to be covered by your marketing agreement. Your drafts stay saved whatever you choose.`;
  return (
    <AgreementSigningFlow
      listingIds={ids}
      requiredUnits={requiredUnits}
      intro={intro}
      onFinished={(result) => {
        if (result === "signed") return onSigned();
        if (result === "closed") return onClose();
        // The agreement already covers this, yet the publish was refused: never
        // publish again on our own (that loops). Say so and leave it a draft.
        if (result === "nothing") {
          toast.error("Your agreement already covers this, but we could not publish it. Try Publish again, or contact us if it keeps happening.", { duration: 10000 });
          return onClose();
        }
        // Signed, but Documenso has not finished sealing it yet: the webhook will
        // record it shortly, and publishing again then goes straight through.
        toast("Signed. We are still saving your copy. Publish again in a minute.", { duration: 10000 });
        onClose("pending");
      }}
    />
  );
}

/*
 * Open the dialog from anywhere (a toast handler, a form submit). Resolves
 * "signed" once the landlord has signed (after onSigned ran), or "closed".
 */
// `payer` ({ name }, from the publish response): send to the payer instead of
// signing. Resolves "sent" then: still a draft, so the caller does not publish.
export function openCoverageDialog({ uncovered, onSigned, payer = null }) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (result) => {
      root.unmount();
      host.remove();
      resolve(result);
    };
    if (payer?.name) {
      root.render(<SendToPayerDialog uncovered={uncovered} payer={payer} onSent={() => done("sent")} onClose={() => done("closed")} />);
      return;
    }
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

/*
 * A save that came back `agreement_needed` (saved as a draft, api/addListing):
 * open signing for it, and once signed publish what the response lists. Resolves
 * true when it went live, false when it stays a draft.
 */
export async function signThenPublish(data) {
  let live = false;
  await openCoverageDialog({
    uncovered: data.uncovered ?? [],
    payer: data.payer ?? null,
    onSigned: async () => {
      for (const target of data.publish ?? []) {
        const r = await fetch("/api/landlord/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(target),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          toast.error(err.error || "Signed, but we couldn't publish it. Publish it from your drafts.");
          return;
        }
      }
      live = true;
    },
  });
  return live;
}

// True when the only thing stopping a publish is that the properties are not covered yet.
export function needsCoverageOnly(data) {
  // With a payer, a missing agreement or payment method is theirs to fix: the listing waits for them.
  if (data?.payer && data?.code === "billing_setup_required") {
    return (
      Array.isArray(data.missing) &&
      data.missing.length > 0 &&
      data.missing.every((m) => m === "agreement" || m === "payment_method") &&
      Array.isArray(data.uncovered) &&
      data.uncovered.length > 0
    );
  }
  return (
    data?.code === "billing_setup_required" &&
    Array.isArray(data.missing) &&
    data.missing.length === 1 &&
    data.missing[0] === "agreement" &&
    Array.isArray(data.uncovered) &&
    data.uncovered.length > 0
  );
}
