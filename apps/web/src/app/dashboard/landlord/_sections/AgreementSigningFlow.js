"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import SignAgreementDialog from "./SignAgreementDialog";
import Spinner from "./Spinner";
import SignerFields, { useSignerDetails } from "./SignerFields";
import LicenseDisclosureFields, { MissingHint, useLicenseDisclosure } from "@/components/account/LicenseDisclosureFields";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FIELD = "rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";
const BUTTON = "rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60";
const PRIMARY = "rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60";

// A JSON call. While another call for this landlord holds the signing lock (a
// background build still finishing) the sign route answers 409 "in_progress":
// wait and ask again rather than show that.
async function call(url, { method = "GET", body, retries = 0 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, {
      method,
      ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
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

const STEPS = ["Your details", "Exhibit A", "Real estate license"];

function Progress({ step }) {
  return (
    <ol className="grid grid-cols-3 gap-2 px-5 pt-4" aria-label="Signing steps">
      {STEPS.map((label, i) => (
        <li key={label} className="min-w-0">
          <div className={`h-1.5 rounded-full ${i <= step ? "bg-red-600" : "bg-gray-200"}`} />
          <p className={`mt-1 truncate text-xs ${i === step ? "font-semibold text-gray-900" : "text-gray-500"}`} aria-current={i === step ? "step" : undefined}>
            {i + 1}. {label}
          </p>
        </li>
      ))}
    </ol>
  );
}

// One unit on the Exhibit A step: tick it, or rename it with the pencil.
function UnitRow({ unit, checked, disabled, note, onToggle, onRenamed }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(unit.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call("/api/billing/agreement/units", { method: "PATCH", body: { unitId: unit.id, name } });
      onRenamed(unit.label, r.unit.label);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2">
        <input className={`${FIELD} w-40`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Unit name" autoFocus />
        <button type="button" className={BUTTON} disabled={busy || !name.trim()} onClick={save}>
          {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => { setEditing(false); setName(unit.label); }}>
          Cancel
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2">
      <label className="flex min-w-0 items-center gap-2 text-sm text-gray-800">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
        <span className="truncate">{unit.label}</span>
      </label>
      <button type="button" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={() => setEditing(true)} aria-label={`Rename ${unit.label}`}>
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {note && <span className="text-xs text-gray-400">{note}</span>}
    </li>
  );
}

// Add a unit the property is missing: a real unit, unpublished, with no leases.
function AddUnit({ listingId, onAdded }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: "", bedrooms: "1", bathrooms: "1" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!open) {
    return (
      <button type="button" className="text-sm font-medium text-red-700 hover:underline" onClick={() => setOpen(true)}>
        + Add a unit
      </button>
    );
  }
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call("/api/billing/agreement/units", { method: "POST", body: { listingId, ...v } });
      onAdded(r.unit);
      setV({ name: "", bedrooms: "1", bathrooms: "1" });
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-md bg-gray-50 p-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-600">
          Unit name
          <input className={`${FIELD} mt-0.5 block w-36`} value={v.name} maxLength={60} placeholder="1A" onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
        </label>
        <label className="text-xs text-gray-600">
          Beds
          <input className={`${FIELD} mt-0.5 block w-16`} inputMode="numeric" value={v.bedrooms} onChange={(e) => setV({ ...v, bedrooms: e.target.value })} />
        </label>
        <label className="text-xs text-gray-600">
          Baths
          <input className={`${FIELD} mt-0.5 block w-16`} inputMode="decimal" value={v.bathrooms} onChange={(e) => setV({ ...v, bathrooms: e.target.value })} />
        </label>
        <button type="button" className={BUTTON} disabled={busy || !v.name.trim()} onClick={add}>
          {busy ? "Adding..." : "Add"}
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="text-xs text-gray-500">It is added to the property without any leases, hidden from students until you add a lease to it.</p>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

// One property on the Exhibit A step: on it or off it (drafts only), the whole building or its units.
function PropertyChoice({ p, choice, onChange }) {
  const covered = p.covered;
  const coveredUnits = new Set(covered?.wholeBuilding ? [] : covered?.units ?? []);
  const leaseLocked = new Set(p.locked ? p.leaseUnits : []);
  const toggleUnit = (label, on) => {
    const set = new Set(choice.units);
    if (on) set.add(label);
    else set.delete(label);
    onChange({ ...choice, units: [...set] });
  };
  const status = p.locked ? (p.live ? "Live" : "Being published") : "Draft";
  return (
    <li className="space-y-2 rounded-md border border-gray-200 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-gray-900">{p.address}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.locked ? "bg-green-50 text-green-800" : "bg-gray-100 text-gray-600"}`}>{status}</span>
      </div>
      {!p.locked && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={choice.include} onChange={(e) => onChange({ ...choice, include: e.target.checked })} />
          Put this draft on Exhibit A
        </label>
      )}
      {!p.locked && !choice.include ? (
        <p className="text-xs text-gray-500">Left off. Publishing it later will need a short Exhibit A amendment.</p>
      ) : (
        <>
          {p.canWholeBuilding ? (
            <div className="flex flex-wrap gap-4 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                <input type="radio" name={`whole-${p.listingId}`} checked={choice.wholeBuilding} onChange={() => onChange({ ...choice, wholeBuilding: true })} />
                Whole building
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name={`whole-${p.listingId}`} checked={!choice.wholeBuilding} onChange={() => onChange({ ...choice, wholeBuilding: false })} />
                Specific units
              </label>
            </div>
          ) : (
            <p className="text-xs text-gray-500">You list units here but do not own the building, so name the units this agreement covers.</p>
          )}
          {choice.wholeBuilding ? (
            <p className="text-xs text-gray-500">Covers every unit in the building, including ones you add later.</p>
          ) : (
            <div className="space-y-2">
              {p.units.length ? (
                <ul className="space-y-1">
                  {p.units.map((u) => (
                    <UnitRow
                      key={u.id}
                      unit={u}
                      checked={coveredUnits.has(u.label) || leaseLocked.has(u.label) || choice.units.includes(u.label)}
                      disabled={coveredUnits.has(u.label) || leaseLocked.has(u.label)}
                      note={coveredUnits.has(u.label) ? "already covered" : leaseLocked.has(u.label) ? "has your leases" : null}
                      onToggle={(on) => toggleUnit(u.label, on)}
                      onRenamed={(from, to) => onChange({ ...choice, units: choice.units.map((x) => (x === from ? to : x)), renamed: [from, to] })}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-500">No units on this property yet. Add the ones this agreement covers.</p>
              )}
              <AddUnit listingId={p.listingId} onAdded={(unit) => onChange({ ...choice, units: [...choice.units, unit.label], added: unit })} />
            </div>
          )}
        </>
      )}
    </li>
  );
}

/*
 * Signing the commission agreement, or an Exhibit A amendment, all in one popup
 * (Payments tab and the publish dialog; Wyatt, 2026-11-07), with a progress bar:
 *
 *   1. Your details  name, title, company, email and address, pre-filled from the
 *                    account and the Stripe billing address, and "authorised to sign"
 *   2. Exhibit A     each property: on it (drafts can be left off), and the whole
 *                    building or which units; units can be added or renamed here.
 *                    Confirming starts building the document in the background.
 *   3. Real estate license  the license question; meanwhile the document is
 *                    built and opened in Documenso, so it is ready when they answer
 *
 * Then Documenso's signing page opens with everything filled but the signature
 * and initials. `listingIds` are the properties being published (publish dialog).
 * onFinished(result): "signed" | "pending" (signed, still saving) | "closed".
 */
export default function AgreementSigningFlow({ listingIds = [], intro = null, user = null, onFinished }) {
  const signer = useSignerDetails();
  const license = useLicenseDisclosure();
  const [step, setStep] = useState(0);
  const [authorized, setAuthorized] = useState(false);
  const [preview, setPreview] = useState(null);
  const [choices, setChoices] = useState({});
  const [phase, setPhase] = useState("form"); // form | opening | signing
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [preparing, setPreparing] = useState(false);
  // An Addendum to Exhibit A with the agreement's saved details: only the properties
  // are asked, then Documenso, where they only sign (Wyatt, 2026-11-07).
  const [addendum, setAddendum] = useState(false);
  const prepared = useRef(null);
  const closeRef = useRef(null);
  const ids = listingIds.join(",");

  // What this document is and which properties go on it, read up front.
  useEffect(() => {
    closeRef.current?.focus();
    let live = true;
    call(`/api/billing/agreement/exhibit?listingIds=${encodeURIComponent(ids)}`)
      .then((r) => {
        if (!live) return;
        if (r.kind === "none") return onFinished("signed");
        setPreview(r);
        setChoices(Object.fromEntries(r.properties.map((p) => [p.listingId, p.choice])));
        if (r.kind === "amendment" && r.signingAs) {
          setAddendum(true);
          setStep(1);
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "form") return undefined;
    const onKey = (e) => e.key === "Escape" && onFinished("closed");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onFinished]);

  const toExhibit = () => {
    setError(null);
    if (preview) setStep(1);
  };

  // An addendum opens straight from the properties step, with the saved details.
  const openAddendum = async () => {
    setPhase("opening");
    setError(null);
    try {
      const r = await call("/api/billing/agreement/sign", { method: "POST", body: { fromAgreement: true, listingIds, exhibit: exhibit() }, retries: 20 });
      if (r.alreadySigned) return onFinished("signed");
      setSession(r);
      setPhase("signing");
    } catch (err) {
      // An agreement signed before details were saved: ask for them after all.
      if (/Confirm your details/.test(err.message)) {
        setAddendum(false);
        setStep(0);
      } else setError(err.message);
      setPhase("form");
    }
  };

  const exhibit = () => Object.entries(choices).map(([listingId, c]) => ({ listingId, include: c.include, wholeBuilding: c.wholeBuilding, units: c.units }));
  const body = () => ({ ...signer.body(), authorized, listingIds, exhibit: exhibit() });

  // Units the landlord added or renamed show in the next preview; keep the list in step.
  const updateChoice = (p, next) => {
    if (next.added) {
      setPreview((pv) => ({ ...pv, properties: pv.properties.map((x) => (x.listingId === p.listingId ? { ...x, units: [...x.units, next.added] } : x)) }));
    }
    if (next.renamed) {
      const [from, to] = next.renamed;
      setPreview((pv) => ({
        ...pv,
        properties: pv.properties.map((x) => (x.listingId === p.listingId ? { ...x, units: x.units.map((u) => (u.label === from ? { ...u, label: to } : u)), leaseUnits: x.leaseUnits.map((u) => (u === from ? to : u)) } : x)),
      }));
    }
    const { added, renamed, ...clean } = next;
    setChoices((c) => ({ ...c, [p.listingId]: clean }));
  };

  // Every property on it has the whole building or at least one unit.
  const exhibitProblem = (() => {
    if (!preview) return null;
    for (const p of preview.properties) {
      const c = choices[p.listingId];
      if (!c?.include || c.wholeBuilding) continue;
      const covered = p.covered && !p.covered.wholeBuilding ? p.covered.units : [];
      if (!c.units.length && !covered.length && !(p.locked && p.leaseUnits.length)) return `Pick at least one unit for ${p.address}, or the whole building.`;
    }
    return null;
  })();

  // Confirming Exhibit A starts building the document while the license question shows.
  const confirmExhibit = () => {
    setStep(2);
    setPreparing(true);
    prepared.current = call("/api/billing/agreement/sign", { method: "POST", body: { ...body(), prepare: true }, retries: 20 })
      .catch(() => null) // the open call below makes the copy itself if this failed
      .finally(() => setPreparing(false));
  };

  const open = async (e) => {
    e.preventDefault();
    if (!license.ready) return;
    setPhase("opening");
    setError(null);
    try {
      const ready = await prepared.current;
      if (ready?.alreadySigned) return onFinished("signed");
      const r = await call("/api/billing/agreement/sign", { method: "POST", body: { ...body(), licenseDisclosure: license.payload() }, retries: 20 });
      if (r.alreadySigned) return onFinished("signed");
      setSession(r);
      setPhase("signing");
    } catch (err) {
      setError(err.message);
      setPhase("form");
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

  const isAmendment = preview?.kind === "amendment";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Sign the commission agreement">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
          <h2 className="flex-1 text-base font-semibold text-gray-900">{isAmendment ? "Add to your commission agreement" : "Sign the commission agreement"}</h2>
          <button ref={closeRef} type="button" disabled={phase === "opening"} onClick={() => onFinished("closed")} className={BUTTON}>
            Cancel
          </button>
        </div>
        {!addendum && <Progress step={step} />}

        {phase === "opening" ? (
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <Spinner label={preparing ? "Preparing your agreement..." : "Opening your agreement..."} />
            <p className="text-xs text-gray-500">This takes a few seconds.</p>
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm text-gray-700">
            {step === 0 && (
              <>
                {intro && <p>{intro}</p>}
                <p className="text-gray-500">We fill these into the agreement for you, so in the document you only sign and initial.</p>
                <SignerFields state={signer} />
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
                  <span>I am authorised to sign this agreement for the landlord or company that owns these listings.</span>
                </label>
                <div className="flex justify-end">
                  <button type="button" className={PRIMARY} disabled={!signer.ready || !authorized || !preview} onClick={toExhibit}>
                    Continue
                  </button>
                </div>
              </>
            )}

            {step === 1 && preview && (
              <>
                {addendum && preview.signingAs && (
                  <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    Signing as {preview.signingAs.name}
                    {preview.signingAs.title ? `, ${preview.signingAs.title}` : ""}
                    {preview.signingAs.company ? ` (${preview.signingAs.company})` : ""}, as on your agreement. Everything but your
                    signature is filled in for you.{" "}
                    <button type="button" className="font-medium text-red-700 underline" onClick={() => { setAddendum(false); setStep(0); }}>
                      Not you? Update details
                    </button>
                  </p>
                )}
                <p>
                  {isAmendment
                    ? "These properties are not fully on your agreement yet. Choose the whole building or the units to add for each; the addendum lists only what you add."
                    : "Exhibit A lists the properties this agreement covers. For each, choose the whole building or the units it covers."}
                </p>
                <ul className="space-y-3">
                  {preview.properties.map((p) => (
                    <PropertyChoice key={p.listingId} p={p} choice={choices[p.listingId] ?? p.choice} onChange={(next) => updateChoice(p, next)} />
                  ))}
                </ul>
                {exhibitProblem && <p className="text-xs text-red-700">{exhibitProblem}</p>}
                <div className="flex justify-between">
                  {addendum ? (
                    <span />
                  ) : (
                    <button type="button" className={BUTTON} onClick={() => setStep(0)}>
                      Back
                    </button>
                  )}
                  <button type="button" className={PRIMARY} disabled={!!exhibitProblem} onClick={addendum ? openAddendum : confirmExhibit}>
                    {addendum ? "Open the addendum" : "Continue"}
                  </button>
                </div>
              </>
            )}

            {step === 2 && (
              <form onSubmit={open} className="space-y-4">
                <p>Your answer is kept on your account. It is not printed on the agreement.</p>
                {license.loading ? <Spinner label="Loading..." /> : <LicenseDisclosureFields state={license} idPrefix="sign-license" />}
                <MissingHint state={license} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" className={BUTTON} onClick={() => setStep(1)}>
                    Back
                  </button>
                  <div className="flex items-center gap-3">
                    {preparing && <Spinner label="Preparing your agreement..." className="text-xs" />}
                    <button type="submit" disabled={!license.ready} className={PRIMARY}>
                      Open the agreement
                    </button>
                  </div>
                </div>
              </form>
            )}

            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
