// Small presentation helpers shared by the messaging screens. The data shapes
// come from the chat routes (rpc_list_chat_threads / rpc_get_chat_messages).

export const CHAT_MAX_BODY = 5000;

// Same opening line the web composer starts with.
export function defaultListingInquiry(ownerName) {
  const firstName = ownerName?.trim().split(/\s+/)[0];
  return firstName
    ? `Hi ${firstName}, I'm interested in this listing.`
    : "Hi, I'm interested in this listing.";
}

// Inbox timestamp: time of day for today, weekday within the last week,
// otherwise a short date.
export function formatThreadTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const dayMs = 24 * 60 * 60 * 1000;
  if (now - date < 6 * dayMs) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatMessageTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// One-line inbox preview of the latest message.
export function threadPreview(thread) {
  const body = thread?.lastMessageBody?.trim();
  if (!body) return "No messages yet";
  return thread.lastMessageMine ? `You: ${body}` : body;
}

// Which property an inbox row is about.
export function threadListingLabel(thread) {
  if (thread?.listingCount > 1) return `${thread.listingCount} properties`;
  return thread?.listingTitle || thread?.listingAddress || null;
}

// Merge message lists by id, oldest first.
export function mergeMessages(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const message of list ?? []) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

// The lease to route a new enquiry through. A unit can carry several competing
// leases from different landlords, and the lease decides the recipient. The
// mobile detail screen has no lease picker, so a lease is only named when every
// live lease belongs to one owner (nothing to choose between). With competing
// owners it returns null and the server routes to the listing's primary
// landlord, which is the person the screen names.
export function leaseForChat(listing) {
  const leases = (listing?.unitTypes ?? []).flatMap((unit) => unit.leases ?? []);
  if (leases.length === 0) return null;
  const owners = new Set(leases.map((lease) => lease.ownerId ?? null));
  return owners.size === 1 ? leases[0] : null;
}

export function chatErrorMessage(err, fallback) {
  return err?.body?.error ?? err?.message ?? fallback;
}
