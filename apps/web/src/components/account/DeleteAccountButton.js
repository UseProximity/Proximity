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

export default function DeleteAccountButton({ className = "" }) {
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
      <div className={`border-t border-gray-200 pt-6 mt-8 ${className}`}>
        <h3 className="text-sm font-semibold text-gray-900">Delete account</h3>
        <p className="text-xs text-gray-500 mt-1 mb-3 max-w-prose">
          Permanently deletes your Proximity account and personal data. Your account stops
          working immediately, and your data is erased after 30 days. This can&apos;t be undone.
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
        >
          Delete Account
        </button>
      </div>

      <Modal isOpen={confirming} onClose={() => !deleting && setConfirming(false)}>
        <div className="p-6">
          <h2 className="text-lg font-bold text-gray-900">Are you sure?</h2>
          <p className="text-sm text-gray-600 mt-2">
            This permanently deletes your Proximity account. Your account stops working
            immediately and your personal data is erased after 30 days. This can&apos;t be undone.
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
