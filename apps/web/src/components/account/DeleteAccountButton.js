"use client";

/*
 * Danger-zone control for permanent account deletion.
 *
 * Shared by both dashboards (student and landlord) so the copy, the
 * confirmation step, and the post-delete sign-out behave identically wherever
 * it appears. Calls DELETE /api/account — see that route for what deletion
 * actually does: the account stops authenticating immediately, and the personal
 * data is purged after a 30-day grace period by the purge-accounts cron.
 *
 * Deliberately requires an explicit confirmation click rather than deleting on
 * the first press: this is irreversible from the user's point of view, and both
 * app stores expect deletion to be a considered action.
 */
import { useState } from "react";
import { signOut } from "next-auth/react";
import Modal from "@/components/ui/Modal";

// variant "inline" (default) is a plain divided section; "card" is a self-contained
// danger-zone card for dashboard placement; "card-wide" is the same card laid out
// for a full-width container (text left, button right on md and up). Behavior is
// identical in all three.
export default function DeleteAccountButton({ className = "", variant = "inline" }) {
  const isWide = variant === "card-wide";
  const isCard = variant === "card" || isWide;
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Couldn't delete your account. Please try again.");
      }
      // The account no longer authenticates server-side, so clear the session
      // rather than leaving a cookie that can only 401 from here on.
      await signOut({ callbackUrl: "/" });
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  }

  return (
    <>
      <div
        className={
          isCard
            ? `bg-white rounded-xl border p-5 ${
                isWide
                  ? "border-gray-200 md:grid md:grid-cols-[1fr_auto] md:items-center md:gap-x-8"
                  : "border-red-200"
              } ${className}`
            : `border-t border-gray-200 pt-6 mt-8 ${className}`
        }
      >
        {isCard && (
          <p
            className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
              isWide ? "text-gray-500" : "text-red-600"
            }`}
          >
            Danger zone
          </p>
        )}
        <h3 className="text-sm font-semibold text-gray-900">Delete account</h3>
        <p
          className={`text-xs text-gray-500 mt-1 mb-3 ${
            isWide ? "max-w-3xl md:mb-0" : "max-w-prose"
          }`}
        >
          Permanently deletes your Proximity account and personal data. Your account stops
          working immediately, and your personal data is erased after 30 days, except some records we
          keep for up to three years (see our Privacy Policy). This can&apos;t be undone.
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className={
            isCard
              ? `px-4 py-2 rounded-xl border border-red-300 text-red-700 hover:bg-red-50 text-sm font-semibold transition-colors ${
                  isWide ? "md:col-start-2 md:row-span-3 md:row-start-1 md:self-center" : ""
                }`
              : "px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
          }
        >
          Delete Account
        </button>
      </div>

      <Modal isOpen={confirming} onClose={() => !deleting && setConfirming(false)}>
        <div className="p-6">
          <h2 className="text-lg font-bold text-gray-900">Are you sure?</h2>
          <p className="text-sm text-gray-600 mt-2">
            This permanently deletes your Proximity account. Your account stops working
            immediately and your personal data is erased after 30 days, except some records we keep for
            up to three years (see our Privacy Policy). This can&apos;t be undone.
          </p>

          {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

          <div className="flex gap-3 pt-5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              Keep my account
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
