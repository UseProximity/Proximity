"use client";

/*
 * Shown in the signing window right after a landlord rejects the agreement in
 * Documenso. The server has already turned their reject reason into a change
 * request (or added it to the one they had open) and told the team. This asks for
 * the rest while it is fresh: the reason, prefilled and editable, plus the section,
 * their proposed wording and a marked-up copy. Sending fills in that same message
 * (action "complete"), so the thread never shows the reason twice.
 *
 * If the request cannot be found (the server is still catching up, or recording it
 * failed), sending opens a new request instead, so nothing the landlord typed is lost.
 *
 * Props: reason (from Documenso's reject popup), kind ("master" | "amendment"),
 * onClose().
 */
import { useEffect, useState } from "react";
import { FileInput } from "./ChangeRequestPanel";
import { declineText, isDeclineMessage } from "@/lib/billing/declineNote";

const FIELD = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";
const SECONDARY = "px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60";
const PRIMARY = "px-4 py-2 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60";
const ACTIVE = ["open", "answered", "accepted"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || "Something went wrong. Please try again."), { status: res.status });
  return body;
}

// The landlord's request in progress whose newest message is the decline.
async function findDeclineRequest() {
  const { requests } = await call("/api/billing/agreement/change-requests");
  const active = (requests ?? []).find((r) => ACTIVE.includes(r.status));
  const latest = active?.messages?.at(-1);
  return active && isDeclineMessage(latest) ? { id: active.id, section: active.section, text: declineText(latest.body) } : null;
}

export default function DeclineDetailsForm({ reason = "", kind = "master", onClose }) {
  const [request, setRequest] = useState(undefined); // undefined while looking, null if not found
  const [section, setSection] = useState("");
  const [body, setBody] = useState(reason ?? "");
  const [proposed, setProposed] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  // The webhook or the sync that just ran records it; give it a few seconds.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 0; i < 6 && alive; i += 1) {
        const found = await findDeclineRequest().catch(() => null);
        if (found) {
          if (!alive) return;
          setRequest(found);
          if (found.section) setSection(found.section);
          setBody((b) => b || found.text);
          return;
        }
        await wait(1500);
      }
      if (alive) setRequest(null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("section", section);
    form.set("body", body);
    form.set("proposedText", proposed);
    if (file) form.set("file", file);
    try {
      const target = request ?? (await findDeclineRequest().catch(() => null));
      if (target) {
        form.set("action", "complete");
        await call(`/api/billing/agreement/change-requests/${target.id}`, { method: "POST", body: form });
      } else {
        form.set("documentKind", kind);
        await call("/api/billing/agreement/change-requests", { method: "POST", body: form });
      }
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-3 px-6 py-16 text-center text-sm text-gray-700">
        <p className="font-medium text-gray-900">Sent. Thank you.</p>
        <p>We will reply by email, and you can follow the conversation on your Billing tab under Request changes.</p>
        <button type="button" className={SECONDARY} onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  const what = kind === "amendment" ? "the Exhibit A amendment" : "the agreement";
  return (
    <form className="mx-auto w-full max-w-xl space-y-4 overflow-y-auto px-6 py-8" onSubmit={submit}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-gray-900">Tell us what you would like changed</h3>
        <p className="text-sm text-gray-700">
          You declined to sign {what}, and we have passed your reason to the team. Add the details below so we can act on it. You can still
          sign the standard agreement from Billing at any time.
        </p>
      </div>
      <label className="block text-sm font-medium text-gray-700">
        What would you change, and why?
        <textarea className={`${FIELD} mt-1`} rows={4} maxLength={9900} value={body} onChange={(e) => setBody(e.target.value)} required autoFocus />
      </label>
      <label className="block text-sm font-medium text-gray-700">
        Section or clause (optional)
        <input
          className={`${FIELD} mt-1 disabled:bg-gray-50`}
          value={section}
          maxLength={200}
          placeholder="For example: Section 4, Fees"
          disabled={!!request?.section}
          onChange={(e) => setSection(e.target.value)}
        />
      </label>
      <label className="block text-sm font-medium text-gray-700">
        Your proposed wording (optional)
        <textarea className={`${FIELD} mt-1`} rows={3} maxLength={10000} value={proposed} onChange={(e) => setProposed(e.target.value)} />
      </label>
      <FileInput inputKey="decline" onFile={setFile} />
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || request === undefined || !body.trim()} className={PRIMARY}>
          {busy ? "Sending..." : request === undefined ? "Getting ready..." : "Send to the team"}
        </button>
        <button type="button" disabled={busy} className={SECONDARY} onClick={onClose}>
          Not now
        </button>
      </div>
      {request && <p className="text-xs text-gray-500">Not now keeps your reason with the team. You can add details later on your Billing tab.</p>}
    </form>
  );
}
