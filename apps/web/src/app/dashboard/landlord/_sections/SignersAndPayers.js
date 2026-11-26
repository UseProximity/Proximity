"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import CollapsibleSection from "./CollapsibleSection";

/*
 * Who signs and who pays (Wyatt, 2026-11-25).
 *
 *   WhoSignsAndPays   the landlord's card: the account's authorized payer, and
 *                     for each listing who signs for it and who is invoiced,
 *                     with a signer or a payer of its own where they set one.
 *                     The account's authorized SIGNER is still named from the
 *                     Marketing agreement card, where the agreement lives.
 *   PayingForCard     for someone named as an authorized payer: each request to
 *                     accept or decline, and what they pay for once accepted.
 *
 * The rules are the server's (lib/billing/payerLinks.js): a listing's own signer
 * takes it from the account's signer; a named payer who accepted is invoiced
 * before whoever signs; until a payer accepts, nothing changes.
 */

const INPUT = "mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-red-400 focus:outline-none";
const BUTTON = "px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60";
const PRIMARY = "rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60";
const LINK = "text-xs text-gray-600 underline hover:text-gray-900 disabled:opacity-60";
const PILL = {
  pending: "bg-amber-100 text-amber-800",
  accepted: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
};

// Like fetch().json(), but a refusal throws with the server's `code` kept.
async function call(url, { method = "GET", body } = {}) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Something went wrong. Please try again.");
    err.code = data.code;
    throw err;
  }
  return data;
}

function Pill({ status }) {
  const label = status === "accepted" ? "Accepted" : status === "declined" ? "Declined" : "Waiting for them to accept";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PILL[status] ?? PILL.pending}`}>{label}</span>;
}

/*
 * Name and email of the person, then Send. `warning` is the server's "already
 * covered" notice: shown with a Confirm button before anything is handed over.
 */
function PersonForm({ idPrefix, intro, submitLabel, busy, error, warning = null, onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <form
      className="mt-2 space-y-3 rounded-md border border-gray-200 bg-white px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, email, confirm: !!warning });
      }}
    >
      {intro && <p className="text-sm text-gray-700">{intro}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-gray-700" htmlFor={`${idPrefix}-name`}>
          Their full name
          <input id={`${idPrefix}-name`} className={INPUT} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={100} disabled={!!warning} />
        </label>
        <label className="block text-sm text-gray-700" htmlFor={`${idPrefix}-email`}>
          Their email
          <input id={`${idPrefix}-email`} type="email" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" maxLength={254} disabled={!!warning} />
        </label>
      </div>
      {warning && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{warning}</p>}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={PRIMARY} disabled={busy || !name.trim() || !email.trim()}>
          {busy ? "Sending..." : warning ? "Confirm and hand over" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// "Remove X?" with what it means, before anyone is removed.
function ConfirmRemove({ text, label = "Remove", busy, onConfirm, onCancel }) {
  return (
    <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-white px-3 py-3 text-sm text-gray-800">
      <p>{text}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={PRIMARY} onClick={onConfirm} disabled={busy}>
          {label}
        </button>
      </div>
    </div>
  );
}

const signsLabel = (signs) => (signs.name ? signs.name : "You");
const paysLabel = (pays) => (pays.name ? pays.name : "You");

/*
 * `data` is GET /api/billing/assignments; `payers` is GET
 * /api/billing/authorized-payers. `onChanged()` reloads the Billing tab.
 */
export function WhoSignsAndPays({ data, payers, onChanged }) {
  // What is open: { kind: "payer" | "signer" | "change-payer" | "remove-payer" | "remove-signer", listingId | null }.
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  if (!data) return null;
  const isOpen = (kind, listingId = null) => open?.kind === kind && (open.listingId ?? null) === listingId;
  const show = (kind, listingId = null) => {
    setError(null);
    setWarning(null);
    setOpen({ kind, listingId });
  };
  const close = () => {
    setOpen(null);
    setError(null);
    setWarning(null);
  };

  const run = async (fn, done) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.success(done, { duration: 7000 });
      close();
      onChanged();
    } catch (e) {
      // A listing covered now: the server says what handing it over means. Show it and ask.
      if (e.code === "listing_covered") setWarning(e.message);
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const namePayer = (listingId) => ({ name, email }) =>
    run(() => call("/api/billing/authorized-payers", { method: "POST", body: { name, email, ...(listingId && { listingId }) } }), `We emailed ${name.trim()} the request. Nothing changes until they accept.`);
  const changePayer = (linkId) => ({ name, email }) =>
    run(() => call("/api/billing/authorized-payers", { method: "PATCH", body: { action: "change", linkId, name, email } }), `We emailed ${name.trim()} the request. Nothing changes until they accept.`);
  const removePayer = (p) =>
    run(() => call("/api/billing/authorized-payers", { method: "PATCH", body: { action: "revoke", linkId: p.linkId, confirm: true } }), `${p.name} is no longer the authorized payer there.`);
  const resendPayer = async (p) => {
    setBusy(true);
    try {
      await call("/api/billing/authorized-payers", { method: "PATCH", body: { action: "resend", linkId: p.linkId } });
      toast.success(`Emailed ${p.name} again.`);
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const nameSigner = (listingId) => ({ name, email, confirm }) =>
    run(() => call("/api/billing/payer", { method: "POST", body: { name, email, listingId, ...(confirm && { confirm: true }) } }), `We emailed ${name.trim()} the agreement and a link to sign for this listing.`);

  // The payer set on one level (the account, or a listing): their status and what can be done.
  const payerLine = (p, listingId = null) => (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
        <span>
          {p.name} <span className="text-xs text-gray-500">({p.email})</span>
        </span>
        <Pill status={p.status} />
        {p.status === "pending" && (
          <button type="button" className={LINK} disabled={busy} onClick={() => resendPayer(p)}>
            Resend
          </button>
        )}
        <button type="button" className={LINK} disabled={busy} onClick={() => show("change-payer", listingId)}>
          Change
        </button>
        <button type="button" className={LINK} disabled={busy} onClick={() => show("remove-payer", listingId)}>
          Remove
        </button>
      </div>
      {isOpen("change-payer", listingId) && (
        <PersonForm
          idPrefix={`change-payer-${listingId ?? "account"}`}
          intro={`${p.name} stops being the authorized payer here. Until the new person accepts, charges go to whoever signs, or to you.`}
          submitLabel="Send request"
          busy={busy}
          error={error}
          onSubmit={changePayer(p.linkId)}
          onCancel={close}
        />
      )}
      {isOpen("remove-payer", listingId) && (
        <ConfirmRemove
          busy={busy}
          text={
            p.status === "accepted"
              ? `Remove ${p.name} as the authorized payer? New charges go to whoever signs, or to you. Charges already made stay on ${p.name}'s invoices.`
              : `Withdraw the request to ${p.name}? Nothing was billed to them.`
          }
          label={p.status === "accepted" ? "Remove payer" : "Withdraw request"}
          onConfirm={() => removePayer(p)}
          onCancel={close}
        />
      )}
    </div>
  );

  const account = payers?.account ?? null;
  const overrides = data.listings.filter((l) => l.ownSigner || l.ownPayer).length;

  return (
    <CollapsibleSection
      id="who-signs-and-pays"
      title="Who signs and who pays"
      defaultOpen={!!account || overrides > 0}
      summary={
        account || overrides
          ? [account ? `Authorized payer: ${account.name}.` : null, overrides ? `${overrides} ${overrides === 1 ? "listing has" : "listings have"} their own signer or payer.` : null].filter(Boolean).join(" ")
          : "Optional. Have someone else pay, or set a different signer or payer for one listing."
      }
    >
      <div className="space-y-5 px-4 py-4">
        <p className="text-sm text-gray-700">
          An authorized signer signs the marketing agreement. An authorized payer receives and pays the invoices. Both are optional: set them for your whole
          account, or for one listing when it has a different owner. A listing&apos;s own signer or payer takes that listing; everything else follows your account.
        </p>

        <div>
          <p className="text-sm font-semibold text-gray-900">Your account</p>
          <dl className="mt-1 space-y-2 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Signs the agreement</dt>
              <dd className="text-gray-800">
                {data.account.signer ? data.account.signer.name : "You"}{" "}
                <a href="#marketing-agreement" className={LINK} data-readonly-ok>
                  {data.account.signer ? "Manage under Marketing agreement" : "Name a signer under Marketing agreement"}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Pays the invoices</dt>
              <dd>
                {account ? (
                  payerLine(account)
                ) : (
                  <div className="text-gray-800">
                    {data.account.signer ? `${data.account.signer.name}, as your authorized signer` : "You"}{" "}
                    {!isOpen("payer") && (
                      <button type="button" className={LINK} disabled={busy} onClick={() => show("payer")}>
                        Name an authorized payer
                      </button>
                    )}
                    {isOpen("payer") && (
                      <PersonForm
                        idPrefix="payer-account"
                        intro="We email them a request to accept. Once they accept, new charges are invoiced to them, they add the payment method, and they can review or dispute each charge, as you can. Until then nothing changes."
                        submitLabel="Send request"
                        busy={busy}
                        error={error}
                        onSubmit={namePayer(null)}
                        onCancel={close}
                      />
                    )}
                  </div>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-900">Each listing</p>
          {data.listings.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">You have no listings yet. Once you add one, you can give it its own signer or payer here.</p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-100">
              {data.listings.map((l) => (
                <li key={l.listingId} className="px-3 py-3">
                  <p className="text-sm font-medium text-gray-900">
                    {l.address}{" "}
                    <span className="text-xs font-normal text-gray-500">
                      ({l.live ? "live" : "draft"}
                      {l.covered ? ", covered" : ", not covered yet"})
                    </span>
                  </p>
                  <div className="mt-1 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Signs</p>
                      <p className="text-gray-800">
                        {signsLabel(l.signs)}
                        {l.ownSigner ? <span className="text-xs text-gray-500"> (this listing only)</span> : l.signs.via === "account" ? <span className="text-xs text-gray-500"> (your account&apos;s signer)</span> : null}
                      </p>
                      {l.ownSigner ? (
                        <a href={`#listing-signer-${l.listingId}`} className={LINK} data-readonly-ok>
                          See status or remove
                        </a>
                      ) : (
                        !isOpen("signer", l.listingId) && (
                          <button type="button" className={LINK} disabled={busy} onClick={() => show("signer", l.listingId)}>
                            Set a signer for this listing
                          </button>
                        )
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pays</p>
                      {l.ownPayer ? (
                        payerLine(l.ownPayer, l.listingId)
                      ) : (
                        <>
                          <p className="text-gray-800">
                            {paysLabel(l.pays)}
                            {l.pays.via === "account_payer" ? <span className="text-xs text-gray-500"> (your account&apos;s payer)</span> : l.pays.via === "signer" ? <span className="text-xs text-gray-500"> (as its signer)</span> : null}
                          </p>
                          {!isOpen("payer", l.listingId) && (
                            <button type="button" className={LINK} disabled={busy} onClick={() => show("payer", l.listingId)}>
                              Set a payer for this listing
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {isOpen("signer", l.listingId) && (
                    <PersonForm
                      idPrefix={`signer-${l.listingId}`}
                      intro={`They sign the marketing agreement for ${l.address} only. We email them the agreement and the Missouri Broker Disclosure Form with a link to sign. They also receive its invoices, unless it has an authorized payer.`}
                      submitLabel="Send to sign"
                      busy={busy}
                      error={error}
                      warning={warning}
                      onSubmit={nameSigner(l.listingId)}
                      onCancel={close}
                    />
                  )}
                  {isOpen("payer", l.listingId) && (
                    <PersonForm
                      idPrefix={`payer-${l.listingId}`}
                      intro={`They receive and pay the invoices for ${l.address} only, once they accept. Until then nothing changes.`}
                      submitLabel="Send request"
                      busy={busy}
                      error={error}
                      onSubmit={namePayer(l.listingId)}
                      onCancel={close}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}

/*
 * For someone named as an authorized payer: requests to answer, and what they
 * pay for. `accounts` is GET /api/billing/paying-for.
 */
export function PayingForCard({ accounts, onChanged }) {
  const [busy, setBusy] = useState(false);
  if (!accounts?.length) return null;
  const pending = accounts.filter((a) => a.status === "pending");
  const accepted = accounts.filter((a) => a.status === "accepted");
  const what = (a) => (a.scope === "listing" ? `${a.accountName}'s listing at ${a.listingAddress}` : `${a.accountName}'s listings`);

  const answer = async (a, action) => {
    setBusy(true);
    try {
      await call("/api/billing/paying-for", { method: "PATCH", body: { action, linkId: a.linkId } });
      toast.success(action === "accept" ? `You now pay for ${what(a)}. Add a payment method below if you have not yet.` : "Declined. Nothing is billed to you.", { duration: 7000 });
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CollapsibleSection
      id="paying-for"
      title="Listings you pay for"
      defaultOpen
      badge={pending.length ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PILL.pending}`}>{pending.length === 1 ? "1 request" : `${pending.length} requests`}</span> : null}
      summary={accepted.length ? `You are the authorized payer for ${accepted.length === 1 ? "1 account or listing" : `${accepted.length} accounts or listings`}.` : "A landlord asked you to pay for their listings."}
    >
      <div className="space-y-4 px-4 py-4">
        {pending.map((a) => (
          <div key={a.linkId} className="space-y-2 rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p>
              <span className="font-semibold">{a.accountName}</span> asked you to be the authorized payer for {a.scope === "listing" ? `their listing at ${a.listingAddress}` : "their Proximity listings"}.
            </p>
            <p>
              If you accept, the charges made from then on are invoiced to you, and you can review or dispute each one before it is invoiced. Proximity only charges
              when a student who found the property here signs a lease. Nothing is billed to you unless you accept.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={PRIMARY} disabled={busy} onClick={() => answer(a, "accept")}>
                Accept
              </button>
              <button type="button" className={BUTTON} disabled={busy} onClick={() => answer(a, "decline")}>
                Decline
              </button>
            </div>
          </div>
        ))}
        {accepted.length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-900">You are the authorized payer for:</p>
            <ul className="mt-1 space-y-1 text-sm text-gray-800">
              {accepted.map((a) => (
                <li key={a.linkId}>
                  {a.accountName}
                  <span className="text-xs text-gray-500"> ({a.scope === "listing" ? a.listingAddress : "all of their listings"})</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-gray-500">
              Their charges are listed under Charges with the account&apos;s name, and go on your invoices. To stop paying for one, ask the landlord to remove you, or email
              info@useproximity.org.
            </p>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
