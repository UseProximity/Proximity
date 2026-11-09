"use client";

/*
 * Admin, Billing, Change requests: landlords asking for different wording in the
 * marketing agreement or an Exhibit A amendment.
 *
 * A list filtered by status (waiting on us, replied, accepted, closed), then the
 * selected request's thread with:
 *   Reply      a message to the landlord (optionally with a file); emailed to them
 *   Accept     agree to it (optional note to the landlord), then upload the
 *              agreed document as a version for this landlord only, below
 *   Decline    closes it with a note to the landlord saying why
 * Every answer is emailed to the landlord. Files open through a five minute link.
 *
 * Accepted requests show "Upload their version": it posts to the agreement
 * versions route with landlordId and changeRequestId, and the version is then
 * connected, checked and made live on the "Landlords and agreements" tab
 * (`onOpenAgreements` switches to it).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, fmtDate } from "@/components/admin/adminShared";
import { BUTTON, FIELD, PRIMARY, call, openFile, postJson } from "./agreements/shared";
import { FieldGuide } from "./agreements/AgreementVersions";

const STATUS = {
  open: ["amber", "Waiting on us"],
  answered: ["blue", "We replied"],
  accepted: ["green", "Accepted"],
  resolved: ["green", "Signed"],
  declined: ["gray", "Declined"],
  withdrawn: ["gray", "Withdrawn"],
};
const FILTERS = [
  { key: "open", label: "Waiting on us" },
  { key: "answered", label: "We replied" },
  { key: "accepted", label: "Accepted" },
  { key: "closed", label: "Closed" },
];
const CLOSED = ["resolved", "declined", "withdrawn"];
const DOC = { master: "Marketing agreement", amendment: "Exhibit A amendment" };

function Thread({ request }) {
  return (
    <ol className="space-y-2">
      {request.messages.map((m) => (
        <li
          key={m.id}
          className={`rounded-lg border px-3 py-2 text-sm ${m.authorRole === "admin" ? "border-blue-100 bg-blue-50/50" : "border-gray-100 bg-white"}`}
        >
          <p className="text-xs text-gray-500">
            {m.authorRole === "admin" ? "Proximity" : request.landlord?.name || "Landlord"} · {fmtDate(m.createdAt)}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-gray-900">{m.body}</p>
          {m.proposedText && (
            <div className="mt-2">
              <p className="text-xs font-medium text-gray-600">Proposed wording</p>
              <p className="mt-0.5 whitespace-pre-wrap rounded bg-gray-50 px-2 py-1 text-gray-800">{m.proposedText}</p>
            </div>
          )}
          {m.file && (
            <button
              type="button"
              className="mt-2 text-xs font-medium text-gray-900 underline"
              onClick={() => openFile(`/api/admin/billing/change-requests/files/${m.id}`).catch(() => {})}
            >
              Open {m.file.name}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

// The agreed document for one accepted request: a version for this landlord only.
// The landlord sees its name, so it starts as the standard version's (Wyatt, 2026-11-08).
function LandlordVersionUpload({ request, busy, run, onOpenAgreements }) {
  const [label, setLabel] = useState("");
  const kind = request.documentKind ?? "master";
  useEffect(() => {
    let live = true;
    call("/api/admin/billing/agreement-versions")
      .then((r) => {
        const standard = (r.versions ?? []).find((v) => v.status === "live" && v.kind === kind && !v.landlordId);
        if (live && standard) setLabel((prev) => prev || standard.label);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [kind]);
  const [file, setFile] = useState(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="rounded-lg border border-green-100 bg-green-50/50 px-3 py-2 text-sm text-gray-800">
        Uploaded. Finish it under Landlords and agreements: connect it to Documenso, place and check the boxes, then make it live for
        this landlord.{" "}
        {onOpenAgreements && (
          <button type="button" className="font-medium underline" onClick={onOpenAgreements}>
            Go there
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      className="space-y-2 rounded-lg border border-gray-200 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData();
        form.set("label", label);
        form.set("kind", request.documentKind);
        form.set("landlordId", request.landlord.id);
        form.set("changeRequestId", request.id);
        if (request.versionId) form.set("basedOnVersionId", request.versionId);
        if (file) form.set("file", file);
        run(async () => {
          await call("/api/admin/billing/agreement-versions", { method: "POST", body: form });
          setDone(true);
        }, "Their version is uploaded.");
      }}
    >
      <p className="text-sm font-medium text-gray-900">Upload their version</p>
      <p className="text-xs text-gray-500">
        A {DOC[request.documentKind]?.toLowerCase() ?? "marketing agreement"} for {request.landlord?.name || request.landlord?.email} only. Other
        landlords keep the standard one. They see it exactly like the standard one.
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="block min-w-[12rem] flex-1 text-sm text-gray-700">
          Name
          <input className={`${FIELD} mt-1`} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} required />
          <span className="mt-1 block text-xs text-gray-500">The landlord sees this name. Keep it like the standard version&apos;s.</span>
        </label>
        <label className="block min-w-[12rem] flex-1 text-sm text-gray-700">
          PDF (up to 4 MB)
          <input className="mt-2 block w-full text-sm" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
        </label>
      </div>
      <details className="rounded-md border border-gray-200 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-700">Boxes to place in Documenso, and their labels</summary>
        <div className="mt-2">
          <FieldGuide kind={request.documentKind ?? "master"} />
        </div>
      </details>
      <button type="submit" disabled={busy || !file} className={PRIMARY}>
        {busy ? "Uploading..." : "Upload"}
      </button>
    </form>
  );
}

function RequestDetail({ request, busy, run, onOpenAgreements }) {
  const [reply, setReply] = useState("");
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [mode, setMode] = useState(null); // "accept" | "decline"
  const [note, setNote] = useState("");
  const closed = CLOSED.includes(request.status);
  const [color, label] = STATUS[request.status] ?? STATUS.open;
  const url = `/api/admin/billing/change-requests/${request.id}`;

  const sendReply = (e) => {
    e.preventDefault();
    const form = new FormData();
    form.set("action", "reply");
    form.set("body", reply);
    if (file) form.set("file", file);
    run(async () => {
      await call(url, { method: "POST", body: form });
      setReply("");
      setFile(null);
      setFileKey((k) => k + 1);
    }, "Reply sent. The landlord has been emailed.");
  };

  const decide = () =>
    run(async () => {
      await postJson(url, { action: mode, note });
      setMode(null);
      setNote("");
    }, mode === "accept" ? "Accepted. The landlord has been emailed. Upload their version below." : "Declined. The landlord has been emailed.");

  return (
    <div className="space-y-4 rounded-lg border border-gray-100 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold text-gray-900">
          {request.landlord?.name || request.landlord?.email}
          <span className="ml-2 text-xs font-normal text-gray-500">
            {request.landlord?.email}
            {request.landlord?.company ? ` · ${request.landlord.company}` : ""}
          </span>
        </p>
        <Badge color={color}>{label}</Badge>
      </div>
      <p className="text-xs text-gray-500">
        {DOC[request.documentKind] ?? DOC.master}
        {request.section ? ` · Section: ${request.section}` : ""} · opened {fmtDate(request.createdAt)}
        {request.agreementId ? " · after signing" : " · before signing"}
      </p>

      <Thread request={request} />

      {!closed && (
        <form onSubmit={sendReply} className="space-y-2">
          <label className="block text-sm text-gray-700">
            Reply to the landlord (emailed to them)
            <textarea className={`${FIELD} mt-1`} rows={3} maxLength={10000} value={reply} onChange={(e) => setReply(e.target.value)} required />
          </label>
          <input
            key={fileKey}
            type="file"
            accept=".pdf,.doc,.docx"
            className="block w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !reply.trim()} className={PRIMARY}>
              Send reply
            </button>
            {request.status !== "accepted" && (
              <button type="button" disabled={busy} className={BUTTON} onClick={() => setMode("accept")}>
                Accept changes
              </button>
            )}
            <button type="button" disabled={busy} className={`${BUTTON} text-red-700`} onClick={() => setMode("decline")}>
              Decline
            </button>
          </div>
        </form>
      )}

      {mode && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-900">{mode === "accept" ? "Accept these changes?" : "Decline this request?"}</p>
          <p className="text-xs text-gray-500">
            {mode === "accept"
              ? "The landlord is told we agreed and that a version is coming. Then upload their version below."
              : "The landlord is told we cannot make the changes and can still sign the standard agreement."}
          </p>
          <textarea
            className={FIELD}
            rows={3}
            maxLength={10000}
            placeholder={mode === "accept" ? "Note to the landlord (optional)" : "Note to the landlord saying why (required)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy || (mode === "decline" && !note.trim())} className={PRIMARY} onClick={decide}>
              {mode === "accept" ? "Accept" : "Decline"}
            </button>
            <button type="button" disabled={busy} className={BUTTON} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {request.status === "accepted" && (
        <LandlordVersionUpload key={request.id} request={request} busy={busy} run={run} onOpenAgreements={onOpenAgreements} />
      )}
    </div>
  );
}

export default function ChangeRequestsPanel({ search = "", onOpenAgreements, onCountsChange }) {
  const [filter, setFilter] = useState("open");
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const body = await call("/api/admin/billing/change-requests");
      setData(body);
      onCountsChange?.(body.counts);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [onCountsChange]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, success) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (success) setNotice(success);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      await load();
    }
  };

  const shown = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.requests.filter(
      (r) =>
        (filter === "closed" ? CLOSED.includes(r.status) : r.status === filter) &&
        (!q || [r.landlord?.name, r.landlord?.email, r.landlord?.company, r.section].some((v) => String(v ?? "").toLowerCase().includes(q)))
    );
  }, [data, filter, search]);

  if (!data && !error) return <div className="py-10 text-center text-sm text-gray-400">Loading change requests...</div>;
  const selected = data?.requests.find((r) => r.id === selectedId) ?? null;
  const counts = data?.counts ?? {};

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Landlords asking for different wording in the marketing agreement. Reply, accept (then upload their version) or decline.
        Every answer is emailed to them.
      </p>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              filter === f.key ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {f.label}
            {counts[f.key] > 0 && <span className="ml-2 text-xs opacity-80">{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</div>}

      {shown.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
          {shown.map((r) => {
            const [color, label] = STATUS[r.status] ?? STATUS.open;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
                  className={`flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 ${r.id === selectedId ? "bg-gray-50" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{r.landlord?.name || r.landlord?.email}</span>
                  <span className="text-xs text-gray-500">{r.section || DOC[r.documentKind]}</span>
                  <span className="text-xs text-gray-400">{fmtDate(r.lastActivityAt)}</span>
                  <Badge color={color}>{label}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && <RequestDetail key={selected.id} request={selected} busy={busy} run={run} onOpenAgreements={onOpenAgreements} />}
    </div>
  );
}
