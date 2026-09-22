"use client";

/*
 * Shown after a signed-out visitor clicks Check My Lease: the lease is already
 * uploaded (LeaseCheckClient saved it to lib/leaseCheck/pendingCheck before opening
 * this), we just haven't run the analysis yet. Mirrors components/listings/add/
 * PublishGate — same reasoning: ask for an account only once the expensive/valuable
 * part is already done, so it reads as a last small step rather than a wall.
 *
 * Nothing has been analyzed yet — say so plainly, never "results are ready".
 */

import AuthCard from "@/components/auth/AuthCard";

export const LEASE_CHECK_RESUME_URL = "/lease-check";

export default function LeaseAuthGate({ saved, onCancel }) {
  return (
    <div className="mt-6 max-w-3xl rounded-xl border border-red-100 bg-red-50/40 p-5" data-lease-auth-gate>
      <h3 className="text-base font-semibold text-gray-900">Your results are almost ready</h3>
      <p className="mb-4 mt-1 text-sm text-gray-600">
        Your lease is uploaded. Sign in or create a free account and we&apos;ll pick up right
        where you left off and run the check. Already have an account? Use the Sign In tab.
      </p>

      {!saved && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Your browser is not letting us hold your place, so you may need to upload again after
          signing in.
        </p>
      )}

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <AuthCard bare initialTab="signup" callbackUrl={LEASE_CHECK_RESUME_URL} />
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="mt-3 w-full py-2 text-sm font-medium text-gray-500 transition hover:text-gray-700"
      >
        Cancel and start over
      </button>
    </div>
  );
}
