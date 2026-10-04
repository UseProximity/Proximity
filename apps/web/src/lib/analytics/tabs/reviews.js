import { fetchAll } from "@/lib/analytics/db";
import { gaBreakdown } from "@/lib/analytics/ga";
import { weeklyCounts, periodTotals } from "@/lib/analytics/periods";
import { DB, block, safeBlock, gaBlock, gaStepsTable, customDimensionDistribution } from "@/lib/analytics/blocks";

/* Reviews: apartment and dorm reviews, invites, and the /review page. */

// Activity on the /review page. Not a funnel: people with an account skip the account step,
// and reviews also arrive from invite links, not only QR codes. "Review Submitted" (the review
// box on a listing page) is a separate flow and is counted in the database totals.
const REVIEW_PAGE_STEPS = [
  { event: "qr_review_start", label: "Opened the review page from a QR code" },
  { event: "review_account_started", label: "Started creating an account to review" },
  { event: "review_submitted", label: "Submitted a review on the review page" },
];

export default async function loadReviews(period) {
  const [listingReviews, dormReviews, invites] = await Promise.all([
    fetchAll("listing_reviews", "id, created_at", (q) => q.gte("created_at", period.prevStart)),
    fetchAll("dorm_reviews", "id, created_at", (q) => q.gte("created_at", period.prevStart)),
    fetchAll("review_invites", "id, sent_at, used_at", (q) => q.gte("sent_at", period.prevStart)),
  ]);
  const usedInvites = invites.filter((i) => i.used_at);

  const blocks = await Promise.all([
    safeBlock("At a glance", () =>
      block("At a glance", {
        tiles: [
          { label: "Apartment reviews", ...periodTotals(period, listingReviews) },
          { label: "Dorm reviews", ...periodTotals(period, dormReviews) },
          { label: "Review invites sent", ...periodTotals(period, invites, "sent_at") },
          { label: "Invites used", ...periodTotals(period, usedInvites, "used_at") },
        ],
        trends: [
          {
            title: "Reviews per week",
            source: DB,
            series: [
              { label: "Apartment reviews", values: weeklyCounts(period, listingReviews) },
              { label: "Dorm reviews", values: weeklyCounts(period, dormReviews) },
            ],
          },
        ],
      })
    ),
    gaBlock("Review page", async () => {
      const [table, sources] = await Promise.all([
        gaStepsTable(period, "Review page activity", REVIEW_PAGE_STEPS, { sequential: false }),
        gaBreakdown(period, { dimension: "customEvent:src", event: "review_submitted" }),
      ]);
      return block("Review page", {
        tables: [table],
        distributions: [customDimensionDistribution("Where submitted reviews came from", sources)],
      });
    }),
  ]);
  return { blocks };
}
