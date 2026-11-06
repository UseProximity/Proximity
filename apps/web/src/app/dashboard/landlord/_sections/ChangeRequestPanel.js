"use client";

/*
 * "Request changes" for the commission agreement, on the landlord's Payments tab.
 * Documenso has no redlining, so a landlord who wants different wording asks here:
 * which section, what and why, their proposed wording, and optionally their
 * marked-up copy (PDF or Word, 4 MB). The team answers in the same thread.
 *
 * It fetches the landlord's own requests itself (/api/billing/agreement/change-requests).
 * A request in progress is shown with its thread, a reply box and Withdraw; with
 * none, a "Request changes" button opens the form. Earlier requests are listed
 * folded. Asking never blocks signing the standard agreement.
 *
 * Props (all optional):
 *   documentKind  "master" (default) or "amendment": what a new request is about
 *   agreementId   the landlord's master agreement (landlord_agreements.id), if any
 *   amendmentId   the amendment they are looking at, for documentKind "amendment"
 *   versionId     the agreement version they are looking at (agreement_versions.id)
 *   onChange      called after the landlord opens, replies to or withdraws a request
 */
import { useCallback, useEffect, useState } from "react";

const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";
const SECONDARY =
  "px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60";
const PRIMARY = "px-4 py-2 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60";

export const CHANGE_STATUS = {
  open: { label: "Waiting on Proximity", className: "bg-amber-100 text-amber-800" },
  answered: { label: "Proximity replied", className: "bg-blue-100 text-blue-800" },
  accepted: { label: "Changes agreed", className: "bg-green-100 text-green-800" },
  resolved: { label: "Signed", className: "bg-green-100 text-green-800" },
  declined: { label: "Not accepted", className: "bg-gray-100 text-gray-700" },
  withdrawn: { label: "Withdrawn", className: "bg-gray-100 text-gray-700" },
};
const ACTIVE = ["open", "answered", "accepted"];
const DOC = { master: "the commission agreement", amendment: "an Exhibit A amendment" };

const when = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });

async function call(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");
  return body;
}

function StatusBadge({ status }) {
  const s = CHANGE_STATUS[status] ?? CHANGE_STATUS.open;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

function FileInput({ inputKey, onFile }) {
  return (
    <label className="block text-sm text-gray-700">
      Attach your marked-up copy (optional, PDF or Word, up to 4 MB)
      <input
        key={inputKey}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="mt-1 block w-full text-sm"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

function Thread({ request }) {
  const open = async (messageId) => {
    const { url } = await call(`/api/billing/agreement/change-requests/files/${messageId}`);
    window.open(url, "_blank", "noopener,noreferrer");
  };
  return (
    <ol className="space-y-3">
      {request.messages.map((m) => (
        <li
          key={m.id}
          className={`rounded-lg border px-3 py-2 text-sm ${m.authorRole === "admin" ? "border-blue-100 bg-blue-50/50" : "border-gray-100 bg-white"}`}
        >
          <p className="text-xs text-gray-500">
            {m.authorRole === "admin" ? "Proximity" : "You"} · {when(m.createdAt)}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-gray-900">{m.body}</p>
          {m.proposedText && (
            <div className="mt-2">
              <p className="text-xs font-medium text-gray-600">Proposed wording</p>
              <p className="mt-0.5 whitespace-pre-wrap rounded bg-gray-50 px-2 py-1 text-gray-800">{m.proposedText}</p>
            </div>
          )}
          {m.file && (
            <button type="button" className="mt-2 text-xs font-medium text-red-700 underline" onClick={() => open(m.id).catch(() => {})}>
              Download {m.file.name}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function NewRequestForm({ documentKind, agreementId, amendmentId, versionId, busy, onSubmit, onCancel }) {
  const [section, setSection] = useState("");
  const [body, setBody] = useState("");
  const [proposed, setProposed] = useState("");
  const [file, setFile] = useState(null);

  return (
    <form
      className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData();
        form.set("documentKind", documentKind);
        if (agreementId) form.set("agreementId", agreementId);
        if (amendmentId) form.set("amendmentId", amendmentId);
        if (versionId) form.set("versionId", versionId);
        form.set("section", section);
        form.set("body", body);
        form.set("proposedText", proposed);
        if (file) form.set("file", file);
        onSubmit(form);
      }}
    >
      <p className="text-sm text-gray-700">
        Tell us what you would like changed in {DOC[documentKind] ?? DOC.master}. You can still sign the standard agreement while
        we look at it, so your listings are not held up.
      </p>
      <label className="block text-sm font-medium text-gray-700">
        Section or clause (optional)
        <input className={`${FIELD} mt-1`} value={section} maxLength={200} placeholder="For example: Section 4, Fees" onChange={(e) => setSection(e.target.value)} />
      </label>
      <label className="block text-sm font-medium text-gray-700">
        What would you change, and why?
        <textarea className={`${FIELD} mt-1`} rows={4} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} required />
      </label>
      <label className="block text-sm font-medium text-gray-700">
        Your proposed wording (optional)
        <textarea className={`${FIELD} mt-1`} rows={3} maxLength={10000} value={proposed} onChange={(e) => setProposed(e.target.value)} />
      </label>
      <FileInput inputKey="new" onFile={setFile} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !body.trim()} className={PRIMARY}>
          {busy ? "Sending..." : "Send request"}
        </button>
        <button type="button" disabled={busy} className={SECONDARY} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ReplyForm({ busy, onSubmit }) {
  const [body, setBody] = useState("");
  const [proposed, setProposed] = useState("");
  const [file, setFile] = useState(null);
  const [inputKey, setInputKey] = useState(0);

  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData();
        form.set("action", "reply");
        form.set("body", body);
        if (proposed.trim()) form.set("proposedText", proposed);
        if (file) form.set("file", file);
        if (await onSubmit(form)) {
          setBody("");
          setProposed("");
          setFile(null);
          setInputKey((k) => k + 1);
        }
      }}
    >
      <label className="block text-sm font-medium text-gray-700">
        Reply
        <textarea className={`${FIELD} mt-1`} rows={3} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} required />
      </label>
      <details className="text-sm">
        <summary className="cursor-pointer text-gray-600">Add proposed wording or a file</summary>
        <div className="mt-2 space-y-2">
          <textarea
            className={FIELD}
            rows={3}
            maxLength={10000}
            placeholder="Proposed wording"
            value={proposed}
            onChange={(e) => setProposed(e.target.value)}
          />
          <FileInput inputKey={inputKey} onFile={setFile} />
        </div>
      </details>
      <button type="submit" disabled={busy || !body.trim()} className={PRIMARY}>
        {busy ? "Sending..." : "Send reply"}
      </button>
    </form>
  );
}

export default function ChangeRequestPanel({ documentKind = "master", agreementId = null, amendmentId = null, versionId = null, onChange }) {
  const [requests, setRequests] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const { requests } = await call("/api/billing/agreement/change-requests");
      setRequests(requests);
    } catch (e) {
      setError(e.message);
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, success) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
      await load();
      onChange?.();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (requests === null) return null;
  const active = requests.find((r) => ACTIVE.includes(r.status)) ?? null;
  const earlier = requests.filter((r) => r !== active);

  return (
    <section className="space-y-3 border-t border-gray-100 pt-4" aria-label="Request changes to the agreement">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Request changes</h3>
        {active && <StatusBadge status={active.status} />}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {notice && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      {active ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            {active.status === "accepted"
              ? "We agreed to your changes and are preparing a version for you. It will appear here to sign once it is ready."
              : active.status === "answered"
                ? "We replied. Read it below and reply if you have more to add."
                : "We have your request and will reply by email. You can add to it below."}
            {active.section ? ` Section: ${active.section}.` : ""}
          </p>
          <Thread request={active} />
          <ReplyForm
            busy={busy}
            onSubmit={(form) => run(() => call(`/api/billing/agreement/change-requests/${active.id}`, { method: "POST", body: form }), "Reply sent.")}
          />
          <button
            type="button"
            disabled={busy}
            className="text-xs text-gray-500 underline"
            onClick={() => {
              if (!window.confirm("Withdraw this change request? You can start a new one later.")) return;
              run(
                () =>
                  call(`/api/billing/agreement/change-requests/${active.id}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "withdraw" }),
                  }),
                "Request withdrawn."
              );
            }}
          >
            Withdraw request
          </button>
        </div>
      ) : formOpen ? (
        <NewRequestForm
          documentKind={documentKind}
          agreementId={agreementId}
          amendmentId={amendmentId}
          versionId={versionId}
          busy={busy}
          onCancel={() => setFormOpen(false)}
          onSubmit={(form) =>
            run(async () => {
              await call("/api/billing/agreement/change-requests", { method: "POST", body: form });
              setFormOpen(false);
            }, "Request sent. We will reply by email.")
          }
        />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">Want different wording in the agreement? Tell us what you would change and we will reply.</p>
          <button type="button" className={SECONDARY} onClick={() => setFormOpen(true)}>
            Request changes
          </button>
        </div>
      )}

      {earlier.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600">Earlier requests ({earlier.length})</summary>
          <ul className="mt-2 space-y-3">
            {earlier.map((r) => (
              <li key={r.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <StatusBadge status={r.status} />
                  <span>{when(r.createdAt)}</span>
                  {r.section && <span>· {r.section}</span>}
                </div>
                <Thread request={r} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
