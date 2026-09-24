"use client";

/*
 * The account step of Add Listing, shown when a signed-out visitor presses
 * Publish.
 *
 * They have described the whole listing by now, which is the point: asking for
 * an account here, rather than before the first field, is what makes signing up
 * feel like the last small step instead of a wall.
 *
 * Nothing is published from here. AddListingFlow keeps the answers in
 * localStorage (lib/listings/pendingDraft), the sign-in or sign-up leaves the
 * page, and RESUME_URL is where it comes back to: the flow restores the draft on
 * the last step and the person publishes with one click.
 *
 * The email starts as the contact email they gave, but is only a starting point.
 * Signing in with Google or with another address is fine, and the flow flags the
 * difference on the way back rather than blocking it.
 */

import AuthCard from "@/components/auth/AuthCard";

// `resume` is what lets a brand-new account (which starts as a student until it
// is corrected to a landlord) back into /add-listing. See app/add-listing/layout.js.
export const RESUME_URL = "/add-listing?mode=manual&step=lease&resume=1";

export default function PublishGate({ email, saved, onBack }) {
  return (
    <div className="mt-5 rounded-xl border border-red-100 bg-red-50/40 p-5" data-publish-gate>
      <h3 className="text-base font-semibold text-gray-900">Your listing is ready</h3>
      <p className="mb-4 mt-1 text-sm text-gray-600">
        Create a free account to publish it. Everything you entered is saved, and you pick up
        right here once you are signed in. Already have an account? Use the Sign In tab.
      </p>

      {!saved && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Your browser is not letting us save your answers, so you will need to enter them again
          after signing in.
        </p>
      )}

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <AuthCard
          bare
          initialTab="signup"
          initialEmail={email}
          defaultRole="landlord"
          callbackUrl={RESUME_URL}
        />
      </div>

      <button
        type="button"
        onClick={onBack}
        className="mt-3 w-full py-2 text-sm font-medium text-gray-500 transition hover:text-gray-700"
      >
        Keep editing
      </button>
    </div>
  );
}
