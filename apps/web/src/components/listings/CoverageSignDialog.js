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
 * confirms the signature, `onSigned` runs. Signing only covers the drafts: the
 * opener then asks before publishing (Wyatt, 2026-11-09). Closing it leaves
 * everything as a draft.
 *
 * Props: uncovered [{ listingId, address, missingUnits? }], onSigned(), onClose().
 */
/*
 * A landlord with an authorized signer (Project B, Wyatt 2026-11-09) never signs
 * for what that signer holds: they confirm that what they are publishing goes to
 * the signer's addendum. It stays a draft: once the signer signs it is approved,
 * the landlord is emailed, and they publish it.
 *
 * Listings can have different signers (Wyatt, 2026-11-25): each signer gets their
 * own request for the listings they hold, in one send. Anything the landlord
 * signs for themselves (`alsoOwn`) opens for signing right after.
 */
function SendToPayerDialog({ uncovered, payer, alsoOwn = 0, onSent, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ids = [...new Set(uncovered.map((u) => u.listingId).filter(Boolean))];
  // Who gets what: signer name -> the addresses that go to them.
  const bySigner = new Map();
  for (const u of uncovered) {
    const who = u.signerName || payer.name;
    const list = bySigner.get(who) ?? [];
    if (u.address && u.address !== "This listing" && !list.includes(u.address)) list.push(u.address);
    bySigner.set(who, list);
  }
  const several = bySigner.size > 1;
  const who = several ? "your authorized signers" : [...bySigner.keys()][0] ?? payer.name;
  const names = [...new Set([...bySigner.values()].flat())];
  const what = names.length ? names.join("; ") : ids.length === 1 ? "this listing" : "these listings";
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/payer/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingIds: ids }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send it. Please try again.");
      toast.success(`Sent to ${who}. We'll email you when ${several ? "each approves theirs" : "they approve it"}, then you can publish.`, { duration: 8000 });
      onSent();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="send-to-payer-title">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl max-xl:max-h-[calc(100dvh-2rem)] max-xl:overflow-y-auto">
        <h2 id="send-to-payer-title" className="text-base font-semibold text-gray-900">
          Send to {who} to sign
        </h2>
        {several ? (
          <>
            <p className="mt-2 text-sm text-gray-700">
              These listings have different authorized signers. Each one gets an addendum with only their own listings to sign. Everything
              stays a draft. Once a signer approves theirs, we email you and you can publish it.
            </p>
            <ul className="mt-2 space-y-1 text-sm text-gray-700">
              {[...bySigner.entries()].map(([name, list]) => (
                <li key={name}>
                  <span className="font-medium text-gray-900">{name}</span>: {list.length ? list.join("; ") : "this listing"}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-sm text-gray-700">
            {who} is the authorized signer for {what}, so it will be added to an addendum for them to sign. It stays a draft. Once they
            approve it, we email you and you can publish it.
          </p>
        )}
        {alsoOwn > 0 && (
          <p className="mt-2 text-sm text-gray-700">
            {alsoOwn === 1 ? "One listing is" : `${alsoOwn} listings are`} yours to sign for. That opens next.
          </p>
        )}
        {ids.length === 0 && <p className="mt-2 text-sm text-red-700">Save it first, then publish again.</p>}
        {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60">
            Keep as draft
          </button>
          <button type="button" onClick={send} disabled={busy || ids.length === 0} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {busy ? "Sending..." : `Send to ${several ? "signers" : who}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * After the landlord signed: their drafts are covered, and publishing is their
 * choice, the same as a listing their authorized signer approved (Wyatt, 2026-11-09).
 */
// `alsoWaiting`: how many listings of the same publish went to an authorized
// signer instead: they stay drafts whatever is chosen here.
function CoveredDialog({ names, alsoWaiting = 0, onPublish, onClose }) {
  const [busy, setBusy] = useState(false);
  const what = names.length === 1 ? names[0] : "these listings";
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="covered-title">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl max-xl:max-h-[calc(100dvh-2rem)] max-xl:overflow-y-auto">
        <h2 id="covered-title" className="text-base font-semibold text-gray-900">
          Signed. {names.length === 1 ? "It is" : "They are"} covered
        </h2>
        <p className="mt-2 text-sm text-gray-700">
          {what} {names.length === 1 ? "is" : "are"} now on your marketing agreement and still {names.length === 1 ? "a draft" : "drafts"}. Publish now, or
          keep {names.length === 1 ? "it" : "them"} as {names.length === 1 ? "a draft" : "drafts"} and publish later.
        </p>
        {alsoWaiting > 0 && (
          <p className="mt-2 text-sm text-gray-700">
            {alsoWaiting === 1 ? "The listing you sent to its authorized signer stays a draft" : `The ${alsoWaiting} listings you sent to their authorized signers stay drafts`} until
            they approve.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60">
            Keep as draft
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onPublish();
            }}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? "Publishing..." : "Publish now"}
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
 * "signed" once the landlord signed and chose Publish now (after onSigned ran),
 * "covered" when they signed and kept it a draft, or "closed".
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
    // What goes to a signer, and what the landlord signs for themselves. Each
    // uncovered entry says who signs for it (`signerName`; without one on any of
    // them, an older response: everything goes to the one signer).
    const marked = uncovered.some((u) => "signerName" in u);
    const theirs = payer?.name ? uncovered.filter((u) => !marked || u.signerName) : [];
    const own = payer?.name ? uncovered.filter((u) => marked && !u.signerName) : uncovered;
    const names = [...new Set(own.map((u) => u.address).filter((a) => a && a !== "This listing"))];
    const signOwn = () => root.render(
      <CoverageSignDialog
        uncovered={own}
        onClose={() => done("closed")}
        onSigned={() =>
          root.render(
            <CoveredDialog
              names={names}
              alsoWaiting={theirs.length}
              onClose={() => {
                toast.success("Saved as a draft. Publish it from your drafts when you're ready.");
                done("covered");
              }}
              onPublish={async () => {
                try {
                  // Part of the batch went to a signer and stays a draft: publish the rest.
                  await onSigned?.({ partial: theirs.length > 0 });
                } finally {
                  done("signed");
                }
              }}
            />
          )
        }
      />
    );
    if (theirs.length) {
      root.render(
        <SendToPayerDialog
          uncovered={theirs}
          payer={payer}
          alsoOwn={own.length}
          onSent={() => (own.length ? signOwn() : done("sent"))}
          onClose={() => done("closed")}
        />
      );
      return;
    }
    signOwn();
  });
}

/*
 * A save that came back `agreement_needed` (saved as a draft, api/addListing):
 * open signing for it, and once signed publish what the response lists.
 * Resolves { live, waiting }: `live` when at least one target went live,
 * `waiting` when one stays a draft for its authorized signer (that toast is
 * shown here, so the caller adds none). Only a publish that worked counts as
 * live (PR 486 review): a target waiting on its signer is still a draft.
 */
export async function signThenPublish(data) {
  let published = 0;
  let waitingNote = null;
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
          // One that waits on its authorized signer (sent to them a moment ago) stays a draft.
          if (err.code === "billing_setup_required" && err.payer) {
            waitingNote = err.drafted || err.error || "Signed. This waits for its authorized signer before it goes live.";
            continue;
          }
          toast.error(err.error || "Signed, but we couldn't publish it. Publish it from your drafts.");
          return;
        }
        published += 1;
      }
    },
  });
  if (waitingNote) toast(waitingNote, { duration: 10000 });
  return { live: published > 0, waiting: !!waitingNote };
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
