"use client";

import { useEffect, useState } from "react";
import { billingFetch } from "@/components/admin/billing/billingFetch";
import LandlordPicker, { landlordName } from "@/components/admin/billing/LandlordPicker";
import { CHARGE_REASONS, REVIEW_DAYS } from "@/lib/billing/constants";
import { dollarsToCents, formatCents } from "@/lib/billing/money";

const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500";
const LABEL = "block text-sm font-medium text-gray-700";
const PRIMARY =
  "px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-60";
const BUTTON = "px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60";

// Rent times rate, in dollars with cents: the amount the commission works out to.
function suggestedAmount(signedRent, rate) {
  const rentCents = dollarsToCents(signedRent);
  const pct = Number(rate);
  if (!rentCents || !Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  return (Math.round((rentCents * pct) / 100) / 100).toFixed(2);
}

/*
 * Create charge: a super admin puts a real charge on one landlord's account.
 * It starts the landlord's 7 day review straight away and emails them, so the
 * last step asks to confirm the landlord and amount.
 */
export default function CreateChargeForm({ onCreated }) {
  const [landlord, setLandlord] = useState(null);
  const [properties, setProperties] = useState([]);
  const [listingId, setListingId] = useState("");
  const [leaseId, setLeaseId] = useState("");
  const [reason, setReason] = useState("lease_signed");
  const [description, setDescription] = useState("");
  const [signedRent, setSignedRent] = useState("");
  const [rate, setRate] = useState("");
  const [amount, setAmount] = useState("");
  const [amountEdited, setAmountEdited] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    setProperties([]);
    setListingId("");
    setLeaseId("");
    if (!landlord) return undefined;
    let stale = false;
    (async () => {
      try {
        const res = await billingFetch(`/api/admin/billing/landlords/search?landlordId=${landlord.id}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not load their properties.");
        if (!stale) setProperties(body.properties ?? []);
      } catch (err) {
        if (!stale) setError(err.message);
      }
    })();
    return () => {
      stale = true;
    };
  }, [landlord]);

  // The commission works out the amount until the admin types their own.
  const suggestion = suggestedAmount(signedRent, rate);
  useEffect(() => {
    if (!amountEdited) setAmount(suggestion ?? "");
  }, [suggestion, amountEdited]);

  const property = properties.find((p) => p.listingId === listingId) ?? null;
  const lease = property?.leases.find((l) => l.leaseId === leaseId) ?? null;
  const amountCents = dollarsToCents(amount);
  const ready = !!landlord && !!amountCents && (reason !== "other" || description.trim());

  function reset() {
    setLandlord(null);
    setReason("lease_signed");
    setDescription("");
    setSignedRent("");
    setRate("");
    setAmount("");
    setAmountEdited(false);
    setConfirming(false);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await billingFetch("/api/admin/billing/charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ landlordId: landlord.id, amount, reason, description, listingId: listingId || null, leaseId: leaseId || null, signedRent, commissionRate: rate }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not create the charge.");
      const who = landlordName(landlord);
      setDone(
        body.status === "pending"
          ? `Charged ${who} ${formatCents(amountCents)}. Their ${REVIEW_DAYS} day review has started${body.emailed ? " and they were emailed" : ", but the email did not go out: let them know"}.`
          : `Created the charge for ${who}, but its review did not start. Confirm it under To confirm.`
      );
      reset();
      onCreated?.();
    } catch (err) {
      setError(err.message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setDone(null);
        if (ready) setConfirming(true);
      }}
      className="max-w-xl space-y-4 rounded-lg border border-gray-100 bg-white p-4"
    >
      <p className="text-sm text-gray-600">
        Puts a charge on a landlord&apos;s account. They are emailed and get {REVIEW_DAYS} days to approve or contest it. If they do
        nothing it is approved and goes on their next monthly invoice.
      </p>

      <div className={LABEL}>
        Landlord
        <div className="mt-1">
          <LandlordPicker value={landlord} disabled={busy || confirming} onChange={(l) => { setLandlord(l); setDone(null); }} />
        </div>
      </div>

      {landlord && (
        <>
          <div className="flex flex-wrap gap-3">
            <label className={`${LABEL} min-w-[14rem] flex-1`}>
              Property (optional)
              <select className={`${FIELD} mt-1`} value={listingId} disabled={confirming} onChange={(e) => { setListingId(e.target.value); setLeaseId(""); }}>
                <option value="">No property</option>
                {properties.map((p) => (
                  <option key={p.listingId} value={p.listingId}>{p.address}</option>
                ))}
              </select>
            </label>
            {property && property.leases.length > 0 && (
              <label className={`${LABEL} min-w-[14rem] flex-1`}>
                Unit and lease (optional)
                <select className={`${FIELD} mt-1`} value={leaseId} disabled={confirming} onChange={(e) => setLeaseId(e.target.value)}>
                  <option value="">Not a specific lease</option>
                  {property.leases.map((l) => (
                    <option key={l.leaseId} value={l.leaseId}>
                      {l.label}{l.rentCents ? ` (listed at ${formatCents(l.rentCents)})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <label className={`${LABEL} w-48`}>
              What it is for
              <select className={`${FIELD} mt-1`} value={reason} disabled={confirming} onChange={(e) => setReason(e.target.value)}>
                {Object.entries(CHARGE_REASONS).map(([key, text]) => (
                  <option key={key} value={key}>{text}</option>
                ))}
              </select>
            </label>
            <label className={`${LABEL} min-w-[14rem] flex-1`}>
              Note to the landlord{reason === "other" ? "" : " (optional)"}
              <input
                className={`${FIELD} mt-1`}
                value={description}
                maxLength={500}
                disabled={confirming}
                placeholder="Tenant Jane Doe, 12 month lease from Aug 1"
                onChange={(e) => setDescription(e.target.value)}
                required={reason === "other"}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <label className={`${LABEL} min-w-[9rem] flex-1`}>
              Signed rent (optional, $)
              <input className={`${FIELD} mt-1`} value={signedRent} inputMode="decimal" placeholder="1500.00" disabled={confirming} onChange={(e) => setSignedRent(e.target.value)} />
            </label>
            <label className={`${LABEL} min-w-[9rem] flex-1`}>
              Commission rate (optional, %)
              <input className={`${FIELD} mt-1`} value={rate} inputMode="decimal" placeholder="25" disabled={confirming} onChange={(e) => setRate(e.target.value)} />
            </label>
            <label className={`${LABEL} min-w-[9rem] flex-1`}>
              Amount ($)
              <input
                className={`${FIELD} mt-1`}
                value={amount}
                inputMode="decimal"
                placeholder="375.00"
                disabled={confirming}
                onChange={(e) => { setAmount(e.target.value); setAmountEdited(true); }}
                required
              />
            </label>
          </div>
          <p className="-mt-2 text-xs text-gray-500">
            Rent and rate are shown to the landlord as the basis (&quot;25% of $1,500.00 signed rent&quot;) and fill in the amount. Check the rate
            against the agreement this landlord signed.
            {amountEdited && suggestion && suggestion !== amount ? (
              <>
                {" "}
                <button type="button" className="underline" onClick={() => setAmountEdited(false)}>Use ${suggestion}</button>
              </>
            ) : null}
          </p>
        </>
      )}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {done && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>}

      {confirming ? (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p>
            Charge <strong>{landlordName(landlord)}</strong> <strong>{formatCents(amountCents)}</strong> for {CHARGE_REASONS[reason].toLowerCase()}
            {property ? ` at ${property.address}` : ""}
            {lease ? ` (${lease.label})` : ""}? They will be emailed now and have {REVIEW_DAYS} days to review it.
          </p>
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} disabled={busy} onClick={create}>
              {busy ? "Charging..." : "Yes, charge them"}
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => setConfirming(false)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        landlord && (
          <button type="submit" disabled={!ready} className={PRIMARY}>
            Review charge
          </button>
        )
      )}
    </form>
  );
}
