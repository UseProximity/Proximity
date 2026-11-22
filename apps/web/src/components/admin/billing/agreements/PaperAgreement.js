"use client";

/*
 * A landlord's marketing agreement on paper (Wyatt, 2026-11-17), from their row
 * in Admin > Billing > Agreements:
 *
 *   PrintPaperForm   choose the properties (the landlord's own picker) and the
 *                    company, then print. The properties are held until the
 *                    signed copy is recorded or the paper copy is voided.
 *   RecordPaperForm  the signed copy is back: upload it, confirm the properties
 *                    on it (tick or untick to match the paper), type the email
 *                    and address they wrote on it, and tick which drafts go
 *                    live now.
 */
import { useEffect, useState } from "react";
import { fmtDate } from "@/components/admin/adminShared";
import PropertyChoice, { droppedUnits, hasListings } from "@/components/billing/ExhibitPropertyChoice";
import LicenseDisclosureFields, { disclosurePayload, disclosureReady } from "@/components/account/LicenseDisclosureFields";
import { BUTTON, FIELD, PRIMARY, call, openFile, postJson } from "./shared";

const NO_LICENSE = {
  isLicensee: null,
  agentName: "",
  companyName: "",
  companyPhone: "",
  licenseNumber: "",
  notLicensedConfirmed: false,
  ownerAgreementConfirmed: false,
};

// The license fields the landlord answers before signing in the app, as a form
// the admin fills from the paper (never the admin's own saved answer).
function useLicenseFromPaper() {
  const [draft, setDraft] = useState(NO_LICENSE);
  const noop = () => {};
  return {
    loading: false,
    saved: null,
    setSaved: noop,
    draft,
    setDraft,
    mode: "edit",
    setMode: noop,
    stillCorrect: false,
    setStillCorrect: noop,
    ready: disclosureReady(draft),
    payload: () => disclosurePayload(draft),
    reset: noop,
  };
}

const base = (landlordId) => `/api/admin/billing/landlords/${landlordId}/paper`;
export const paperFileUrl = (landlordId, id) => `${base(landlordId)}/${id}/file`;

const exhibitOf = (choices) =>
  Object.entries(choices).map(([listingId, c]) => ({ listingId, include: c.include, ...(c.include === false && { excluded: true }), wholeBuilding: c.wholeBuilding, units: c.units }));

// Every included property has the whole building or a unit.
function exhibitProblem(properties, choices) {
  for (const p of properties) {
    const c = choices[p.listingId];
    if (!c?.include || c.wholeBuilding) continue;
    if (!c.units.length) return `Pick at least one unit for ${p.address}, the whole building, or exclude it.`;
  }
  if (!properties.some((p) => choices[p.listingId]?.include)) return "Choose at least one property.";
  return null;
}

// Live listings that come off the site once the signed copy is recorded.
function liveLeftOff(properties, choices) {
  return properties.filter((p) => hasListings(p) && (choices[p.listingId]?.include === false || droppedUnits(p, choices[p.listingId]).length));
}

function Picker({ properties, choices, setChoices, badgeFor = null }) {
  return (
    <ul className="space-y-3">
      {properties.map((p) => (
        <PropertyChoice
          key={p.listingId}
          p={p}
          admin
          badge={badgeFor ? badgeFor(p) : null}
          choice={choices[p.listingId] ?? p.choice}
          onChange={(next) => {
            const { added, renamed, ...clean } = next;
            setChoices((c) => ({ ...c, [p.listingId]: clean }));
          }}
        />
      ))}
    </ul>
  );
}

function OffWarning({ list, when }) {
  if (!list.length) return null;
  return (
    <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="font-medium">Withdrawn from the site {when}:</p>
      <ul className="ml-4 list-disc">
        {list.map((p) => (
          <li key={p.listingId}>{p.address}</li>
        ))}
      </ul>
    </div>
  );
}

export function PrintPaperForm({ row, busy, run, onDone }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [choices, setChoices] = useState({});
  const [company, setCompany] = useState("");
  useEffect(() => {
    call(base(row.id))
      .then((d) => {
        setData(d);
        setCompany(d.company ?? "");
        setChoices(Object.fromEntries(d.properties.map((p) => [p.listingId, p.choice])));
      })
      .catch((e) => setError(e.message));
  }, [row.id]);

  if (error) {
    return (
      <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm">
        <p className="text-red-700">{error}</p>
        <button type="button" className={BUTTON} onClick={onDone}>
          Close
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-xs text-gray-400">Loading properties...</p>;
  const problem = exhibitProblem(data.properties, choices);
  const off = liveLeftOff(data.properties, choices);
  const print = () => {
    // The tab opens in the click, so the browser does not block it as a popup.
    const tab = window.open("", "_blank");
    return run(async () => {
      try {
        const r = await postJson(base(row.id), { exhibit: exhibitOf(choices), company });
        onDone();
        await openFile(paperFileUrl(row.id, r.id), tab);
      } catch (e) {
        tab?.close();
        throw e;
      }
      return "Printed. The properties on it are held until you record the signed copy or void it.";
    });
  };
  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
      <p className="font-medium text-gray-900">Print the agreement for {row.name || row.email} to sign on paper</p>
      {data.signer && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
          {data.signer.name} is this account&apos;s authorized signer, so this is {data.signer.name}&apos;s agreement covering these properties, as when they sign
          in the app. Invoices keep going to {data.signer.name}.
        </p>
      )}
      <p className="text-xs text-gray-600">
        {data.versionLabel}
        {data.negotiated ? " (their own version)" : ""}. Exhibit A and the company are filled in; everything else is left blank for them to
        fill in by hand. Until the signed copy is recorded, these properties&apos; drafts can&apos;t go live and the landlord can&apos;t sign in the
        app. Live listings stay live.
      </p>
      <label className="block text-xs font-medium text-gray-700">
        Company (optional)
        <input className={`${FIELD} mt-1`} value={company} maxLength={120} onChange={(e) => setCompany(e.target.value)} placeholder="Leave blank for them to write in" />
      </label>
      {data.properties.length ? (
        <Picker properties={data.properties} choices={choices} setChoices={setChoices} />
      ) : (
        <p className="text-xs text-gray-500">This landlord has no properties to put on Exhibit A.</p>
      )}
      <OffWarning list={off} when="once the signed copy is recorded" />
      {problem && <p className="text-xs text-red-700">{problem}</p>}
      <div className="flex gap-2">
        <button type="button" className={PRIMARY} disabled={busy || !!problem} onClick={print}>
          Print agreement
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export function RecordPaperForm({ row, busy, run, onDone }) {
  const id = row.agreement.paper.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [choices, setChoices] = useState({});
  const [publish, setPublish] = useState({});
  const [signer, setSigner] = useState({ name: "", title: "", date: today() });
  const license = useLicenseFromPaper();
  // What they wrote on the paper: a later addendum in the app prints these as they are.
  const [contact, setContact] = useState({ company: "", email: "", street: "", suite: "", city: "" });
  const [file, setFile] = useState(null);
  useEffect(() => {
    call(`${base(row.id)}/${id}`)
      .then((d) => {
        setData(d);
        setContact((c) => ({ ...c, company: d.company ?? "" }));
        setChoices(Object.fromEntries(d.properties.map((p) => [p.listingId, p.choice])));
        setPublish(Object.fromEntries(d.properties.filter((p) => p.onPrinted && p.publish?.ready).map((p) => [p.listingId, true])));
      })
      .catch((e) => setError(e.message));
  }, [row.id, id]);

  if (error) {
    return (
      <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm">
        <p className="text-red-700">{error}</p>
        <button type="button" className={BUTTON} onClick={onDone}>
          Close
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-xs text-gray-400">Loading the paper agreement...</p>;
  const problem = exhibitProblem(data.properties, choices) || (!signer.name.trim()
      ? "Who signed it?"
      : !contact.email.trim() || !contact.street.trim() || !contact.city.trim()
        ? "Enter the email and address written on the signed copy."
        : !license.ready
          ? "Answer the real estate license questions as they did on the signed copy."
          : !file
          ? "Upload the signed copy."
          : null);
  const off = liveLeftOff(data.properties, choices);
  const drafts = data.properties.filter((p) => p.publish && choices[p.listingId]?.include);
  const changed = data.properties.filter((p) => p.onPrinted !== !!choices[p.listingId]?.include);

  const submit = (e) => {
    e.preventDefault();
    const form = new FormData();
    form.set("file", file);
    form.set("exhibit", JSON.stringify(exhibitOf(choices)));
    form.set("publish", JSON.stringify(drafts.filter((p) => publish[p.listingId] && p.publish.ready).map((p) => p.listingId)));
    form.set("signerName", signer.name);
    form.set("signerTitle", signer.title);
    form.set("signedAt", signer.date);
    for (const [key, value] of Object.entries(contact)) form.set(key, value);
    form.set("license", JSON.stringify(license.payload()));
    return run(async () => {
      const r = await call(`${base(row.id)}/${id}`, { method: "POST", body: form });
      onDone();
      const live = r.published.filter((x) => x.ok).length;
      const failed = r.published.filter((x) => !x.ok);
      return [
        `Recorded. ${r.covered.length} ${r.covered.length === 1 ? "property is" : "properties are"} covered.`,
        live ? `${live} ${live === 1 ? "draft is" : "drafts are"} live.` : "",
        r.withdrawn.length ? `${r.withdrawn.length} left off ${r.withdrawn.length === 1 ? "was" : "were"} withdrawn.` : "",
        failed.length ? `Not published: ${failed.map((x) => x.error).join(" ")}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
      <p className="font-medium text-gray-900">Record the signed paper agreement for {row.name || row.email}</p>
      {data.signer?.name && <p className="text-xs text-gray-600">Signed by the authorized signer, {data.signer.name}, for this account.</p>}
      <p className="text-xs text-gray-600">
        Printed {fmtDate(data.printedAt)}
        {data.versionLabel ? ` · ${data.versionLabel}` : ""}. Make the list match the signed copy: untick anything they crossed off, tick
        anything they added. Ticked properties become covered.
      </p>
      <Picker properties={data.properties} choices={choices} setChoices={setChoices} badgeFor={(p) => (p.onPrinted ? "On the printed copy" : null)} />
      {changed.length > 0 && (
        <p className="text-xs text-gray-600">
          Changed from the printed copy: {changed.map((p) => `${p.address} (${choices[p.listingId]?.include ? "added" : "removed"})`).join("; ")}.
        </p>
      )}
      <OffWarning list={off} when="when you save" />

      {drafts.length > 0 && (
        <div className="space-y-1 rounded-md bg-white px-3 py-2">
          <p className="text-xs font-medium text-gray-900">Publish now?</p>
          {drafts.map((p) => (
            <label key={p.listingId} className="flex items-start gap-2 text-xs text-gray-700">
              <input type="checkbox" className="mt-0.5" disabled={!p.publish.ready} checked={!!publish[p.listingId] && p.publish.ready} onChange={(e) => setPublish((x) => ({ ...x, [p.listingId]: e.target.checked }))} />
              <span>
                {p.address}
                {p.publish.reason ? <span className="text-gray-500"> · {p.publish.reason}</span> : null}
              </span>
            </label>
          ))}
          <p className="text-xs text-gray-500">Unticked drafts stay drafts. The landlord can publish them any time once covered.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <label className="block min-w-[12rem] flex-1 text-xs font-medium text-gray-700">
          Signed by
          <input className={`${FIELD} mt-1`} value={signer.name} maxLength={100} onChange={(e) => setSigner({ ...signer, name: e.target.value })} required />
        </label>
        <label className="block min-w-[10rem] flex-1 text-xs font-medium text-gray-700">
          Title (optional)
          <input className={`${FIELD} mt-1`} value={signer.title} maxLength={100} onChange={(e) => setSigner({ ...signer, title: e.target.value })} />
        </label>
        <label className="block text-xs font-medium text-gray-700">
          Date signed
          <input className={`${FIELD} mt-1`} type="date" value={signer.date} max={today()} onChange={(e) => setSigner({ ...signer, date: e.target.value })} />
        </label>
      </div>
      <div className="space-y-2">
        <p className="text-xs text-gray-600">
          Copy these from the signed paper. The next time they add a property in the app, the addendum prints them without asking again.
        </p>
        <div className="flex flex-wrap gap-3">
          <label className="block min-w-[12rem] flex-1 text-xs font-medium text-gray-700">
            Company (optional)
            <input className={`${FIELD} mt-1`} value={contact.company} maxLength={120} onChange={(e) => setContact({ ...contact, company: e.target.value })} />
          </label>
          <label className="block min-w-[12rem] flex-1 text-xs font-medium text-gray-700">
            Email
            <input className={`${FIELD} mt-1`} type="email" value={contact.email} maxLength={254} onChange={(e) => setContact({ ...contact, email: e.target.value })} required />
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="block min-w-[12rem] flex-[2] text-xs font-medium text-gray-700">
            Street address
            <input className={`${FIELD} mt-1`} value={contact.street} maxLength={150} onChange={(e) => setContact({ ...contact, street: e.target.value })} placeholder="8151 Clayton Rd" required />
          </label>
          <label className="block min-w-[8rem] flex-1 text-xs font-medium text-gray-700">
            Suite or unit (optional)
            <input className={`${FIELD} mt-1`} value={contact.suite} maxLength={60} onChange={(e) => setContact({ ...contact, suite: e.target.value })} />
          </label>
          <label className="block min-w-[12rem] flex-[2] text-xs font-medium text-gray-700">
            City, state and ZIP
            <input className={`${FIELD} mt-1`} value={contact.city} maxLength={150} onChange={(e) => setContact({ ...contact, city: e.target.value })} placeholder="St. Louis, MO 63117" required />
          </label>
        </div>
      </div>
      <div className="space-y-2 rounded-md bg-white px-3 py-2">
        <p className="text-xs font-medium text-gray-900">Real estate license, as answered on the signed copy</p>
        <p className="text-xs text-gray-500">
          Saved for {data.signer?.name || row.name || "them"} as if they answered it in the app. A licensee&apos;s name, company and phone show on their
          listings as &quot;Listed by&quot;.
        </p>
        <LicenseDisclosureFields state={license} allowSummary={false} idPrefix={`paper-license-${id}`} />
      </div>
      <label className="block text-xs font-medium text-gray-700">
        Signed copy (PDF, up to 4 MB)
        <input className="mt-1 block w-full text-sm" type="file" accept="application/pdf" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {problem && <p className="text-xs text-red-700">{problem}</p>}
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={busy || !!problem}>
          Save signed copy
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
