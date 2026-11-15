"use client";

/*
 * Apply, beside Tour in the Proxy input and beside Send message in the plain
 * contact form (Wyatt, 2026-11-14). It opens the landlord's own application
 * (their portal or form) in a new tab and records that this student went to
 * it. Renders nothing when no landlord on the listing has added a link.
 *
 * Signed out, it asks them to sign in first, so every Apply is tied to a
 * student. The owner's own preview and Proxy's test mode open the link but
 * record nothing. The tab opens inside the click itself (before any await),
 * or the browser would block it as a popup.
 */
import { signIn } from "next-auth/react";
import { Pen } from "lucide-react";
import { pickApplication } from "@/lib/listings/applicationLink";
import { trackEvent } from "@/utils/analytics";

export const APPLY_CLICKED_EVENT = "proximity:apply-clicked";

const STYLES = {
  // Same size and border as Tour beside it.
  chat: "h-11 rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50",
  form: "rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50",
};

export default function ApplyButton({ listing, selectedLease = null, signedIn, record = true, variant = "chat", className = "" }) {
  const app = pickApplication(listing, selectedLease);
  if (!app) return null;
  const listingId = listing?._id ?? listing?.id;

  const onClick = () => {
    if (!signedIn) { signIn(); return; }
    window.open(app.url, "_blank", "noopener,noreferrer");
    if (!record) return;
    trackEvent("Application Started", { listing_id: listingId });
    window.dispatchEvent(new CustomEvent(APPLY_CLICKED_EVENT, { detail: { listingId } }));
    fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId, leaseId: app.leaseId }),
      keepalive: true,
    }).catch(() => {});
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={signedIn ? "Apply on the landlord's application (opens in a new tab)" : "Sign in to apply"}
      title={signedIn ? "Opens the landlord's application in a new tab" : "Sign in to apply"}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 ${STYLES[variant] ?? STYLES.chat} ${className}`}
    >
      <Pen className={variant === "chat" ? "h-5 w-5" : "h-4 w-4"} />
      Apply
    </button>
  );
}
