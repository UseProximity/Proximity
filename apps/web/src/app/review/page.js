/*
 * Public "Add a Review" page: /review. Linked from the More menu in the header,
 * and the destination a scanned QR code lands on (via the short /r redirect,
 * which carries the printed code's ?src= campaign tag through).
 *
 * No sign-in required. The flow asks whether the student has lived off campus
 * and branches to a property review or a dorm review; a signed-out reviewer
 * supplies their name, class and school email at the end, which creates an
 * incomplete account they're then invited to finish. Signed-in students get the
 * same flow with those questions answered from their account.
 */
import { Suspense } from "react";
import ReviewFlow from "@/components/reviews/ReviewFlow";

export const metadata = {
  title: "Add a Review | Proximity",
  description:
    "Review a place you've lived, off campus or on. Help other students find a better apartment or dorm, and avoid the bad ones.",
  alternates: { canonical: "/review" },
};

export default function ReviewPage() {
  // ReviewFlow reads the ?src= campaign tag with useSearchParams.
  return (
    <Suspense fallback={<div className="max-w-xl mx-auto px-4 py-10" />}>
      <ReviewFlow />
    </Suspense>
  );
}
