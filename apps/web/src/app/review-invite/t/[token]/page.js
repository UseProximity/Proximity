/*
 * The invited review: /review-invite/t/<token>.
 *
 * A student lands here from an email we sent to exactly one address. The token
 * in the URL is the whole security story: it existed only in that inbox, so
 * opening this page is proof of control over that address, and the review that
 * follows is posted under it rather than under whatever the form is told.
 *
 * That makes this the ONLY review path where the reviewer's identity is
 * established before the review is written. The open /review page has to take a
 * typed school email on trust, which is what an invite replaces.
 *
 * Deliberately NOT the same thing as /review-invite/<landlordId>, which sits one
 * segment up. That link is generic (any tenant, any inbox, sign-in required) and
 * a landlord hands it out themselves. This one is per-person, admin-issued, and
 * needs no account. Both are excluded from indexing by /review-invite/ in
 * robots.js.
 *
 * The token is resolved on the server and never handed to the client beyond the
 * address it unlocks: a page that echoed it into the DOM would put a working
 * credential into any screenshot of it.
 */
import { Suspense } from "react";
import Link from "next/link";
import ReviewFlow from "@/components/reviews/ReviewFlow";
import { resolveInvite } from "@/lib/reviews/invites";

// An invite is personal and single-use, so there is nothing here worth indexing
// or caching. robots.js already excludes the path; this is the belt to its braces.
export const metadata = {
  title: "Write your review | Proximity",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/*
 * One screen for every reason a link can fail, on purpose.
 *
 * Unknown, expired and already-used are not distinguished. Telling a stranger
 * which of their guesses was a real token is exactly the feedback a guesser
 * wants, and the honest recovery is identical in all three cases: the open
 * review page still works.
 */
function DeadLink() {
  return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">This link has expired</h1>
      <p className="text-gray-600">
        Review invites are personal and can only be used once. If you have already
        written your review, it is live and there is nothing left to do.
      </p>
      <Link
        href="/review"
        className="mt-8 inline-block px-5 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
      >
        Write a review anyway
      </Link>
    </div>
  );
}

export default async function InvitedReviewPage({ params }) {
  const { token } = await params;
  const invite = await resolveInvite(token);

  if (!invite) return <DeadLink />;

  return (
    <Suspense fallback={<div className="max-w-xl mx-auto px-4 py-10" />}>
      <ReviewFlow
        callbackUrl={`/review-invite/t/${token}`}
        invite={{
          // The raw token goes back down so the submission can carry it. It is
          // already in this browser's address bar, so nothing new is exposed.
          token,
          email: invite.email,
          prefill: invite.prefill,
        }}
      />
    </Suspense>
  );
}
