"use client";

/*
 * Client half of /review/finish: the same two-step setup the inline flow runs
 * (create the account, then the profile), and where they've landed once it's
 * saved or skipped.
 *
 * Arriving here means opening a link sent to the address, which is what proves
 * they own it, so the page has already marked the email verified. A password
 * set from here therefore works immediately, with no second confirmation.
 */

import { useState } from "react";
import Link from "next/link";
import ProfileCompletionStep from "@/components/reviews/ProfileCompletionStep";
import ReviewAccountStep from "@/components/reviews/ReviewAccountStep";

export default function FinishProfileClient({
  token,
  prefill,
  email,
  hasCredentials = false,
}) {
  const [outcome, setOutcome] = useState(null);
  const [credentialsDone, setCredentialsDone] = useState(hasCredentials);

  if (outcome === "completed") {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">You’re all set!</h1>
        <p className="text-gray-600">
          Your profile is complete. Sign in with Google using the same email, or set a
          password, and your reviews will be waiting for you.
        </p>
        <Link
          href="/listings"
          className="mt-6 inline-block px-5 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
        >
          Browse listings
        </Link>
      </div>
    );
  }

  if (outcome === "skipped") {
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">No problem</h1>
        <p className="text-gray-600">
          This link keeps working for a week, so you can come back and finish whenever
          you&apos;re ready.
        </p>
      </div>
    );
  }

  if (!credentialsDone) {
    return (
      <ReviewAccountStep
        token={token}
        email={email || prefill?.email}
        onPasswordSet={() => setCredentialsDone(true)}
        onSkip={() => setOutcome("skipped")}
        heading="Finish setting up your account"
        intro="Thanks again for the review. Choose how you'd like to sign in from now on."
      />
    );
  }

  return (
    <ProfileCompletionStep
      token={token}
      prefill={prefill}
      onCompleted={() => setOutcome("completed")}
      onSkip={() => setOutcome("skipped")}
      heading="One last thing: finish your profile"
      intro="Almost there. Fill in the rest and your Proximity account is ready to use."
    />
  );
}
