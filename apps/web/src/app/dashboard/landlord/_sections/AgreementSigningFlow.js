"use client";

import { useEffect, useRef, useState } from "react";
import SignAgreementDialog from "./SignAgreementDialog";
import Spinner from "./Spinner";
import SignerFields, { useSignerDetails } from "./SignerFields";
import LicenseDisclosureFields, { MissingHint, useLicenseDisclosure } from "@/components/account/LicenseDisclosureFields";
import PropertyChoice, { droppedUnits, hasListings, listWords } from "@/components/billing/ExhibitPropertyChoice";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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

const STEPS = ["Your details", "Properties covered", "Real estate license"];

// Three bars, no labels (Wyatt, 2026-11-07); the step names are for screen readers.
function Progress({ step }) {
  return (
    <ol className="grid grid-cols-3 gap-2 px-5 pt-4" aria-label="Signing steps">
      {STEPS.map((label, i) => (
        <li key={label} className="min-w-0" aria-current={i === step ? "step" : undefined}>
          <div className={`h-1.5 rounded-full ${i <= step ? "bg-red-600" : "bg-gray-200"}`} />
          <span className="sr-only">
            Step {i + 1} of {STEPS.length}: {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/*
 * Signing the marketing agreement, or an Exhibit A amendment, all in one popup
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
 * onFinished(result): "signed" | "pending" (signed, still saving) | "closed" |
 * "nothing" (nothing needs signing: never reported as signed).
 */
// `accountId`: a payer signing for a landlord account they pay for (Project B); left out, their own.
// `takeover`: a landlord with an authorized signer signing their own agreement
// instead; the signer is removed once it is signed (Wyatt, 2026-11-10).
export default function AgreementSigningFlow({ listingIds = [], requiredUnits = null, intro = null, user = null, accountId = null, accountIds = null, includeDrafts = false, takeover = false, onFinished }) {
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
  // Live properties left off: confirmed before they come off the site.
  const [confirmingOff, setConfirmingOff] = useState(false);
  // Signing for another landlord's account (an authorized signer): the wording says "the landlord's".
  const forAccount = !!(accountId || accountIds?.length);
  const prepared = useRef(null);
  const closeRef = useRef(null);
  const ids = listingIds.join(",");

  // What this document is and which properties go on it, read up front.
  useEffect(() => {
    closeRef.current?.focus();
    let live = true;
    const units = requiredUnits && Object.keys(requiredUnits).length ? `&units=${encodeURIComponent(JSON.stringify(requiredUnits))}` : "";
    call(`/api/billing/agreement/exhibit?listingIds=${encodeURIComponent(ids)}${units}${accountId ? `&accountId=${accountId}` : ""}${accountIds?.length ? `&accountIds=${accountIds.join(",")}` : ""}${includeDrafts ? "&includeDrafts=1" : ""}${takeover ? "&takeover=1" : ""}`)
      .then((r) => {
        if (!live) return;
        if (r.kind === "none") return onFinished("nothing");
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
      const r = await call("/api/billing/agreement/sign", { method: "POST", body: { fromAgreement: true, listingIds, requiredUnits, exhibit: exhibit(), ...(accountId && { accountId }), ...(accountIds?.length && { accountIds }), ...(includeDrafts && { includeDrafts }), ...(takeover && { takeover: true }) }, retries: 20 });
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

  const exhibit = () =>
    Object.entries(choices).map(([listingId, c]) => ({ listingId, include: c.include, ...(c.include === false && { excluded: true }), wholeBuilding: c.wholeBuilding, units: c.units }));
  // Properties with the landlord's listings left off, and units with their listings
  // left uncovered: those listings come off the site once the document is signed.
  const liveExcluded = (preview?.properties ?? []).filter((p) => hasListings(p) && p.canExclude && choices[p.listingId]?.include === false);
  const unitsOff = (preview?.properties ?? [])
    .map((p) => ({ p, units: droppedUnits(p, choices[p.listingId] ?? p.choice) }))
    .filter((x) => x.units.length);
  const offCount = liveExcluded.length + unitsOff.length;

  // Continue from Exhibit A: a live property left off is confirmed first. It comes
  // off the site only when the document is signed, so closing the popup changes nothing.
  const continueExhibit = ({ confirmed = false } = {}) => {
    if (offCount && !confirmed) return setConfirmingOff(true);
    setConfirmingOff(false);
    setError(null);
    return addendum ? openAddendum() : confirmExhibit();
  };
  const body = () => ({ ...signer.body(), authorized, listingIds, requiredUnits, exhibit: exhibit(), ...(accountId && { accountId }), ...(accountIds?.length && { accountIds }), ...(includeDrafts && { includeDrafts }), ...(takeover && { takeover: true }) });

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
      if (!c.units.length && !covered.length) return `Pick at least one unit for ${p.address}, the whole building, or exclude it.`;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Sign the marketing agreement">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
          <h2 className="flex-1 text-base font-semibold text-gray-900">{isAmendment ? "Add to your marketing agreement" : "Sign the marketing agreement"}</h2>
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
                    ? "These properties are not fully covered by your marketing agreement yet. For each, choose whether it covers the whole building or only certain units. A short addendum adds them to your agreement."
                    : "Choose the properties this marketing agreement covers. For each, choose whether it covers the whole building or only certain units. These are listed in the agreement (as Exhibit A)."}
                </p>
                <ul className="space-y-3">
                  {preview.properties.map((p) => (
                    <PropertyChoice key={p.listingId} p={p} choice={choices[p.listingId] ?? p.choice} onChange={(next) => updateChoice(p, next)} />
                  ))}
                </ul>
                {exhibitProblem && <p className="text-xs text-red-700">{exhibitProblem}</p>}
                {confirmingOff ? (
                  <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-amber-900">
                    <p className="font-medium">Withdraw these listings from the site?</p>
                    <ul className="list-disc pl-5 text-xs">
                      {liveExcluded.map((p) => (
                        <li key={p.listingId}>{p.address}: {forAccount ? "every listing the landlord has there" : "every listing of yours there"}</li>
                      ))}
                      {unitsOff.map(({ p, units }) => (
                        <li key={`units-${p.listingId}`}>
                          {p.address}: {listWords(units)}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs">
                      They are withdrawn when you sign, so students will no longer see them. Until then nothing changes.{" "}
                      {forAccount
                        ? "We email the landlord which ones you left off. They can be added later with a short addendum."
                        : "You can publish them again later by adding them to your agreement with a short addendum."}
                    </p>
                    <div className="flex justify-end gap-2">
                      <button type="button" className={BUTTON} onClick={() => setConfirmingOff(false)}>
                        Go back
                      </button>
                      <button type="button" className={PRIMARY} onClick={() => continueExhibit({ confirmed: true })}>
                        Leave off and continue
                      </button>
                    </div>
                  </div>
                ) : (
                <div className="flex justify-between">
                  {addendum ? (
                    <span />
                  ) : (
                    <button type="button" className={BUTTON} onClick={() => setStep(0)}>
                      Back
                    </button>
                  )}
                  <button type="button" className={PRIMARY} disabled={!!exhibitProblem} onClick={() => continueExhibit()}>
                    {addendum ? "Open the addendum" : "Continue"}
                  </button>
                </div>
                )}
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
