"use client";

/*
 * Admin controls for emailed replies that were not posted, in the
 * Conversations view (Wyatt, 2026-10-24).
 *
 * RefusedReply sits in the conversation timeline where the reply arrived: who
 * sent it, why it was not posted, what it said, and the actions that apply.
 * A reply held for the landlord's approval can be approved (the address, or
 * the whole company domain) or declined on their behalf; any refused reply can
 * be re-run through today's rules. ReplySendersList shows the landlord's
 * approved and declined senders with a remove button.
 *
 * Every action goes to /api/admin/chat/reply-senders and the view reloads the
 * conversation afterwards, so what is shown is always what was saved.
 */

import { useState } from "react";
import { adminFetch, Badge } from "@/components/admin/adminShared";

const STATUS_LABELS = {
  held: { label: "Held for the landlord's approval", color: "amber" },
  unauthenticated: { label: "Sender could not be verified", color: "red" },
  wrong_sender: { label: "Not from the landlord", color: "red" },
  unknown_address: { label: "Reply address not recognised", color: "red" },
  empty: { label: "Nothing new in the reply", color: "gray" },
  rejected: { label: "Refused by the conversation", color: "red" },
  error: { label: "Processing failed", color: "red" },
  spam: { label: "Marked as spam", color: "gray" },
  auto_reply: { label: "Automatic reply", color: "gray" },
};

function fmtWhen(v) {
  if (!v) return "";
  return new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function describeResults(out) {
  const results = out?.results ?? [];
  const lines = results.map((r) =>
    r.status === "posted" ? `Delivered (${r.fromEmail ?? "reply"})` : `${r.fromEmail ?? "Reply"}: ${r.status}${r.reason ? `, ${r.reason}` : ""}`
  );
  if (out?.note) lines.push(out.note);
  return lines.length ? lines.join(". ") : "Saved.";
}

function useAction(dbTarget, onChanged) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [failed, setFailed] = useState(false);

  async function run(method, body) {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      const out = await adminFetch("/api/admin/chat/reply-senders", dbTarget, { method, body: JSON.stringify(body) });
      setMessage(method === "DELETE" ? "Removed." : describeResults(out));
      onChanged?.();
    } catch (err) {
      setFailed(true);
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, failed, run };
}

const btn = "px-2 py-0.5 text-[11px] rounded-md border disabled:opacity-50";

export function RefusedReply({ r, dbTarget, onChanged }) {
  const { busy, message, failed, run } = useAction(dbTarget, onChanged);
  const meta = STATUS_LABELS[r.status] ?? { label: r.status, color: "gray" };
  const domain = String(r.fromEmail ?? "").split("@")[1];

  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-600">
        <span className="font-semibold text-gray-900">{r.senderName ? `${r.senderName} · ` : ""}{r.fromEmail ?? "unknown sender"}</span>
        <span>{fmtWhen(r.receivedAt)}</span>
        <Badge color={meta.color}>emailed reply · {meta.label}</Badge>
        {r.landlordAskedAt && <span className="text-gray-400">landlord asked {fmtWhen(r.landlordAskedAt)}</span>}
      </div>
      {r.preview ? (
        <p className="mt-1 text-sm text-gray-800 whitespace-pre-wrap break-words">{r.preview}</p>
      ) : (
        <p className="mt-1 text-sm italic text-gray-400">(text not kept; it is in the inbound mail bucket)</p>
      )}
      {r.reason && <p className="mt-1 text-[11px] text-gray-400">{r.reason}</p>}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {r.status === "held" ? (
          <>
            <button type="button" disabled={busy} onClick={() => run("POST", { inboundId: r.id, action: "approve", scope: "address" })} className={`${btn} border-gray-900 bg-gray-900 text-white`}>
              Approve this address
            </button>
            {r.canApproveDomain && domain && (
              <button type="button" disabled={busy} onClick={() => run("POST", { inboundId: r.id, action: "approve", scope: "domain" })} className={`${btn} border-gray-300 bg-white text-gray-800`}>
                Approve everyone @{domain}
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => run("POST", { inboundId: r.id, action: "decline" })} className={`${btn} border-gray-300 bg-white text-red-700`}>
              Not them
            </button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => run("POST", { inboundId: r.id, action: "retry" })} className={`${btn} border-gray-300 bg-white text-gray-800`}>
            Re-run with today&apos;s rules
          </button>
        )}
        {busy && <span className="text-[11px] text-gray-400">Working…</span>}
      </div>
      {message && <p className={`mt-1 text-[11px] ${failed ? "text-red-600" : "text-green-700"}`}>{message}</p>}
    </div>
  );
}

export function ReplySendersList({ senders, landlordId, dbTarget, onChanged }) {
  const { busy, message, failed, run } = useAction(dbTarget, onChanged);
  if (!senders?.length) return null;
  return (
    <div className="mt-2 text-xs text-gray-600">
      <p className="font-medium text-gray-700">Who else may reply for this landlord by email</p>
      <ul className="mt-1 space-y-1">
        {senders.map((s) => (
          <li key={s.id} className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-gray-900">{s.pattern.startsWith("@") ? `anyone ${s.pattern}` : s.pattern}</span>
            <Badge color={s.decision === "approved" ? "green" : "red"}>{s.decision === "approved" ? "approved" : "not them"}</Badge>
            <span className="text-gray-400">by {s.decidedVia} · {fmtWhen(s.updatedAt)}</span>
            <button type="button" disabled={busy} onClick={() => run("DELETE", { landlordId, id: s.id })} className={`${btn} border-gray-300 bg-white text-gray-600`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {message && <p className={`mt-1 text-[11px] ${failed ? "text-red-600" : "text-green-700"}`}>{message}</p>}
    </div>
  );
}
