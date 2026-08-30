/*
 * Where Google sends the student back after they finish the QR review flow with
 * "Continue with Google": /review/claim?token=...
 *
 * Deliberately NOT /review/finish. That page treats arriving as proof the
 * student owns the inbox (it came from an email sent there) and marks the
 * address verified. Coming back from Google proves ownership of the GOOGLE
 * address, which may be an entirely different one, so nothing is verified here.
 */
import { Suspense } from "react";
import ClaimReviewClient from "./ClaimReviewClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Finish Your Account | Proximity",
  robots: { index: false, follow: false },
};

export default function ClaimReviewPage() {
  return (
    <Suspense fallback={<div className="max-w-xl mx-auto px-4 py-10" />}>
      <ClaimReviewClient />
    </Suspense>
  );
}
