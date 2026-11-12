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
 * Emailed replies that were not posted appear in the timeline too, with the
 * actions to approve or decline their sender for the landlord, or re-run them
 * (ReplySenderControls.js, Wyatt, 2026-10-24). Everything else is read only.
 * It fetches its own data against the dashboard's dev/prod switch
 * rather than going through the hierarchy loader, because a thread list and a
 * thread body are two requests, not one table.
 *
 * Three tabs since the per-listing agents (Wyatt, 2026-11-01):
 *
 *   Agent conversations  students and visitors talking with Proxy, or each
 *                        landlord's chat with their listing's agent (the
 *                        questions Proxy sent, tour requests, what they told
 *                        the agent), switched with a filter.
 *   Person to person     a student and a landlord; the chats a tour opened
 *                        are marked "From a tour".
 *   Tours                every tour request at every stage (waiting on the
 *                        landlord, landlord wrote instead, upcoming, past,
 *                        cancelled, expired; Wyatt, 2026-11-03), each
 *                        linking to its conversation here.
 *
 * The tab and what is open live in the URL (?view=conversations&tab=direct&
 * thread=<id>, or &tab=agent&side=landlords&chat=<landlordId>:<listingId>) so
 * a link opens straight onto a conversation.
 */

import { useState, useEffect, useMemo } from "react";
import { adminFetch, Badge, shortId } from "@/components/admin/adminShared";
import { RefusedReply, ReplySendersList } from "@/components/admin/ReplySenderControls";

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

function visitorLabel(v) {
  if (!v) return "Visitor";
  return v.email ? `Visitor (${v.email})` : `Visitor ${shortId(v.id)}`;
}

function ThreadRow({ t, selected, onSelect }) {
  const hasFlags = t.flagged > 0 || t.blocked > 0;
  const agent = t.kind === "agent";
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
          {agent ? (t.student ? personLabel(t.student) : visitorLabel(t.visitor)) : personLabel(t.student)}{" "}
          <span className="text-gray-400 font-normal">{agent ? "with" : "and"}</span> {agent ? "Proxy" : personLabel(t.landlord)}
        </p>
        {t.fromTour && <Badge color="green" title="Opened when a tour was confirmed or the landlord wrote to the student">From a tour</Badge>}
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

// What each of Proxy's messages was, in plain words.
const PROXY_KINDS = {
  proxy_answer: "answered",
  proxy_asked: "sent to the landlord",
  proxy_relay: "landlord reply relayed",
  proxy_note: "note",
};

function Message({ m, sender, isLandlord, visitor = null }) {
  const flagged = m.flags.length > 0;
  const reasons = [...new Set(m.flags.flatMap((f) => f.reasons))];
  const who = m.fromProxy ? "Proxy" : sender ? personLabel(sender) : visitor ? visitorLabel(visitor) : "Unknown";
  const role = m.fromProxy ? "agent" : sender?.side === "landlord" ? "landlord" : sender?.side === "student" ? "student" : !sender && visitor ? "visitor" : sender?.role || "user";
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        flagged ? "border-red-200 bg-red-50/40" : m.fromProxy ? "border-purple-100 bg-purple-50/40" : isLandlord ? "border-blue-100 bg-blue-50/40" : "border-gray-200 bg-white"
      } ${m.deletedAt ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
        <span className={`font-semibold ${m.fromProxy ? "text-purple-800" : isLandlord ? "text-blue-800" : "text-gray-800"}`}>{who}</span>
        <Badge color={m.fromProxy ? "purple" : isLandlord ? "blue" : "gray"}>{role}</Badge>
        {m.fromProxy && PROXY_KINDS[m.type] && <Badge color="gray">{PROXY_KINDS[m.type]}</Badge>}
        <span>{fmtWhen(m.createdAt)}</span>
        {m.via === "email" && <Badge color="purple" title="Sent by replying to an alert email">via email{m.emailFrom ? ` from ${m.emailFrom}` : ""}</Badge>}
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

// Opens a person's own Messages inbox on this thread, read only (Wyatt,
// 2026-11-03). Only offered when the admin is looking at the site's own
// database, since the inbox always reads that one.
function InboxLink({ person, threadId, label }) {
  if (!person?.id) return null;
  return (
    <a
      href={`/?messages=1&messagesAs=${person.id}&thread=${threadId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
    >
      {label}
    </a>
  );
}

function ThreadDetail({ detail, dbTarget, siteDb, onChanged, onOpenThread }) {
  const { thread, people, messages, blockedAttempts, refusedReplies = [], replySenders = [] } = detail;
  const agent = thread.kind === "agent";
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const landlord = people.find((p) => p.side === "landlord");
  const student = people.find((p) => p.side === "student");

  // Messages and blocked attempts on one timeline.
  const timeline = useMemo(() => {
    const items = [
      ...messages.map((m) => ({ kind: "message", at: m.createdAt, m })),
      ...blockedAttempts.map((e) => ({ kind: "blocked", at: e.createdAt, e })),
      ...refusedReplies.map((r) => ({ kind: "refused", at: r.receivedAt, r })),
    ];
    return items.sort((a, b) => new Date(a.at) - new Date(b.at));
  }, [messages, blockedAttempts, refusedReplies]);

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
            <Badge color="gray">{student || !thread.visitor ? "student" : "visitor"}</Badge>{" "}
            <span className="font-medium text-gray-900">{student || !thread.visitor ? personLabel(student) : visitorLabel(thread.visitor)}</span>
            {student?.email && <span className="text-gray-400"> · {student.email}</span>}
            {student?.emailMode && <span className="text-purple-700"> · replying by email</span>}
          </p>
          {agent ? (
            <p>
              <Badge color="purple">agent</Badge> <span className="font-medium text-gray-900">Proxy</span>
            </p>
          ) : (
            <p>
              <Badge color="blue">landlord</Badge> <span className="font-medium text-gray-900">{personLabel(landlord)}</span>
              {landlord?.email && <span className="text-gray-400"> · {landlord.email}</span>}
              {landlord?.emailMode && <span className="text-purple-700"> · replying by email</span>}
              {thread.fromTour && <> <Badge color="green">From a tour</Badge></>}
            </p>
          )}
        </div>
        {dbTarget === siteDb && (student || (!agent && landlord)) && (
          <p className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
            <span className="text-gray-400">See it exactly as they do (read only):</span>
            <InboxLink person={student} threadId={thread.id} label="Student's inbox" />
            {!agent && <InboxLink person={landlord} threadId={thread.id} label="Landlord's inbox" />}
          </p>
        )}
        {thread.tours?.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
            {thread.tours.map((t) => {
              const other = agent ? t.directThreadId : t.proxyThreadId;
              return (
                <span key={t.id} className="inline-flex items-center gap-1.5">
                  <Badge color={t.status === "confirmed" ? "green" : "gray"}>tour {t.status}</Badge>
                  {t.confirmedSlot && <span>{fmtWhen(t.confirmedSlot)}</span>}
                  {other && (
                    <button type="button" onClick={() => onOpenThread(agent ? "direct" : "agent", other)} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
                      {agent ? "Open the chat with the landlord" : "Open the student's Proxy chat"}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-[11px] text-gray-400">
          {messages.length} message{messages.length === 1 ? "" : "s"}
          {flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ""}
          {blockedAttempts.length > 0 ? ` · ${blockedAttempts.length} blocked before sending` : ""}
          {refusedReplies.length > 0 ? ` · ${refusedReplies.length} emailed repl${refusedReplies.length === 1 ? "y" : "ies"} not posted` : ""}
          {` · started ${fmtWhen(thread.createdAt)}`}
        </p>
        <ReplySendersList senders={replySenders} landlordId={thread.landlordId} dbTarget={dbTarget} onChanged={onChanged} />
      </div>

      <div className="space-y-2">
        {timeline.length === 0 && <p className="py-10 text-center text-sm text-gray-400">No messages in this thread.</p>}
        {timeline.map((item) =>
          item.kind === "message" ? (
            <Message
              key={item.m.id}
              m={item.m}
              sender={item.m.fromProxy ? null : byId.get(item.m.senderId)}
              isLandlord={!!thread.landlordId && item.m.senderId === thread.landlordId}
              visitor={thread.visitor}
            />
          ) : item.kind === "refused" ? (
            <RefusedReply key={item.r.id} r={item.r} dbTarget={dbTarget} onChanged={onChanged} />
          ) : (
            <BlockedAttempt key={item.e.id} e={item.e} sender={byId.get(item.e.userId)} />
          )
        )}
      </div>
    </div>
  );
}

/* ---- landlords with their listing's agent -------------------------------- */

function LandlordChatRow({ c, selected, onSelect }) {
  const waiting = c.openQuestions + c.openTours;
  return (
    <button
      type="button"
      onClick={() => onSelect(c.key)}
      className={`w-full text-left px-3 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 ${
        selected ? "bg-blue-50 hover:bg-blue-50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <p className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">
          {personLabel(c.landlord)} <span className="text-gray-400 font-normal">with</span> the agent
        </p>
        {waiting > 0 && <Badge color="red" title="Open questions and tour requests waiting on the landlord">{waiting} waiting</Badge>}
      </div>
      <p className="text-[11px] text-gray-500 truncate">{listingLabel(c.listing)}</p>
      <p className="text-[11px] text-gray-400">
        {c.questions} question{c.questions === 1 ? "" : "s"} · {c.tours} tour{c.tours === 1 ? "" : "s"} · {c.notes} message{c.notes === 1 ? "" : "s"} to the agent
        {c.lastAt ? ` · last ${fmtWhen(c.lastAt)}` : ""}
      </p>
    </button>
  );
}

const QUESTION_STATE = { open: ["red", "waiting on the landlord"], answered: ["green", "answered"], unroutable: ["gray", "no landlord to ask"] };

function ExchangeLine({ e, onOpenThread }) {
  const landlord = e.from === "landlord";
  return (
    <div className={`rounded-md px-2.5 py-1.5 text-sm ${landlord ? "bg-blue-50/60" : "bg-gray-50"}`}>
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
        <span className="font-semibold text-gray-800">{landlord ? "Landlord" : e.student ? personLabel(e.student) : "Student"}</span>
        {e.kind && e.kind !== "answer" && <Badge color="gray">{String(e.kind).replace(/_/g, " ")}</Badge>}
        {e.via === "email" && <Badge color="purple">via email</Badge>}
        <span>{fmtWhen(e.at)}</span>
        {!landlord && e.threadId && (
          <button type="button" onClick={() => onOpenThread("agent", e.threadId)} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
            their Proxy chat
          </button>
        )}
      </div>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-gray-900">{e.body}</p>
    </div>
  );
}

function LandlordChatDetail({ chat, onOpenThread }) {
  const { landlord, listing, items } = chat;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
        <p className="text-sm font-semibold text-gray-900">{listingLabel(listing)}</p>
        {listing?.address && listing?.title && <p className="text-[11px] text-gray-500">{listing.address}</p>}
        <p className="mt-2 text-xs text-gray-600">
          <Badge color="blue">landlord</Badge> <span className="font-medium text-gray-900">{personLabel(landlord)}</span>
          {landlord?.email && <span className="text-gray-400"> · {landlord.email}</span>}
          <span className="text-gray-400"> with the listing&apos;s agent</span>
        </p>
        <p className="mt-2 text-[11px] text-gray-400">
          {items.filter((i) => i.kind === "question").length} questions · {items.filter((i) => i.kind === "tour").length} tours ·{" "}
          {items.filter((i) => i.kind === "note").length} messages with the agent
        </p>
      </div>

      <div className="space-y-2">
        {items.length === 0 && <p className="py-10 text-center text-sm text-gray-400">Nothing in this chat.</p>}
        {items.map((i) => {
          if (i.kind === "question") {
            const [color, label] = i.waitingOnStudent ? ["amber", "waiting on the student"] : QUESTION_STATE[i.status] ?? ["gray", i.status];
            return (
              <div key={`q-${i.id}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
                  <span className="font-semibold text-gray-800">Question from Proxy</span>
                  <Badge color={color}>{label}</Badge>
                  {i.askedCount > 1 && <Badge color="gray">asked {i.askedCount} times</Badge>}
                  <span>{fmtWhen(i.askedAt)}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-gray-900 whitespace-pre-wrap break-words">{i.question}</p>
                {i.context && <p className="text-[11px] text-gray-500">{i.context}</p>}
                {i.askedBy.length > 0 && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500">
                    Asked by
                    {i.askedBy.map((w) => (
                      <button key={w.threadId} type="button" onClick={() => onOpenThread("agent", w.threadId)} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
                        {w.student ? personLabel(w.student) : `Visitor ${shortId(w.visitorId)}`}
                      </button>
                    ))}
                  </p>
                )}
                {i.exchange.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {i.exchange.map((e, n) => <ExchangeLine key={`${i.id}-${n}`} e={e} onOpenThread={onOpenThread} />)}
                  </div>
                )}
              </div>
            );
          }
          if (i.kind === "tour") {
            return (
              <div key={`t-${i.id}`} className="rounded-lg border border-green-200 bg-green-50/40 px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
                  <span className="font-semibold text-gray-800">Tour request from {personLabel(i.student)}</span>
                  <Badge color={i.status === "confirmed" ? "green" : i.status === "cancelled" || i.status === "expired" ? "gray" : "amber"}>
                    {i.status === "messaging" ? "talking directly" : i.cancelledBy ? `cancelled by the ${i.cancelledBy}` : i.status}
                  </Badge>
                  <span>{fmtWhen(i.at)}</span>
                </div>
                <p className="mt-1 text-sm text-gray-900">
                  {i.confirmedText ? `Confirmed for ${i.confirmedText}.` : `${i.slots} hour${i.slots === 1 ? "" : "s"} of availability offered.`}
                </p>
                <p className="mt-1 flex flex-wrap gap-3 text-[11px]">
                  {i.directThreadId && (
                    <button type="button" onClick={() => onOpenThread("direct", i.directThreadId)} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
                      Open the direct chat
                    </button>
                  )}
                  {i.proxyThreadId && (
                    <button type="button" onClick={() => onOpenThread("agent", i.proxyThreadId)} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
                      Open the student&apos;s Proxy chat
                    </button>
                  )}
                </p>
              </div>
            );
          }
          const landlordSaid = i.from === "landlord";
          return (
            <div key={`n-${i.id}`} className={`rounded-lg border px-3 py-2 ${landlordSaid ? "border-blue-100 bg-blue-50/40" : "border-purple-100 bg-purple-50/40"}`}>
              <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
                <span className={`font-semibold ${landlordSaid ? "text-blue-800" : "text-purple-800"}`}>{landlordSaid ? personLabel(landlord) : "Agent"}</span>
                <Badge color={landlordSaid ? "blue" : "purple"}>{landlordSaid ? "landlord" : "agent"}</Badge>
                {i.questionId && <Badge color="gray">on a question</Badge>}
                {i.tourId && <Badge color="gray">on a tour</Badge>}
                {i.proposalStatus && <Badge color="gray">change {i.proposalStatus}</Badge>}
                <span>{fmtWhen(i.at)}</span>
              </div>
              <p className="mt-1 text-sm text-gray-900 whitespace-pre-wrap break-words">{i.body}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- tours ---------------------------------------------------------------- */

// Every stage a tour request can be in, in the order an admin cares about:
// what is stuck first, then what is booked, then what ended.
const TOUR_GROUPS = [
  { key: "waiting", label: "Waiting on the landlord", match: (t) => t.status === "requested" || t.status === "proposed",
    note: "The student sent their availability; the landlord has not confirmed a time or written back yet." },
  { key: "messaging", label: "Landlord wrote instead", match: (t) => t.status === "messaging",
    note: "The landlord could not make the student's times and is talking it through in their direct chat." },
  { key: "upcoming", label: "Upcoming", match: (t) => t.status === "confirmed" && t.upcoming },
  { key: "past", label: "Past", match: (t) => t.status === "confirmed" && !t.upcoming },
  { key: "cancelled", label: "Cancelled", match: (t) => t.status === "cancelled" },
  { key: "expired", label: "Expired", match: (t) => t.status === "expired",
    note: "Nobody confirmed a time before the student's available days passed." },
];

function ageText(iso) {
  if (!iso) return "";
  const hours = (Date.now() - Date.parse(iso)) / 3600000;
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} days`;
}

function TourRow({ t, group, onOpenThread }) {
  const waitingHours = (Date.now() - Date.parse(t.createdAt)) / 3600000;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 border-b border-gray-100 last:border-b-0">
      <div className="w-56 shrink-0">
        {t.status === "confirmed" ? (
          <>
            <p className="text-sm font-medium text-gray-900">{t.confirmedText ?? "No time"}</p>
            <p className="text-[11px] text-gray-400">Central time</p>
          </>
        ) : group === "waiting" ? (
          <>
            <p className={`text-sm font-medium ${waitingHours > 24 ? "text-red-700" : "text-gray-900"}`}>Waiting {ageText(t.createdAt)}</p>
            <p className="text-[11px] text-gray-400">Asked {fmtWhen(t.createdAt)}</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-900">{TOUR_GROUPS.find((g) => g.key === group)?.label}</p>
            <p className="text-[11px] text-gray-400">Last activity {fmtWhen(t.lastActivityAt)}</p>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-gray-900">{listingLabel(t.listing)}</p>
        <p className="truncate text-[11px] text-gray-500">
          {personLabel(t.student)} <span className="text-gray-400">with</span> {t.landlord ? personLabel(t.landlord) : <span className="text-red-700">no landlord to ask</span>}
        </p>
        {t.status !== "confirmed" && t.availabilityText && (
          <p className="truncate text-[11px] text-gray-500"><span className="text-gray-400">Student can tour:</span> {t.availabilityText}</p>
        )}
        {t.status === "cancelled" && (
          <p className="truncate text-[11px] text-gray-500">
            <span className="text-gray-400">Cancelled by</span> {t.cancelledBy ?? "unknown"}{t.cancelReason ? `: "${t.cancelReason}"` : ""}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-3 text-[11px]">
        {t.directThreadId ? (
          <button type="button" onClick={() => onOpenThread("direct", t.directThreadId)} className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900">
            Open conversation
          </button>
        ) : (
          <span className="text-gray-400">No direct chat yet</span>
        )}
        {t.proxyThreadId && (
          <button type="button" onClick={() => onOpenThread("agent", t.proxyThreadId)} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">
            Proxy chat
          </button>
        )}
      </div>
    </div>
  );
}

function ToursList({ tours, search, onOpenThread }) {
  const [only, setOnly] = useState(null);
  const q = search.trim().toLowerCase();
  const shown = tours.filter((t) => !q || [t.student?.name, t.student?.email, t.landlord?.name, t.landlord?.email, t.listing?.title, t.listing?.address, t.id]
    .some((v) => (v || "").toLowerCase().includes(q)));
  const groups = TOUR_GROUPS.map((g) => ({ ...g, list: shown.filter(g.match) }));
  const visible = only ? groups.filter((g) => g.key === only) : groups;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1">
        <Pill on={!only} onClick={() => setOnly(null)}>All ({shown.length})</Pill>
        {groups.map((g) => (
          <Pill key={g.key} on={only === g.key} onClick={() => setOnly(only === g.key ? null : g.key)} tone={g.key === "waiting" && g.list.length ? "red" : "gray"}>
            {g.label} ({g.list.length})
          </Pill>
        ))}
      </div>
      {visible.map((g) => (
        <section key={g.key} className="space-y-1.5">
          <h3 className="text-xs font-semibold text-gray-700">{g.label} <span className="font-normal text-gray-400">({g.list.length})</span></h3>
          {g.note && <p className="text-[11px] text-gray-400">{g.note}</p>}
          {g.list.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 py-6 text-center text-xs text-gray-400">None.</p>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              {g.list.map((t) => <TourRow key={t.id} t={t} group={g.key} onOpenThread={onOpenThread} />)}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/* ---- the view ------------------------------------------------------------- */

const TABS = [
  { key: "agent", label: "Agent conversations" },
  { key: "direct", label: "Person to person" },
  { key: "tours", label: "Tours" },
];

// The tab and what is open, read from and written back to the URL.
function readUrl() {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const tab = TABS.some((t) => t.key === p.get("tab")) ? p.get("tab") : null;
  return { tab, side: p.get("side") === "landlords" ? "landlords" : "students", thread: p.get("thread"), chat: p.get("chat") };
}

function writeUrl({ tab, side, thread, chat }) {
  const p = new URLSearchParams(window.location.search);
  p.set("tab", tab);
  for (const k of ["side", "thread", "chat"]) p.delete(k);
  if (tab === "agent") p.set("side", side);
  if (thread && tab !== "tours") p.set("thread", thread);
  if (chat && tab === "agent" && side === "landlords") p.set("chat", chat);
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${p.toString()}`);
}

function Pill({ on, onClick, children, tone = "gray" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 text-[11px] rounded-full border ${
        on ? (tone === "red" ? "bg-red-700 border-red-700 text-white" : "bg-gray-800 border-gray-800 text-white") : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

export default function ConversationsView({ search, dbTarget }) {
  const [tab, setTab] = useState("agent");
  const [side, setSide] = useState("students");
  const [selectedId, setSelectedId] = useState(null);
  const [chatKey, setChatKey] = useState(null);
  const [ready, setReady] = useState(false);

  const [lists, setLists] = useState({}); // kind -> threads
  const [listError, setListError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [landlordChats, setLandlordChats] = useState(null);
  const [chat, setChat] = useState(null);
  const [tours, setTours] = useState(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [siteDb, setSiteDb] = useState(null);

  // Which database this site itself reads, so inbox links only show when it
  // is the one the admin is looking at.
  useEffect(() => {
    fetch("/api/admin/db-env").then((r) => r.json()).then((d) => setSiteDb(d?.env ?? null)).catch(() => {});
  }, []);

  // Open on whatever the URL names.
  useEffect(() => {
    const u = readUrl();
    if (u.tab) setTab(u.tab);
    setSide(u.side);
    if (u.thread) setSelectedId(u.thread);
    if (u.chat) setChatKey(u.chat);
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) writeUrl({ tab, side, thread: selectedId, chat: chatKey });
  }, [ready, tab, side, selectedId, chatKey]);

  // A new database starts from nothing.
  useEffect(() => {
    setLists({});
    setLandlordChats(null);
    setTours(null);
    setListError(null);
  }, [dbTarget]);

  const threadKind = tab === "direct" ? "direct" : tab === "agent" && side === "students" ? "agent" : null;

  useEffect(() => {
    if (!ready || !threadKind || lists[threadKind]) return;
    let cancelled = false;
    adminFetch(`/api/admin/chat/threads?kind=${threadKind}`, dbTarget)
      .then((d) => { if (!cancelled) setLists((l) => ({ ...l, [threadKind]: Array.isArray(d) ? d : [] })); })
      .catch((err) => { if (!cancelled) setListError(err.message); });
    return () => { cancelled = true; };
  }, [ready, threadKind, dbTarget, lists]);

  useEffect(() => {
    if (!ready || tab !== "agent" || side !== "landlords" || landlordChats) return;
    let cancelled = false;
    adminFetch("/api/admin/agents/landlord-chats", dbTarget)
      .then((d) => { if (!cancelled) setLandlordChats(Array.isArray(d) ? d : []); })
      .catch((err) => { if (!cancelled) setListError(err.message); });
    return () => { cancelled = true; };
  }, [ready, tab, side, dbTarget, landlordChats]);

  useEffect(() => {
    if (!ready || tab !== "tours" || tours) return;
    let cancelled = false;
    adminFetch("/api/admin/tours?status=all", dbTarget)
      .then((d) => { if (!cancelled) setTours(Array.isArray(d) ? d : []); })
      .catch((err) => { if (!cancelled) setListError(err.message); });
    return () => { cancelled = true; };
  }, [ready, tab, dbTarget, tours]);

  useEffect(() => {
    if (!threadKind || !selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetailError(null);
    adminFetch(`/api/admin/chat/threads/${selectedId}`, dbTarget)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => { if (!cancelled) setDetailError(err.message); });
    return () => { cancelled = true; };
  }, [threadKind, selectedId, dbTarget, reloadKey]);

  useEffect(() => {
    if (tab !== "agent" || side !== "landlords" || !chatKey) { setChat(null); return; }
    const [landlordId, listingId] = chatKey.split(":");
    let cancelled = false;
    setDetailError(null);
    setChat(null);
    adminFetch(`/api/admin/agents/landlord-chats?landlordId=${encodeURIComponent(landlordId)}&listingId=${encodeURIComponent(listingId)}`, dbTarget)
      .then((d) => { if (!cancelled) setChat(d); })
      .catch((err) => { if (!cancelled) setDetailError(err.message); });
    return () => { cancelled = true; };
  }, [tab, side, chatKey, dbTarget]);

  // A new selection starts from a blank detail; a reload after an action keeps
  // the old one on screen until the fresh copy arrives.
  useEffect(() => { setDetail(null); }, [selectedId, dbTarget]);

  // From a tour or a question card straight to that conversation.
  const openThread = (kind, id) => {
    setListError(null);
    if (kind === "agent") { setTab("agent"); setSide("students"); }
    else setTab("direct");
    setSelectedId(id);
  };
  const pickTab = (key) => {
    if (key === tab) return;
    setListError(null);
    setTab(key);
    setSelectedId(null);
  };
  const pickSide = (value) => {
    if (value === side) return;
    setSide(value);
    setSelectedId(null);
  };

  const threads = threadKind ? lists[threadKind] ?? null : null;
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return (threads ?? []).filter((t) => {
      if (flaggedOnly && t.flagged === 0 && t.blocked === 0) return false;
      if (!includeDeleted && t.deletedAt) return false;
      if (!q) return true;
      return [
        t.student?.name, t.student?.email, t.landlord?.name, t.landlord?.email, t.visitor?.email,
        t.listing?.title, t.listing?.address, t.subject, t.id,
      ].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [threads, flaggedOnly, includeDeleted, q]);
  const filteredChats = useMemo(() => (landlordChats ?? []).filter((c) => !q || [c.landlord?.name, c.landlord?.email, c.listing?.title, c.listing?.address]
    .some((v) => (v || "").toLowerCase().includes(q))), [landlordChats, q]);

  const totalFlagged = (threads ?? []).filter((t) => t.flagged > 0 || t.blocked > 0).length;
  const landlordSide = tab === "agent" && side === "landlords";

  const tabBar = (
    <div className="flex items-center gap-1 border-b border-gray-200">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => pickTab(t.key)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            tab === t.key ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  let body;
  if (listError) {
    body = <p className="py-10 text-center text-sm text-red-600">{listError}</p>;
  } else if (tab === "tours") {
    body = !tours
      ? <p className="py-20 text-center text-sm text-gray-400">Loading tours…</p>
      : <ToursList tours={tours} search={search} onOpenThread={openThread} />;
  } else if (landlordSide ? !landlordChats : !threads) {
    body = <p className="py-20 text-center text-sm text-gray-400">Loading conversations…</p>;
  } else {
    body = (
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {tab === "agent" && (
            <div className="flex items-center gap-1">
              <Pill on={side === "students"} onClick={() => pickSide("students")}>Students with Proxy</Pill>
              <Pill on={side === "landlords"} onClick={() => pickSide("landlords")}>Landlords with their agent</Pill>
            </div>
          )}
          <p className="text-xs text-gray-500">
            {landlordSide
              ? `${filteredChats.length} of ${landlordChats.length} landlord chats`
              : `${filtered.length} of ${threads.length} conversations${totalFlagged > 0 ? ` · ${totalFlagged} with flags` : ""}`}
          </p>
          {!landlordSide && (
            <div className="ml-auto flex items-center gap-2">
              <Pill on={flaggedOnly} onClick={() => setFlaggedOnly((v) => !v)} tone="red">Flagged only</Pill>
              <Pill on={includeDeleted} onClick={() => setIncludeDeleted((v) => !v)}>Include deleted</Pill>
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-[320px_1fr] gap-3 items-start">
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden md:max-h-[75vh] md:overflow-y-auto">
            {landlordSide ? (
              filteredChats.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-400">No landlord chats match.</p>
              ) : (
                filteredChats.map((c) => <LandlordChatRow key={c.key} c={c} selected={c.key === chatKey} onSelect={setChatKey} />)
              )
            ) : filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">No conversations match.</p>
            ) : (
              filtered.map((t) => <ThreadRow key={t.id} t={t} selected={t.id === selectedId} onSelect={setSelectedId} />)
            )}
          </div>

          <div className="min-w-0">
            {landlordSide ? (
              !chatKey ? (
                <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center text-sm text-gray-400">
                  Select a landlord chat on the left to read it.
                </div>
              ) : detailError ? (
                <p className="py-10 text-center text-sm text-red-600">{detailError}</p>
              ) : !chat ? (
                <p className="py-16 text-center text-sm text-gray-400">Loading chat…</p>
              ) : (
                <LandlordChatDetail chat={chat} onOpenThread={openThread} />
              )
            ) : !selectedId ? (
              <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center text-sm text-gray-400">
                Select a conversation on the left to read it.
              </div>
            ) : detailError ? (
              <p className="py-10 text-center text-sm text-red-600">{detailError}</p>
            ) : !detail ? (
              <p className="py-16 text-center text-sm text-gray-400">Loading conversation…</p>
            ) : (
              <ThreadDetail detail={detail} dbTarget={dbTarget} siteDb={siteDb} onChanged={() => setReloadKey((k) => k + 1)} onOpenThread={openThread} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tabBar}
      {body}
    </div>
  );
}
