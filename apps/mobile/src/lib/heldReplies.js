// Pure helpers for the landlord's held email replies banner
// (components/chat/HeldRepliesBanner.js). The wording follows the web banner
// (apps/web/src/components/chat/HeldRepliesBanner.js). No imports, so they can be
// tested with Node alone.

// Approving delivers the held replies in the background; the conversation is
// reloaded after each of these delays so they show up even without realtime.
export const RELOAD_DELAYS_MS = [4000, 12000];

export const EMPTY_REPLY_SENDERS = { held: [], senders: [] };

// The server's answer, reduced to the two lists, whatever shape arrives.
export function normalizeReplySenders(data) {
  return {
    held: Array.isArray(data?.held) ? data.held : [],
    senders: Array.isArray(data?.senders) ? data.senders : [],
  };
}

// Runs the GET and returns its lists, or null when it fails. A failure is not "nothing
// held": callers keep what they already have rather than blanking the screen.
export async function fetchReplySenders(get) {
  try {
    return normalizeReplySenders(await get());
  } catch {
    return null;
  }
}

// The lists without the one held reply / sender the server has just handled, so it
// leaves the screen at once instead of waiting for a reload that may fail.
export function withoutHeld(data, heldId) {
  return { ...data, held: (data?.held ?? []).filter((h) => h.id !== heldId) };
}

export function withoutSender(data, senderId) {
  return { ...data, senders: (data?.senders ?? []).filter((s) => s.id !== senderId) };
}

// Senders the landlord has approved (declined ones are not listed).
export function approvedSenders(data) {
  return (data?.senders ?? []).filter((s) => s.decision === "approved");
}

// "Name (address)" when the sender gave a name, otherwise the address.
export function heldReplyWho(held) {
  return held.senderName ? `${held.senderName} (${held.fromEmail})` : held.fromEmail;
}

// Whether the "approve everyone at the company" action applies.
export function canApproveDomain(held) {
  return Boolean(held.canApproveDomain && held.domain);
}

// A sender in the approved list: "anyone @company.com" for a domain, else the address.
export function approvedSenderLabel(sender) {
  return sender.isDomain ? `anyone ${sender.pattern}` : sender.pattern;
}

export function approvedNote(delivering) {
  return (delivering ?? 0) > 1
    ? "Approved. The replies are being delivered."
    : "Approved. The reply is being delivered.";
}

export function declinedNote(fromEmail) {
  return `Done. Nothing from ${fromEmail} will be posted.`;
}

// The banner shows nothing when there is nothing held, nobody approved and no note.
export function bannerHasContent(data, note) {
  return (data?.held?.length ?? 0) > 0 || approvedSenders(data).length > 0 || Boolean(note);
}

// "Oct 24, 3:05 PM" (empty for a missing date).
export function formatReceived(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
