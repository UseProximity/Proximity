"use client";

/*
 * Above the composer, for the landlord only: emailed replies to this
 * conversation from someone who is not set up to reply for them yet (Wyatt,
 * 2026-10-24). Each shows who sent it and what it says, with Approve (that
 * address, or everyone at their company) and Not them. Approving delivers the
 * reply straight away. Underneath, a quiet line lists who is already approved,
 * with a way to remove them.
 *
 * Shows nothing when there is nothing held and nobody approved, and for
 * students. The landlord's own email (lib/chat/replySenderRequest.js) links
 * here. See lib/chat/replySenderApproval.js for the rules.
 */
import { useCallback, useEffect, useState } from "react";
import { useMessages } from "@/context/MessagesContext";

function fmtWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function HeldReply({ h, busy, onDecide }) {
  const who = h.senderName ? `${h.senderName} (${h.fromEmail})` : h.fromEmail;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] leading-5 text-amber-900">
      <p>
        <span className="font-semibold">{who}</span> replied for you by email on {fmtWhen(h.receivedAt)}. It is waiting
        because this address is not set up to reply for you.
      </p>
      {h.preview && (
        <p className="mt-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-gray-800 whitespace-pre-wrap break-words">{h.preview}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(h, "approve", "address")}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Approve and deliver
        </button>
        {h.canApproveDomain && h.domain && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(h, "approve", "domain")}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            Approve everyone @{h.domain}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(h, "decline", "address")}
          className="px-1 py-1.5 text-[13px] font-semibold text-red-700 underline underline-offset-2 hover:text-red-800 disabled:opacity-50"
        >
          Not them
        </button>
      </div>
    </div>
  );
}

export default function HeldRepliesBanner({ threadId }) {
  const { loadMessages } = useMessages();
  const [data, setData] = useState({ held: [], senders: [] });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/threads/${threadId}/reply-senders`);
      if (!res.ok) return;
      setData(await res.json());
    } catch {
      // Nothing to show is the safe fallback.
    }
  }, [threadId]);

  useEffect(() => {
    setNote(null);
    load();
  }, [load]);

  async function decide(h, decision, scope) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/chat/threads/${threadId}/reply-senders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heldId: h.id, decision, scope }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ error: true, text: out.error || "Something went wrong. Please try again." });
      } else if (decision === "decline") {
        setNote({ text: `Done. Nothing from ${h.fromEmail} will be posted.` });
      } else {
        const failedOnes = (out.results ?? []).filter((r) => r.status !== "posted");
        setNote(
          failedOnes.length
            ? { error: true, text: "Approved, but a reply could not be delivered. Our team has been told and will follow up." }
            : { text: "Approved. The reply has been delivered." }
        );
        loadMessages?.(threadId)?.catch?.(() => {});
      }
    } catch {
      setNote({ error: true, text: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
      load();
    }
  }

  async function remove(id) {
    setBusy(true);
    try {
      await fetch(`/api/chat/reply-senders/${id}`, { method: "DELETE" });
    } finally {
      setBusy(false);
      load();
    }
  }

  const approved = data.senders.filter((s) => s.decision === "approved");
  if (data.held.length === 0 && approved.length === 0 && !note) return null;

  return (
    <div className="mb-2 space-y-2">
      {data.held.map((h) => (
        <HeldReply key={h.id} h={h} busy={busy} onDecide={decide} />
      ))}
      {note && <p className={`text-[12px] ${note.error ? "text-red-700" : "text-green-700"}`}>{note.text}</p>}
      {approved.length > 0 && (
        <p className="text-[12px] leading-5 text-gray-500">
          Also replying for you by email:{" "}
          {approved.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <span className="text-gray-700">{s.isDomain ? `anyone ${s.pattern}` : s.pattern}</span>{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(s.id)}
                className="underline underline-offset-2 hover:text-gray-700 disabled:opacity-50"
              >
                remove
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
