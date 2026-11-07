"use client";

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
export default function CoverageSignDialog({ uncovered, onSigned, onClose }) {
  const ids = uncovered.map((u) => u.listingId).filter(Boolean);
  const names = uncovered.map((u) => (u.missingUnits?.length ? `${u.address} (units ${u.missingUnits.join(", ")})` : u.address));
  const intro = `To publish ${names.join("; ")}, ${names.length === 1 ? "it needs" : "they need"} to be on your marketing agreement's Exhibit A. Your drafts stay saved whatever you choose.`;
  return (
    <AgreementSigningFlow
      listingIds={ids}
      intro={intro}
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
