"use client";

import { useEffect, useState } from "react";
import { Badge, fmtDate } from "@/components/admin/adminShared";
import { BUTTON, FIELD, PRIMARY, call, openFile, postJson } from "./shared";

const STATUS = {
  draft: ["gray", "Draft"],
  ready: ["blue", "Ready to go live"],
  live: ["green", "Live"],
  retired: ["gray", "Retired"],
};

function Step({ done, n, children }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          done ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

// A version that is not live yet: the steps from upload to live, with the action for each.
function DraftSteps({ version, busy, run, documensoConnected }) {
  const [requiresResign, setRequiresResign] = useState(null);
  const [summary, setSummary] = useState(null);
  const act = (body, success) => run(() => postJson(`/api/admin/billing/agreement-versions/${version.id}`, body), success);

  const check = () =>
    run(async () => {
      const r = await postJson(`/api/admin/billing/agreement-versions/${version.id}`, { action: "check" });
      setSummary(r.summary);
    });

  // Show which boxes the uploaded document has straight away (its placeholders
  // became boxes on upload), without waiting for "Check signature boxes".
  useEffect(() => {
    if (!version.connected) return;
    let live = true;
    postJson(`/api/admin/billing/agreement-versions/${version.id}`, { action: "check" })
      .then((r) => live && setSummary(r.summary))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [version.id, version.connected]);

  // Only the standard agreement asks the re-sign question: an amendment never makes
  // anyone sign again, and a negotiated version is signed by its one landlord.
  const asksResign = version.kind === "master" && !version.landlordId;
  const publish = () => {
    if (asksResign && requiresResign === null) return;
    const text = !asksResign
      ? `Make "${version.label}" live${version.landlordName ? ` for ${version.landlordName}` : ""}?`
      : requiresResign
        ? `Make "${version.label}" live and require every landlord who signed an earlier version to sign this one?\n\nUntil they do, they cannot publish new properties while the agreement requirement is on. Their covered properties carry over to the new Exhibit A.`
        : `Make "${version.label}" live? Earlier signatures stay valid; only landlords who have not signed will sign this version.`;
    if (!window.confirm(text)) return;
    return act({ action: "publish", ...(asksResign && { requiresResign }) }, `"${version.label}" is now live.`);
  };

  return (
    <ol className="mt-3 space-y-3">
      <Step n={1} done={version.connected}>
        <p className="text-gray-900">Uploaded{version.connected ? " and sent to Documenso" : ""}</p>
        {!version.connected && (
          <div className="mt-1 space-y-1">
            {version.providerError && <p className="text-xs text-red-700">{version.providerError}</p>}
            {!documensoConnected && !version.providerError && (
              <p className="text-xs text-gray-500">Documenso is not connected in this environment yet.</p>
            )}
            <button type="button" disabled={busy} className={BUTTON} onClick={() => act({ action: "connect" }, "Sent to Documenso.")}>
              Connect to Documenso
            </button>
          </div>
        )}
      </Step>
      <Step n={2} done={version.status === "ready"}>
        <p className="text-gray-900">Place the signature boxes in Documenso</p>
        <FieldGuide kind={version.kind} />
        {version.connected && version.editorUrl && (
          <a href={version.editorUrl} target="_blank" rel="noopener noreferrer" className={`${BUTTON} mt-1 inline-block`}>
            Open in Documenso
          </a>
        )}
      </Step>
      <Step n={3} done={version.status === "ready"}>
        <p className="text-gray-900">Check the boxes</p>
        <button type="button" disabled={busy || !version.connected} className={`${BUTTON} mt-1`} onClick={check}>
          Check signature boxes
        </button>
        {summary && (
          <div className="mt-1 space-y-1 text-xs">
            <p className={summary.ok ? "text-green-700" : "text-red-700"}>
              {summary.ok
                ? "Ready: it has a signature and an Exhibit A box."
                : `Still needed: ${(summary.missing ?? ["[SIGNATURE]"]).join(" and ")}. Add the placeholder and upload again, or place the box in Documenso and check again.`}
            </p>
            {summary.boxes?.length > 0 && (
              <div>
                <p className="text-gray-500">Boxes found on this document:</p>
                <ul className="mt-0.5 flex flex-wrap gap-1">
                  {summary.boxes.map((b, i) => (
                    <li key={i} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700">
                      {b.label ? `[${b.label}]` : `[${b.type}]`}
                      <span className="ml-1 font-sans text-gray-400">{b.type === "TEXT" ? "text" : b.type.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Step>
      <Step n={4} done={false}>
        <p className="text-gray-900">Make it live</p>
        {asksResign && (
          <fieldset className="mt-1 space-y-1 text-sm text-gray-700" disabled={busy || version.status !== "ready"}>
            <label className="flex items-center gap-2">
              <input type="radio" name={`resign-${version.id}`} checked={requiresResign === false} onChange={() => setRequiresResign(false)} />
              Earlier signatures stay valid
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name={`resign-${version.id}`} checked={requiresResign === true} onChange={() => setRequiresResign(true)} />
              Everyone must sign this version again
            </label>
          </fieldset>
        )}
        <button
          type="button"
          disabled={busy || version.status !== "ready" || (asksResign && requiresResign === null)}
          className={`${PRIMARY} mt-2`}
          onClick={publish}
        >
          Make live
        </button>
      </Step>
    </ol>
  );
}

/*
 * Which boxes to place on a template in Documenso, and the label each needs
 * (Wyatt, 2026-11-06). Text boxes are filled by the word in their label
 * (BOX_RULES in lib/billing/documenso.js); Documenso's own box types are used by
 * type. Shown in each version's setup and above the upload form.
 */
// The placeholders, exactly as typed in the document (Wyatt, 2026-11-07). Upper or
// lower case both work. `box` is the Documenso box it becomes and `label` the
// label to give that box when placing it by hand instead.
const AGREEMENT_ROWS = [
  { ph: "[DATE]", box: "Date", label: "(none)", fills: "The signing date, like 11/07/2026. Pad it with spaces inside the brackets if it sits mid-sentence.", need: "Optional" },
  { ph: "[COMPANY NAME]", box: "Text", label: "COMPANY NAME", fills: "Their company, from the signing form (blank if none).", need: "Optional" },
  { ph: "[SIGNATURE]", box: "Signature", label: "(none)", fills: "The landlord signs here.", need: "Required" },
  { ph: "[REPRESENTATIVE NAME]", box: "Text", label: "REPRESENTATIVE NAME", fills: "Their full name.", need: "Optional" },
  { ph: "[REPRESENTATIVE TITLE]", box: "Text", label: "REPRESENTATIVE TITLE", fills: "Their title.", need: "Optional" },
  { ph: "[ADDRESS 1]", box: "Text", label: "ADDRESS 1", fills: "Street and suite, e.g. 8151 Clayton Rd, Suite 301. Use it once.", need: "Optional" },
  { ph: "[ADDRESS 2]", box: "Text", label: "ADDRESS 2", fills: "City, state and ZIP, e.g. St. Louis, MO 63117 (the line below Address 1).", need: "Optional" },
  { ph: "[EMAIL]", box: "Text", label: "EMAIL", fills: "Their email.", need: "Optional" },
  { ph: "[EXHIBIT A]", box: "Text", label: "EXHIBIT A", fills: "Every property: address, then Whole building or Units. Put it where the list starts; the box runs down to the next text below.", need: "Required" },
  { ph: "[INITIALS]", box: "Initials", label: "(none)", fills: "The landlord initials here.", need: "Optional" },
];
const ADDENDUM_ROWS = [
  { ph: "[AGREEMENT DATE]", box: "Text", label: "AGREEMENT DATE", fills: "The date the original agreement was signed (its Effective Date).", need: "Optional" },
  ...AGREEMENT_ROWS.filter((r) => !["[EXHIBIT A]"].includes(r.ph)).map((r) =>
    r.ph === "[DATE]" ? { ...r, fills: "The date the addendum is signed." } : r.box === "Text" ? { ...r, fills: `${r.fills.replace(/, from the signing form/, "")} Taken from the original agreement.` } : r
  ),
  { ph: "[EXHIBIT A]", box: "Text", label: "EXHIBIT A", fills: "Only the properties (or units) this addendum adds. Put it where the list goes; the box runs down to the next text below.", need: "Required" },
];

export function FieldGuide({ kind = "master" }) {
  const rows = kind === "amendment" ? ADDENDUM_ROWS : AGREEMENT_ROWS;
  return (
    <div className="space-y-2 text-xs text-gray-600">
      <p>
        Type each placeholder below, brackets included, exactly where its value goes in the{" "}
        {kind === "amendment" ? "Addendum to Exhibit A" : "agreement"}, export it to PDF and upload it. We paint each one out
        and put the box from the second column in its place, already set up. Placing a box by hand instead (a scanned PDF,
        say): use that box type and give it the label in the third column, in the box&apos;s settings.
      </p>
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-2 py-1 font-medium">Type in the document</th>
              <th className="px-2 py-1 font-medium">Becomes this box</th>
              <th className="px-2 py-1 font-medium">Label (placing by hand)</th>
              <th className="px-2 py-1 font-medium">Filled with</th>
              <th className="px-2 py-1 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.ph}>
                <td className="px-2 py-1 font-mono text-gray-900">{r.ph}</td>
                <td className="px-2 py-1 text-gray-700">{r.box}</td>
                <td className="px-2 py-1 font-mono text-gray-700">{r.label}</td>
                <td className="px-2 py-1">{r.fills}</td>
                <td className={`px-2 py-1 ${r.need === "Required" ? "font-semibold text-red-700" : "text-gray-400"}`}>{r.need}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>A placeholder can repeat (the same box shows in each place).</li>
        <li>Any other text in [brackets], like a drafting note, is left as typed.</li>
        <li>Remove highlighting before exporting: the placeholder is painted white, a highlight around it would show.</li>
        <li>Everything is filled from the landlord&apos;s signing form; in the document they only sign (and initial).</li>
        <li>It cannot go live without [SIGNATURE] and [EXHIBIT A]. After upload, check the list of boxes found below.</li>
      </ul>
    </div>
  );
}

const KIND_LABEL = { master: "Agreement", amendment: "Exhibit A amendment" };

const landlords = (n) => `${n} ${n === 1 ? "landlord" : "landlords"}`;

// The version landlords sign now: the one sent to anyone who signs from today.
function LiveRow({ v, kindLabel, busy, run }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-green-300 bg-green-50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">
          {kindLabel}: {v.label}
          {v.landlordName ? <span className="text-xs font-normal text-gray-500"> (only for {v.landlordName})</span> : null}
        </p>
        <p className="text-xs text-gray-600">
          {v.landlordName ? `Sent to ${v.landlordName} when they sign` : "Sent to every landlord who signs from now on"} ·
          current since {fmtDate(v.publishedAt)} · {landlords(v.signedCount)} signed it
          {v.requiresResign ? " · everyone had to re-sign" : ""}
        </p>
      </div>
      <Badge color="green">Current</Badge>
      <button type="button" disabled={busy} className={BUTTON} onClick={() => run(() => openFile(`/api/admin/billing/agreement-versions/${v.id}`))}>
        View PDF
      </button>
    </div>
  );
}

/*
 * The agreement documents: the standard agreement and the standard Exhibit A
 * amendment, each with its own live version, plus versions negotiated with one
 * landlord. Upload a PDF as a new version, take it through Documenso, make it live.
 */
export default function AgreementVersions({ versions, documensoConnected, busy, run }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("master");
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const liveStandard = (k) => versions.find((v) => v.status === "live" && v.kind === k && !v.landlordId);
  const live = liveStandard("master");
  const liveAmendment = liveStandard("amendment");
  const negotiatedLive = versions.filter((v) => v.status === "live" && v.landlordId);
  const drafts = versions.filter((v) => v.status === "draft" || v.status === "ready");
  const retired = versions.filter((v) => v.status === "retired");
  const inForce = retired.filter((v) => v.stillInForce);
  const pastOnly = retired.filter((v) => !v.stillInForce);

  const upload = (e) => {
    e.preventDefault();
    const form = new FormData();
    form.set("label", label);
    form.set("kind", kind);
    if (file) form.set("file", file);
    return run(async () => {
      await call("/api/admin/billing/agreement-versions", { method: "POST", body: form });
      setLabel("");
      setFile(null);
      setFileInputKey((k) => k + 1);
    }, "Uploaded. Follow the steps below to make it live.");
  };

  const discard = (v) => {
    if (!window.confirm(`Discard "${v.label}"? Delete its template in Documenso too if it was sent there.`)) return;
    return run(() => postJson(`/api/admin/billing/agreement-versions/${v.id}`, { action: "discard" }), "Discarded.");
  };

  return (
    <section className="rounded-lg border border-gray-100 bg-white p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Commission agreement</h3>
        {!documensoConnected && (
          <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
            Documenso is not connected in this environment (DOCUMENSO_API_KEY is not set). You can upload a version
            now and send it to Documenso once it is.
          </p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900">Current versions</h3>
        <p className="text-xs text-gray-500">What a landlord gets when they sign today. Only one of each is current.</p>
      </div>
      {live ? (
        <LiveRow v={live} kindLabel="Agreement" busy={busy} run={run} />
      ) : (
        <p className="text-sm text-gray-500">No agreement version is live yet, so landlords cannot sign in the app.</p>
      )}
      {liveAmendment ? (
        <LiveRow v={liveAmendment} kindLabel="Exhibit A amendment" busy={busy} run={run} />
      ) : (
        <p className="text-sm text-gray-500">
          No amendment version is live yet. Landlords who already signed cannot add new properties until one is.
        </p>
      )}
      {negotiatedLive.map((v) => (
        <LiveRow key={v.id} v={v} kindLabel={`Negotiated ${KIND_LABEL[v.kind].toLowerCase()}`} busy={busy} run={run} />
      ))}

      {inForce.length > 0 && (
        <div className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Older versions still in force</h3>
            <p className="text-xs text-gray-500">
              Not sent to anyone new. Landlords who signed one stay on it until its term ends, you void their agreement, or a
              new version requires everyone to sign again.
            </p>
          </div>
          {inForce.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900">
                  {KIND_LABEL[v.kind] ?? "Agreement"}: {v.label}
                  {v.landlordName ? <span className="text-xs text-gray-500"> (only for {v.landlordName})</span> : null}
                </p>
                <p className="text-xs text-gray-600">
                  Became current {fmtDate(v.publishedAt)} · {landlords(v.signedCount)} still signed on it
                </p>
              </div>
              <Badge color="amber">Still in force</Badge>
              <button type="button" disabled={busy} className={BUTTON} onClick={() => run(() => openFile(`/api/admin/billing/agreement-versions/${v.id}`))}>
                View PDF
              </button>
            </div>
          ))}
        </div>
      )}

      {drafts.map((v) => {
        const [color, text] = STATUS[v.status];
        return (
          <div key={v.id} className="rounded-lg border border-gray-100 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium text-gray-900">
                {KIND_LABEL[v.kind] ?? "Agreement"}: {v.label}
                {v.landlordName ? <span className="text-xs font-normal text-gray-500"> (only for {v.landlordName})</span> : null}{" "}
                <span className="text-xs font-normal text-gray-400">
                  uploaded {fmtDate(v.createdAt)}
                </span>
              </p>
              <Badge color={color}>{text}</Badge>
              <button type="button" disabled={busy} className={BUTTON} onClick={() => run(() => openFile(`/api/admin/billing/agreement-versions/${v.id}`))}>
                View PDF
              </button>
              <button type="button" disabled={busy} className={`${BUTTON} text-red-700`} onClick={() => discard(v)}>
                Discard
              </button>
            </div>
            <DraftSteps version={v} busy={busy} run={run} documensoConnected={documensoConnected} />
          </div>
        );
      })}

      <form onSubmit={upload} className="space-y-2 border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-900">Upload a new version</p>
        <p className="text-xs text-gray-500">
          A version for one landlord (a negotiated change) is uploaded from their change request, under Change requests.
        </p>
        <details className="rounded-md border border-gray-200 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-gray-700">Boxes to place in Documenso, and their labels</summary>
          <div className="mt-2">
            <FieldGuide kind={kind} />
          </div>
        </details>
        <div className="flex flex-wrap gap-3">
          <label className="block w-48 text-sm text-gray-700">
            Document
            <select className={`${FIELD} mt-1`} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="master">Commission agreement</option>
              <option value="amendment">Exhibit A amendment</option>
            </select>
          </label>
          <label className="block flex-1 min-w-[12rem] text-sm text-gray-700">
            Name
            <input className={`${FIELD} mt-1`} value={label} maxLength={80} placeholder="December 2026" onChange={(e) => setLabel(e.target.value)} required />
          </label>
          <label className="block flex-1 min-w-[12rem] text-sm text-gray-700">
            PDF (up to 4 MB)
            <input
              key={fileInputKey}
              className="mt-2 block w-full text-sm"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </label>
        </div>
        <button type="submit" disabled={busy || !file} className={PRIMARY}>
          {busy ? "Working..." : "Upload"}
        </button>
      </form>

      {pastOnly.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600">Retired versions, no one on them ({pastOnly.length})</summary>
          <ul className="mt-2 space-y-1">
            {pastOnly.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="flex-1">
                  {KIND_LABEL[v.kind] ?? "Agreement"}: {v.label}
                  {v.landlordName ? ` (for ${v.landlordName})` : ""} · became current {fmtDate(v.publishedAt)}
                </span>
                <button type="button" disabled={busy} className={BUTTON} onClick={() => run(() => openFile(`/api/admin/billing/agreement-versions/${v.id}`))}>
                  View PDF
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
