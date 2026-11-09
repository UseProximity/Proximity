"use client";

import { useEffect, useState } from "react";

/*
 * The real estate license disclosure a landlord gives right before signing the
 * commission agreement (and edits on their Profile). Missouri requires a
 * licensee's name, company and company phone on every listing they market, so
 * those appear on their listings as "Listed by". Server rules:
 * lib/users/licenseDisclosure.js.
 *
 * useLicenseDisclosure() loads the saved answer and holds the draft;
 * <LicenseDisclosureFields> renders it. With a saved answer the signing step
 * shows it as a summary with a "still correct" box and an Edit link; without
 * one (or after Edit) it asks the question.
 */

const FIELD = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";

const EMPTY = {
  isLicensee: null,
  agentName: "",
  companyName: "",
  companyPhone: "",
  licenseNumber: "",
  notLicensedConfirmed: false,
  ownerAgreementConfirmed: false,
};

function fromSaved(saved) {
  if (!saved) return { ...EMPTY };
  return {
    isLicensee: saved.isLicensee,
    agentName: saved.agentName ?? "",
    companyName: saved.companyName ?? "",
    companyPhone: saved.companyPhone ?? "",
    licenseNumber: saved.licenseNumber ?? "",
    // The confirmations are given again each time: ticking them is the point.
    notLicensedConfirmed: false,
    ownerAgreementConfirmed: false,
  };
}

const phoneDigits = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};

/** Whether the draft is a complete answer the server will accept. */
export function disclosureReady(draft, { summary = false, stillCorrect = false } = {}) {
  if (summary) return stillCorrect;
  if (draft.isLicensee === false) return draft.notLicensedConfirmed;
  if (draft.isLicensee !== true) return false;
  return (
    !!draft.agentName.trim() &&
    !!draft.companyName.trim() &&
    phoneDigits(draft.companyPhone).length === 10 &&
    !!draft.licenseNumber.trim() &&
    draft.ownerAgreementConfirmed
  );
}

/** What still stops the answer from being saved, in words, for the line next to the button. */
export function disclosureMissing(draft, { summary = false, stillCorrect = false } = {}) {
  if (summary) return stillCorrect ? [] : ["tick that your details are still correct"];
  if (draft.isLicensee === false) return draft.notLicensedConfirmed ? [] : ["tick the confirmation box"];
  if (draft.isLicensee !== true) return ["answer whether a licensee lists these properties"];
  const out = [];
  if (!draft.agentName.trim()) out.push("the agent's name");
  if (!draft.companyName.trim()) out.push("the company");
  if (phoneDigits(draft.companyPhone).length !== 10) out.push("a 10 digit company phone");
  if (!draft.licenseNumber.trim()) out.push("the license number");
  if (!draft.ownerAgreementConfirmed) out.push("tick the listing agreement box");
  return out;
}

// "Still needed: the company and tick the listing agreement box."
export function MissingHint({ state, className = "" }) {
  if (state.loading || state.ready) return null;
  const missing = disclosureMissing(state.draft, { summary: state.mode === "summary", stillCorrect: state.stillCorrect });
  if (!missing.length) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return <p className={`text-xs text-gray-500 ${className}`}>Still needed: {list}.</p>;
}

/** The request body for the draft (or, from the summary, the saved answer re-confirmed). */
export function disclosurePayload(draft) {
  if (draft.isLicensee === false) return { isLicensee: false, notLicensedConfirmed: true };
  return {
    isLicensee: true,
    agentName: draft.agentName,
    companyName: draft.companyName,
    companyPhone: draft.companyPhone,
    licenseNumber: draft.licenseNumber,
    ownerAgreementConfirmed: true,
  };
}

/**
 * Loads the landlord's saved answer. Returns the draft and everything the
 * fields need. `mode` is "summary" when there is a saved answer to confirm,
 * otherwise "edit".
 */
export function useLicenseDisclosure() {
  const [saved, setSaved] = useState(undefined);
  const [draft, setDraft] = useState(EMPTY);
  const [mode, setMode] = useState("edit");
  const [stillCorrect, setStillCorrect] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/landlord/license-disclosure")
      .then((r) => (r.ok ? r.json() : { disclosure: null }))
      .catch(() => ({ disclosure: null }))
      .then((d) => {
        if (!live) return;
        setSaved(d.disclosure ?? null);
        setDraft(fromSaved(d.disclosure));
        setMode(d.disclosure ? "summary" : "edit");
      });
    return () => {
      live = false;
    };
  }, []);

  const summary = mode === "summary";
  return {
    loading: saved === undefined,
    saved,
    setSaved,
    draft,
    setDraft,
    mode,
    setMode,
    stillCorrect,
    setStillCorrect,
    ready: saved !== undefined && disclosureReady(draft, { summary, stillCorrect }),
    // From the summary the saved answer is sent again, confirmed.
    payload: () => disclosurePayload(summary ? { ...fromSaved(saved), notLicensedConfirmed: true, ownerAgreementConfirmed: true } : draft),
    // Start editing from `next` (the Profile card's Edit): the full form, judged on
    // what is typed. Leaving the "still correct" summary mode matters: in it, Save
    // waited for a box the full form does not show (fixed 2026-11-06).
    reset: (next) => {
      setSaved(next);
      setDraft(fromSaved(next));
      setStillCorrect(false);
      setMode("edit");
    },
  };
}

/** One line describing a saved answer. */
export function DisclosureSummary({ disclosure, showLicense = true }) {
  if (!disclosure) return null;
  if (!disclosure.isLicensee) {
    return <p className="text-sm text-gray-800">Not a licensed real estate agent or broker.</p>;
  }
  return (
    <div className="text-sm text-gray-800">
      <p>
        <span className="font-medium">{disclosure.agentName}</span>, {disclosure.companyName}, {disclosure.companyPhone}
      </p>
      {showLicense && disclosure.licenseNumber && (
        <p className="text-xs text-gray-500">Missouri license {disclosure.licenseNumber} (kept private)</p>
      )}
    </div>
  );
}

/**
 * The fields. `state` is the object useLicenseDisclosure() returns. `allowSummary`
 * false always shows the editable form (the Profile's edit mode).
 */
export default function LicenseDisclosureFields({ state, allowSummary = true, idPrefix = "license" }) {
  const { loading, saved, draft, setDraft, mode, setMode, stillCorrect, setStillCorrect } = state;
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  if (loading) return <p className="text-sm text-gray-400">Loading your license details...</p>;

  if (allowSummary && mode === "summary" && saved) {
    return (
      <fieldset className="space-y-2 rounded-md border border-gray-200 px-3 py-3">
        <legend className="px-1 text-sm font-medium text-gray-900">Real estate license</legend>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <DisclosureSummary disclosure={saved} />
          </div>
          <button
            type="button"
            className="text-sm font-medium text-gray-700 underline"
            onClick={() => {
              setStillCorrect(false);
              setMode("edit");
            }}
          >
            Edit
          </button>
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" className="mt-1" checked={stillCorrect} onChange={(e) => setStillCorrect(e.target.checked)} />
          <span>
            This is still correct.
            {saved.isLicensee ? " I have a written listing agreement with the owner of each property I list on Proximity." : ""}
          </span>
        </label>
      </fieldset>
    );
  }

  return (
    <fieldset className="space-y-3 rounded-md border border-gray-200 px-3 py-3">
      <legend className="px-1 text-sm font-medium text-gray-900">Real estate license</legend>
      <p className="text-sm text-gray-700">
        Are you, or is the person or company listing these properties, a licensed real estate agent or broker in Missouri?
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Licensed real estate agent or broker">
        {[
          { value: false, label: "No, not licensed" },
          { value: true, label: "Yes, a licensee lists them" },
        ].map((o) => (
          <label
            key={String(o.value)}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              draft.isLicensee === o.value ? "border-red-500 bg-red-50 text-red-800" : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name={`${idPrefix}-is-licensee`}
              className="sr-only"
              checked={draft.isLicensee === o.value}
              onChange={() => set({ isLicensee: o.value })}
            />
            {o.label}
          </label>
        ))}
      </div>

      {draft.isLicensee === false && (
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="mt-1"
            checked={draft.notLicensedConfirmed}
            onChange={(e) => set({ notLicensedConfirmed: e.target.checked })}
          />
          <span>I confirm I am not a licensed real estate agent or broker, and no licensee is listing these properties for me.</span>
        </label>
      )}

      {draft.isLicensee === true && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Missouri requires the licensed agent&apos;s name, company and company phone on every listing. We show these three on
            your listings. The license number stays private.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              Licensed agent&apos;s name
              <input className={`${FIELD} mt-1`} value={draft.agentName} maxLength={120} autoComplete="name" onChange={(e) => set({ agentName: e.target.value })} />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Company (brokerage)
              <input className={`${FIELD} mt-1`} value={draft.companyName} maxLength={160} autoComplete="organization" onChange={(e) => set({ companyName: e.target.value })} />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Company phone
              <input
                className={`${FIELD} mt-1`}
                value={draft.companyPhone}
                maxLength={20}
                inputMode="tel"
                autoComplete="tel"
                placeholder="(314) 555-0123"
                onChange={(e) => set({ companyPhone: e.target.value })}
              />
              {draft.companyPhone && phoneDigits(draft.companyPhone).length !== 10 && (
                <span className="mt-1 block text-xs font-normal text-red-700">Enter a 10 digit US number.</span>
              )}
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Missouri license number
              <input className={`${FIELD} mt-1`} value={draft.licenseNumber} maxLength={40} onChange={(e) => set({ licenseNumber: e.target.value })} />
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={draft.ownerAgreementConfirmed}
              onChange={(e) => set({ ownerAgreementConfirmed: e.target.checked })}
            />
            <span>I have a written listing agreement with the owner of each property I list on Proximity.</span>
          </label>
        </div>
      )}
    </fieldset>
  );
}
