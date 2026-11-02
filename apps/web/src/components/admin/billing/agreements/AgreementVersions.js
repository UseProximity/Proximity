"use client";

import { useState } from "react";
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

  const publish = () => {
    if (requiresResign === null) return;
    const text = requiresResign
      ? `Make "${version.label}" live and require every landlord who signed an earlier version to sign this one?\n\nUntil they do, they cannot publish new listings while the agreement requirement is on.`
      : `Make "${version.label}" live? Earlier signatures stay valid; only landlords who have not signed will sign this version.`;
    if (!window.confirm(text)) return;
    return act({ action: "publish", requiresResign }, `"${version.label}" is now live.`);
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
        <p className="text-xs text-gray-500">
          Add a Signature box for the signer (required). Name and Date boxes are recommended. A Text box labelled
          &quot;Title&quot; is filled in with the title the landlord gives us.
        </p>
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
          <p className={`mt-1 text-xs ${summary.ok ? "text-green-700" : "text-red-700"}`}>
            {summary.ok
              ? `Found ${summary.signature} signature, ${summary.name} name and ${summary.date} date box(es)${summary.titleFieldId ? " and a Title box" : ", no Title box"}.`
              : "No signature box for the signer yet. Add one in Documenso, save, then check again."}
          </p>
        )}
      </Step>
      <Step n={4} done={false}>
        <p className="text-gray-900">Make it live</p>
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
        <button
          type="button"
          disabled={busy || version.status !== "ready" || requiresResign === null}
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
 * The agreement document. Upload a PDF as a new version, take it through
 * Documenso, and make it live. The live version is what landlords sign now.
 */
export default function AgreementVersions({ versions, documensoConnected, busy, run }) {
  const [label, setLabel] = useState("");
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const live = versions.find((v) => v.status === "live");
  const drafts = versions.filter((v) => v.status === "draft" || v.status === "ready");
  const retired = versions.filter((v) => v.status === "retired");

  const upload = (e) => {
    e.preventDefault();
    const form = new FormData();
    form.set("label", label);
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

      {live ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-green-100 bg-green-50/40 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900">{live.label}</p>
            <p className="text-xs text-gray-500">
              Live since {fmtDate(live.publishedAt)} · {live.signedCount} signed this version
              {live.requiresResign ? " · everyone had to re-sign" : ""}
            </p>
          </div>
          <Badge color="green">Live</Badge>
          <button type="button" disabled={busy} className={BUTTON} onClick={() => run(() => openFile(`/api/admin/billing/agreement-versions/${live.id}`))}>
            View PDF
          </button>
        </div>
      ) : (
        <p className="text-sm text-gray-500">No version is live yet, so landlords cannot sign in the app.</p>
      )}

      {drafts.map((v) => {
        const [color, text] = STATUS[v.status];
        return (
          <div key={v.id} className="rounded-lg border border-gray-100 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium text-gray-900">
                {v.label} <span className="text-xs font-normal text-gray-400">uploaded {fmtDate(v.createdAt)}</span>
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
        <div className="flex flex-wrap gap-3">
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

      {retired.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600">Earlier versions ({retired.length})</summary>
          <ul className="mt-2 space-y-1">
            {retired.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="flex-1">
                  {v.label} · live from {fmtDate(v.publishedAt)} · {v.signedCount} still signed on it
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
