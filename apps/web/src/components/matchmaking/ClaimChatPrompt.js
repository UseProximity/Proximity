"use client";

// Shown to a signed-in student when this browser holds a chat someone ran while
// signed out that no account owns yet, and they did not arrive through the
// sign-up wall (which claims on its own). Asking instead of claiming silently
// keeps a shared or borrowed computer from handing one person's chat, budget
// and notes to whoever signs in next. Only the date is shown, never the chat.
export default function ClaimChatPrompt({ offer, busy, onClaim, onDismiss }) {
  if (!offer) return null;
  const when = offer.latestAt
    ? new Date(offer.latestAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  const what = offer.count === 1 ? "a chat" : `${offer.count} chats`;
  return (
    <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 bg-red-50 border-b border-red-100">
      <p className="flex-1 text-xs text-gray-700 leading-relaxed">
        This browser has {what} with Proxy from before you signed in{when ? ` (started ${when})` : ""}. Add{" "}
        {offer.count === 1 ? "it" : "them"} to your account?
      </p>
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onDismiss}
          disabled={busy}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 transition disabled:opacity-50"
        >
          Not mine
        </button>
        <button
          onClick={onClaim}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition disabled:opacity-50"
        >
          {busy ? "Adding..." : offer.count === 1 ? "Add it" : "Add them"}
        </button>
      </div>
    </div>
  );
}
