"use client";

/*
 * One held knowledge change in the admin Agents queue (Wyatt, 2026-11-12):
 * where it came from, the message a landlord sent and who sent it, and each
 * change as "On Proximity now" next to "Proposed", with the words that differ
 * marked. Shaped by lib/agents/queueView.js.
 */

const CAUSES = {
  sync: "Website sync",
  landlord_chat: "Landlord told their agent",
  landlord_answer: "Landlord answered a question",
  document: "Uploaded document",
  dashboard: "Dashboard edit",
};
const causeLabel = (c) => CAUSES[c] ?? String(c ?? "").replace(/_/g, " ");

const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const dayTime = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/*
 * Word-level difference between two sentences. Returns the words of each side
 * with the ones that are not shared marked, so a one-word change in a long
 * sentence stands out.
 */
function diffWords(before, after) {
  const a = String(before).split(/\s+/).filter(Boolean);
  const b = String(after).split(/\s+/).filter(Boolean);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const left = [];
  const right = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { left.push({ w: a[i], same: true }); right.push({ w: b[j], same: true }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) left.push({ w: a[i++], same: false });
    else right.push({ w: b[j++], same: false });
  }
  while (i < a.length) left.push({ w: a[i++], same: false });
  while (j < b.length) right.push({ w: b[j++], same: false });
  return { left, right };
}

function Words({ parts, tone }) {
  return parts.map((p, i) => (
    <span key={i}>
      {p.same ? p.w : <mark className={`rounded px-0.5 ${tone}`}>{p.w}</mark>}{" "}
    </span>
  ));
}

function ChangeRow({ change }) {
  const { before, after } = change;
  const diff = before && after ? diffWords(before, after) : null;
  return (
    <div className="grid grid-cols-1 border-t border-gray-100 text-xs sm:grid-cols-[minmax(96px,150px)_1fr_1fr]">
      <span className="px-2 py-1.5 font-medium text-gray-600">{change.label}</span>
      <span className="break-words px-2 py-1.5 text-gray-700">
        {diff ? <Words parts={diff.left} tone="bg-red-100 text-red-800 line-through" /> : before ? before : (
          <span className="italic text-gray-400">
            {change.beforeUnknown
              ? "Not recorded with this request"
              : change.beforeVaries
              ? `Differs by unit or owner (${change.beforeVaries} values)`
              : "Nothing yet (new)"}
          </span>
        )}
      </span>
      <span className="break-words px-2 py-1.5 text-gray-900">
        {diff ? <Words parts={diff.right} tone="bg-green-100 text-green-900" /> : after ? <mark className="rounded bg-green-100 px-0.5 text-green-900">{after}</mark> : change.removed ? (
          <span className="italic text-red-700">Removed</span>
        ) : (
          <span className="italic text-gray-400">Details not recorded</span>
        )}
      </span>
    </div>
  );
}

export default function AgentChangeCard({ event, tone = "white", busy, onDecide }) {
  const { actor, message, changes = [] } = event;
  const who = actor ? [actor.name, actor.email].filter(Boolean).join(", ") : null;

  return (
    <div className={`mb-2 rounded-xl border p-3 text-sm ${tone === "amber" ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
        <span><span className="font-medium text-gray-900">{event.listing}</span> · {causeLabel(event.cause)} · {day(event.createdAt)}</span>
        <span className="flex flex-wrap gap-1">
          {event.flags?.length > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">fair housing: {event.flags.join(", ")}</span>}
          {event.recentClaim && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px]">new owner</span>}
          {actor?.test && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">test account</span>}
        </span>
      </div>

      {(who || message) && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {message ? (message.exact ? "Message sent" : "Their last message before this") : "Sent by"}
          </p>
          {message && <p className="mt-0.5 whitespace-pre-wrap text-gray-900">&ldquo;{message.text}&rdquo;</p>}
          <p className="mt-1 text-xs text-gray-500">
            {who ?? "Unknown sender"}{actor?.role ? ` (${actor.role})` : ""}{message?.at ? ` · ${dayTime(message.at)}` : ""}
          </p>
          {!message && event.cause === "landlord_chat" && (
            <p className="mt-1 text-[11px] italic text-gray-400">The original message was not saved (sent before agent conversations were stored).</p>
          )}
        </div>
      )}

      {changes.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="hidden grid-cols-[minmax(96px,150px)_1fr_1fr] bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:grid">
            <span className="px-2 py-1" />
            <span className="px-2 py-1">On Proximity now</span>
            <span className="px-2 py-1">Proposed</span>
          </div>
          {changes.map((c, i) => <ChangeRow key={`${c.label}-${i}`} change={c} />)}
        </div>
      )}
      {changes.length === 0 && message?.exact && (
        <p className="mt-2 text-xs text-gray-500">Applying saves this statement to the listing&apos;s knowledge as written.</p>
      )}

      {event.excerpt && (
        <p className="mt-2 text-xs text-gray-600"><span className="font-medium text-gray-700">What the page says:</span> &ldquo;{event.excerpt}&rdquo;</p>
      )}
      {event.sourceRef && (
        <p className="mt-1 truncate text-[11px] text-gray-500">
          Source:{" "}
          {/^https?:\/\//.test(event.sourceRef)
            ? <a href={event.sourceRef} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-800">{event.sourceRef}</a>
            : event.sourceRef}
        </p>
      )}
      {event.heldBecause && <p className="mt-1 text-[11px] text-amber-700">Held: {event.heldBecause}</p>}

      <div className="mt-2 flex gap-2">
        <button disabled={busy} onClick={() => onDecide("approve")} className="rounded-lg bg-gray-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">Apply</button>
        <button disabled={busy} onClick={() => onDecide("reject")} className="rounded-lg border border-gray-300 px-3 py-1 text-xs disabled:opacity-50">Reject</button>
      </div>
    </div>
  );
}
