"use client";

/*
 * Admin view of every chat conversation on the platform (Wyatt, 2026-10-12).
 *
 * Left: the list of threads, newest activity first, searchable from the
 * header box, with a "Flagged only" filter. Right: the selected thread, every
 * message in order with who sent it, when, and how (in the app or by email
 * reply). Moderation flags sit on the message they belong to in plain words,
 * and attempts that were blocked before anything was posted appear in the
 * timeline where they happened, so the admin sees what someone tried to say.
 *
 * Read only. It fetches its own data against the dashboard's dev/prod switch
 * rather than going through the hierarchy loader, because a thread list and a
 * thread body are two requests, not one table.
 */

import { useState, useEffect, useMemo } from "react";
import { adminFetch, Badge, shortId } from "@/components/admin/adminShared";

// Plain-words labels for the reason keys written by lib/chat/moderation.js,
// lib/chat/inboundEmail.js and lib/chat/scanAttachment.js. Anything not listed
// falls back to the key with its underscores turned into spaces.
const REASON_LABELS = {
  contact_email: "email address",
  contact_phone: "phone number",
  external_link: "outside link",
  social_handle: "social handle",
  off_platform_request: "asked to move off Proximity",
  irreversible_payment_rail: "risky payment method",
  off_platform_payment_request: "payment outside Proximity",
  credential_phishing: "asked for login details",
  slur: "slur",
  threat: "threat",
  payment_rail_mentioned: "payment method mentioned",
  scam_narrative: "scam pattern",
  platform_mentioned: "other platform mentioned",
  ssn_mentioned: "SSN mentioned",
  delivered_from_email: "delivered as written (email reply)",
  redacted_from_email: "sentence removed (email reply)",
  confirmed_in_app: "sent after confirming",
  from_email: "email reply",
  attachments_removed: "attachments removed",
  attachment_scan_unavailable: "attachment not scanned",
  attachment_too_large_to_scan: "attachment too large to scan",
  attachment_scan_unparsed: "attachment scan unreadable",
};

// Reasons that describe how the message was handled rather than what was in
// it. They are shown in grey so the red ones stand out.
const HANDLING_REASONS = new Set([
  "delivered_from_email",
  "redacted_from_email",
  "confirmed_in_app",
  "from_email",
  "attachments_removed",
]);

function reasonLabel(key) {
  return REASON_LABELS[key] || String(key ?? "").replace(/_/g, " ");
}

function fmtWhen(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function personLabel(p) {
  if (!p) return "Unknown";
  return p.name || p.email || shortId(p.id);
}

function listingLabel(l) {
  if (!l) return "No listing";
  return l.title || l.address || shortId(l.id);
}

function FlagBadges({ reasons }) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {reasons.map((r) => (
        <Badge key={r} color={HANDLING_REASONS.has(r) ? "gray" : "red"} title={r}>
          {reasonLabel(r)}
        </Badge>
      ))}
    </span>
  );
}

function ThreadRow({ t, selected, onSelect }) {
  const hasFlags = t.flagged > 0 || t.blocked > 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(t.id)}
      className={`w-full text-left px-3 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 ${
        selected ? "bg-blue-50 hover:bg-blue-50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <p className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">
          {personLabel(t.student)} <span className="text-gray-400 font-normal">and</span> {personLabel(t.landlord)}
        </p>
        {hasFlags && (
          <Badge color={t.unreviewed > 0 ? "red" : "amber"} title="Flagged messages and blocked attempts in this thread">
            {t.flagged + t.blocked} flagged
          </Badge>
        )}
        {t.deletedAt && <Badge color="gray">deleted</Badge>}
      </div>
      <p className="text-[11px] text-gray-500 truncate">{listingLabel(t.listing)}</p>
      <p className="text-[11px] text-gray-400">
        {t.messages} message{t.messages === 1 ? "" : "s"}
        {t.lastMessageAt ? ` · last ${fmtWhen(t.lastMessageAt)}` : ""}
      </p>
    </button>
  );
}

function Message({ m, sender, isLandlord }) {
  const flagged = m.flags.length > 0;
  const reasons = [...new Set(m.flags.flatMap((f) => f.reasons))];
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        flagged ? "border-red-200 bg-red-50/40" : isLandlord ? "border-blue-100 bg-blue-50/40" : "border-gray-200 bg-white"
      } ${m.deletedAt ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
        <span className={`font-semibold ${isLandlord ? "text-blue-800" : "text-gray-800"}`}>{personLabel(sender)}</span>
        <Badge color={isLandlord ? "blue" : "gray"}>{sender?.side === "landlord" ? "landlord" : sender?.side === "student" ? "student" : sender?.role || "user"}</Badge>
        <span>{fmtWhen(m.createdAt)}</span>
        {m.via === "email" && <Badge color="purple" title="Sent by replying to an alert email">via email</Badge>}
        {m.deletedAt && <Badge color="gray" title={`Deleted ${fmtWhen(m.deletedAt)}`}>deleted</Badge>}
        {flagged && <span className="text-red-700 font-semibold">Flagged</span>}
      </div>
      {m.body ? (
        <p className="mt-1 text-sm text-gray-900 whitespace-pre-wrap break-words">{m.body}</p>
      ) : (
        <p className="mt-1 text-sm italic text-gray-400">(no text)</p>
      )}
      {m.attachments.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {m.attachments.map((a, i) => (
            <li key={`${a.fileName}-${i}`} className="text-xs text-gray-600">
              <span className="text-gray-400">Attachment:</span> {a.fileName || "file"}
              {a.contentType ? <span className="text-gray-400"> · {a.contentType}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {flagged && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <FlagBadges reasons={reasons} />
          {m.flags.every((f) => f.reviewedAt) && <span className="text-[10px] text-gray-400">reviewed</span>}
        </div>
      )}
    </div>
  );
}

function BlockedAttempt({ e, sender }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-amber-800">
        <span className="font-semibold">{personLabel(sender)}</span>
        <span>{fmtWhen(e.createdAt)}</span>
        <span className="font-semibold">
          {e.action === "block" ? "Blocked before sending" : "Flagged (message not linked)"}
        </span>
      </div>
      {e.excerpt ? (
        <p className="mt-1 text-sm text-amber-900 whitespace-pre-wrap break-words">{e.excerpt}</p>
      ) : (
        <p className="mt-1 text-sm italic text-amber-700">(no text kept)</p>
      )}
      <div className="mt-1.5">
        <FlagBadges reasons={e.reasons} />
      </div>
    </div>
  );
}

function ThreadDetail({ detail }) {
  const { thread, people, messages, blockedAttempts } = detail;
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const landlord = people.find((p) => p.side === "landlord");
  const student = people.find((p) => p.side === "student");

  // Messages and blocked attempts on one timeline.
  const timeline = useMemo(() => {
    const items = [
      ...messages.map((m) => ({ kind: "message", at: m.createdAt, m })),
      ...blockedAttempts.map((e) => ({ kind: "blocked", at: e.createdAt, e })),
    ];
    return items.sort((a, b) => new Date(a.at) - new Date(b.at));
  }, [messages, blockedAttempts]);

  const flaggedCount = messages.filter((m) => m.flags.length > 0).length;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">{listingLabel(thread.listing)}</p>
            {thread.listing?.address && thread.listing?.title && (
              <p className="text-[11px] text-gray-500">{thread.listing.address}</p>
            )}
            <p className="text-[11px] text-gray-400 font-mono mt-0.5">{thread.id}</p>
          </div>
          {thread.deletedAt && <Badge color="gray">thread deleted {fmtWhen(thread.deletedAt)}</Badge>}
        </div>
        <div className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
          <p>
            <Badge color="gray">student</Badge> <span className="font-medium text-gray-900">{personLabel(student)}</span>
            {student?.email && <span className="text-gray-400"> · {student.email}</span>}
            {student?.emailMode && <span className="text-purple-700"> · replying by email</span>}
          </p>
          <p>
            <Badge color="blue">landlord</Badge> <span className="font-medium text-gray-900">{personLabel(landlord)}</span>
            {landlord?.email && <span className="text-gray-400"> · {landlord.email}</span>}
            {landlord?.emailMode && <span className="text-purple-700"> · replying by email</span>}
          </p>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          {messages.length} message{messages.length === 1 ? "" : "s"}
          {flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ""}
          {blockedAttempts.length > 0 ? ` · ${blockedAttempts.length} blocked before sending` : ""}
          {` · started ${fmtWhen(thread.createdAt)}`}
        </p>
      </div>

      <div className="space-y-2">
        {timeline.length === 0 && <p className="py-10 text-center text-sm text-gray-400">No messages in this thread.</p>}
        {timeline.map((item) =>
          item.kind === "message" ? (
            <Message
              key={item.m.id}
              m={item.m}
              sender={byId.get(item.m.senderId)}
              isLandlord={item.m.senderId === thread.landlordId}
            />
          ) : (
            <BlockedAttempt key={item.e.id} e={item.e} sender={byId.get(item.e.userId)} />
          )
        )}
      </div>
    </div>
  );
}

export default function ConversationsView({ search, dbTarget }) {
  const [threads, setThreads] = useState(null);
  const [listError, setListError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setThreads(null);
    setListError(null);
    setSelectedId(null);
    setDetail(null);
    adminFetch("/api/admin/chat/threads", dbTarget)
      .then((d) => { if (!cancelled) setThreads(Array.isArray(d) ? d : []); })
      .catch((err) => { if (!cancelled) setListError(err.message); });
    return () => { cancelled = true; };
  }, [dbTarget]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    adminFetch(`/api/admin/chat/threads/${selectedId}`, dbTarget)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => { if (!cancelled) setDetailError(err.message); });
    return () => { cancelled = true; };
  }, [selectedId, dbTarget]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return (threads ?? []).filter((t) => {
      if (flaggedOnly && t.flagged === 0 && t.blocked === 0) return false;
      if (!includeDeleted && t.deletedAt) return false;
      if (!q) return true;
      return [
        t.student?.name, t.student?.email, t.landlord?.name, t.landlord?.email,
        t.listing?.title, t.listing?.address, t.subject, t.id,
      ].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [threads, flaggedOnly, includeDeleted, q]);

  const totalFlagged = (threads ?? []).filter((t) => t.flagged > 0 || t.blocked > 0).length;

  if (listError) {
    return <p className="py-10 text-center text-sm text-red-600">{listError}</p>;
  }
  if (!threads) {
    return <p className="py-20 text-center text-sm text-gray-400">Loading conversations…</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-gray-500">
          {filtered.length} of {threads.length} conversations
          {totalFlagged > 0 ? ` · ${totalFlagged} with flags` : ""}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFlaggedOnly((v) => !v)}
            className={`px-2 py-0.5 text-[11px] rounded-full border ${
              flaggedOnly ? "bg-red-700 border-red-700 text-white" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
          >
            Flagged only
          </button>
          <button
            type="button"
            onClick={() => setIncludeDeleted((v) => !v)}
            className={`px-2 py-0.5 text-[11px] rounded-full border ${
              includeDeleted ? "bg-gray-800 border-gray-800 text-white" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
          >
            Include deleted
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-[320px_1fr] gap-3 items-start">
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden md:max-h-[75vh] md:overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">No conversations match.</p>
          ) : (
            filtered.map((t) => <ThreadRow key={t.id} t={t} selected={t.id === selectedId} onSelect={setSelectedId} />)
          )}
        </div>

        <div className="min-w-0">
          {!selectedId ? (
            <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center text-sm text-gray-400">
              Select a conversation on the left to read it.
            </div>
          ) : detailError ? (
            <p className="py-10 text-center text-sm text-red-600">{detailError}</p>
          ) : !detail ? (
            <p className="py-16 text-center text-sm text-gray-400">Loading conversation…</p>
          ) : (
            <ThreadDetail detail={detail} />
          )}
        </div>
      </div>
    </div>
  );
}
