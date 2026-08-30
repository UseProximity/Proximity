"use client";

/*
 * Client half of /review/finish: renders the same profile step the inline flow
 * uses, and shows where they've landed once it's saved or skipped.
 */

import { useState } from "react";
import Link from "next/link";
import ProfileCompletionStep from "@/components/reviews/ProfileCompletionStep";

export default function FinishProfileClient({ token, prefill }) {
  const [outcome, setOutcome] = useState(null);

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

  return (
    <ProfileCompletionStep
      token={token}
      prefill={prefill}
      onCompleted={() => setOutcome("completed")}
      onSkip={() => setOutcome("skipped")}
      heading="Finish setting up your account"
      intro="Thanks again for the review. Fill in the rest and your Proximity account is ready to use."
    />
  );
}
