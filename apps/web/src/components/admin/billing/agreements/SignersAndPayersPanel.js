"use client";

import { useEffect, useState } from "react";
import { BUTTON, FIELD, PRIMARY, call, postJson } from "./shared";

/*
 * The payer's email, looked up as it is typed (Wyatt, 2026-11-09): an existing
 * landlord or billing account is named; a new email says an account will be
 * made and they set a password from the email; an account that can't pay says
 * why. The name is filled from an existing account and asked for a new one.
 */
export function PayerLookup({ name, setName, email, setEmail, onStatus, who = "Authorized signer" }) {
  const [found, setFound] = useState(null);
  useEffect(() => {
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setFound(null);
      onStatus(null);
      return undefined;
    }
    const t = setTimeout(() => {
      call(`/api/admin/billing/payers/lookup?${new URLSearchParams({ email: e })}`)
        .then((r) => {
          setFound(r);
          onStatus(r.status);
          if (r.status === "existing" && r.user?.name) setName((n) => n || r.user.name);
        })
        .catch(() => {
          setFound(null);
          onStatus(null);
        });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);
  return (
    <div className="space-y-2">
      <input className={FIELD} type="email" placeholder={`${who}'s email`} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
      {found?.status === "existing" && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-xs text-green-900">
          Existing {found.user.billingOnly ? "billing account" : "landlord account"}: {found.user.name || found.user.email}
          {found.user.paysFor ? `, already pays for ${found.user.paysFor} ${found.user.paysFor === 1 ? "account" : "accounts"}` : ""}. They sign in with their
          own login.
        </p>
      )}
      {found?.status === "new" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No account has this email. Assigning creates a billing account for them, and the email we send asks them to set a password first.
        </p>
      )}
      {found?.status === "refused" && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">{found.reason}</p>}
      {(found?.status === "new" || found?.status === "existing") && (
        <input className={FIELD} placeholder={who === "Authorized signer" ? "Authorized signer's full name (as it goes on the agreement)" : `${who}'s full name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
      )}
    </div>
  );
}

/*
 * Who signs and who pays for one landlord, per listing (Wyatt, 2026-11-25), on
 * their row in Billing > Landlords and agreements. The account's authorized
 * signer keeps its own buttons on the row; here an admin sets the account's
 * authorized payer, and a signer or payer for a single listing.
 *
 * A payer is only invoiced once they accept the request we email them. A listing
 * covered now can be handed to a signer of its own after a confirm: it is
 * uncovered until the new signer signs.
 */
function AssignForm({ title, note, who, submitLabel, busy, onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null);
  const [notify, setNotify] = useState(true);
  const ok = (status === "existing" || status === "new") && name.trim();
  return (
    <form
      className="mt-2 space-y-2 rounded-md border border-gray-200 bg-white px-3 py-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, email, notify });
      }}
    >
      <p className="font-medium text-gray-900">{title}</p>
      <p className="text-gray-700">{note}</p>
      <PayerLookup name={name} setName={setName} email={email} setEmail={setEmail} onStatus={setStatus} who={who} />
      <label className="flex items-center gap-2 text-gray-700">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        Email the landlord about it
      </label>
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={busy || !ok}>
          {submitLabel}
        </button>
        <button type="button" className={BUTTON} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const del = (body) => call("/api/admin/billing/payers", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function SignersAndPayersPanel({ row, busy, run }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // The form open: { role: "signer" | "payer", listingId | null }.
  const [form, setForm] = useState(null);
  const label = row.name || row.email || "this landlord";

  // `row` is a new object after every action on the list, so this reloads then too.
  useEffect(() => {
    let live = true;
    call(`/api/admin/billing/payers/listings?${new URLSearchParams({ landlordId: row.id })}`)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [row]);

  const assign = (role, listing) => ({ name, email, notify }) =>
    run(async () => {
      const body = { name, email, role, notifyLandlords: notify, ...(listing ? { listings: [{ landlordId: row.id, listingId: listing.listingId }] } : { landlordIds: [row.id] }) };
      let r = await postJson("/api/admin/billing/payers", body);
      // Covered now: say what handing it over means, and only then do it.
      const covered = r.failed?.find((f) => f.code === "listing_covered");
      if (covered) {
        if (!window.confirm(covered.error)) return "Nothing changed.";
        r = await postJson("/api/admin/billing/payers", { ...body, confirm: true });
      }
      if (r.failed?.length) throw new Error(r.failed.map((f) => f.error).join(" "));
      setForm(null);
      const where = listing ? listing.address : label;
      return role === "payer"
        ? `We emailed ${name.trim()} the request to pay for ${where}. Nothing is billed to them until they accept.`
        : `${name.trim()} is now the authorized signer for ${where}. We emailed them.`;
    });

  const endSigner = (listing) => {
    if (!window.confirm(`End ${listing.ownSigner.name} as the signer for ${listing.address}? It comes off their agreement and is not covered until it is signed for again.`)) return;
    return run(() => del({ landlordId: row.id, listingId: listing.listingId }), "Listing signer ended.");
  };
  const endPayer = (p, where) => {
    const text = p.status === "accepted" ? `Remove ${p.name} as the authorized payer for ${where}? Charges already made stay on their invoices.` : `Withdraw the request to ${p.name} for ${where}?`;
    if (!window.confirm(text)) return;
    return run(() => del({ landlordId: row.id, role: "payer", linkId: p.linkId }), p.status === "accepted" ? "Authorized payer removed." : "Request withdrawn.");
  };

  const payerLine = (p, where) => (
    <span>
      {p.name} ({p.email}), {p.status === "accepted" ? "accepted" : "not accepted yet"}{" "}
      <button type="button" className="text-xs text-gray-600 underline hover:text-gray-900 disabled:opacity-60" disabled={busy} onClick={() => endPayer(p, where)}>
        {p.status === "accepted" ? "Remove" : "Withdraw"}
      </button>
    </span>
  );
  const small = "text-xs text-gray-600 underline hover:text-gray-900 disabled:opacity-60";
  const isOpen = (role, listingId = null) => form?.role === role && (form.listingId ?? null) === listingId;

  if (error) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500">Loading signers and payers...</p>;

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm">
      <p className="text-gray-700">
        A listing&apos;s own signer or payer takes that listing; everything else follows the account. A payer who has accepted is invoiced before whoever signs.
      </p>
      <div>
        <p className="font-medium text-gray-900">Account</p>
        <p className="text-gray-800">Signs: {data.account.signer ? `${data.account.signer.name} (${data.account.signer.email})` : "the landlord"}</p>
        <p className="text-gray-800">
          Pays:{" "}
          {data.account.payer ? (
            payerLine(data.account.payer, label)
          ) : (
            <>
              {data.account.signer ? `${data.account.signer.name}, as the signer` : "the landlord"}{" "}
              <button type="button" className={small} disabled={busy} onClick={() => setForm({ role: "payer", listingId: null })}>
                Set authorized payer
              </button>
            </>
          )}
        </p>
        {isOpen("payer") && (
          <AssignForm
            title={`Authorized payer for ${label}`}
            note="We email them a request. Once they accept, new charges on this account are invoiced to them. Until then nothing changes."
            who="Authorized payer"
            submitLabel="Send request"
            busy={busy}
            onSubmit={assign("payer", null)}
            onCancel={() => setForm(null)}
          />
        )}
      </div>
      <div>
        <p className="font-medium text-gray-900">Listings ({data.listings.length})</p>
        {data.listings.length === 0 && <p className="text-gray-500">No listings on this account.</p>}
        <ul className="mt-1 divide-y divide-gray-200">
          {data.listings.map((l) => (
            <li key={l.listingId} className="py-2">
              <p className="text-gray-900">
                {l.address}{" "}
                <span className="text-xs text-gray-500">
                  ({l.live ? "live" : "draft"}
                  {l.covered ? ", covered" : ", not covered"})
                </span>
              </p>
              <p className="text-gray-800">
                Signs: {l.signs.name ?? "the landlord"}
                {l.ownSigner ? " (this listing only) " : l.signs.via === "account" ? " (account signer) " : " "}
                {l.ownSigner ? (
                  <button type="button" className={small} disabled={busy} onClick={() => endSigner(l)}>
                    End
                  </button>
                ) : (
                  <button type="button" className={small} disabled={busy} onClick={() => setForm({ role: "signer", listingId: l.listingId })}>
                    Set signer for this listing
                  </button>
                )}
              </p>
              <p className="text-gray-800">
                Pays:{" "}
                {l.ownPayer ? (
                  payerLine(l.ownPayer, l.address)
                ) : (
                  <>
                    {l.pays.name ?? "the landlord"}
                    {l.pays.via === "account_payer" ? " (account payer) " : l.pays.via === "signer" ? " (as its signer) " : " "}
                    <button type="button" className={small} disabled={busy} onClick={() => setForm({ role: "payer", listingId: l.listingId })}>
                      Set payer for this listing
                    </button>
                  </>
                )}
              </p>
              {isOpen("signer", l.listingId) && (
                <AssignForm
                  title={`Signer for ${l.address}`}
                  note={`They sign the marketing agreement for this listing only, and receive its invoices unless it has an authorized payer. ${label} keeps signing for the rest.`}
                  who="Authorized signer"
                  submitLabel="Set signer"
                  busy={busy}
                  onSubmit={assign("signer", l)}
                  onCancel={() => setForm(null)}
                />
              )}
              {isOpen("payer", l.listingId) && (
                <AssignForm
                  title={`Payer for ${l.address}`}
                  note="We email them a request. Once they accept, new charges on this listing are invoiced to them."
                  who="Authorized payer"
                  submitLabel="Send request"
                  busy={busy}
                  onSubmit={assign("payer", l)}
                  onCancel={() => setForm(null)}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
