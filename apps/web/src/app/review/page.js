/*
 * Public "Add a Review" page: /review. Linked from the More menu in the header.
 *
 * Same flow as an ambassador referral link (/refer/<id>) — confirm school, search and
 * validate an address, then review — just without a referrer to attribute it to. Unlike
 * /refer/*, this page is indexable, since it's a real entry point we want students to find.
 */
import ReviewSubmitForm from "@/components/reviews/ReviewSubmitForm";

export const metadata = {
  title: "Add a Review | Proximity",
  description:
    "Review a place you've lived off campus. Help other students find a better apartment — and avoid the bad ones.",
  alternates: { canonical: "/review" },
};

export default function ReviewPage() {
  return <ReviewSubmitForm />;
}
