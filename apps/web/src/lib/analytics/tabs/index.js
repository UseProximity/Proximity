import loadOverview from "@/lib/analytics/tabs/overview";
import loadMatchmaking from "@/lib/analytics/tabs/matchmaking";
import loadLandlords from "@/lib/analytics/tabs/landlords";
import loadEngagement from "@/lib/analytics/tabs/engagement";
import loadReviews from "@/lib/analytics/tabs/reviews";
import loadLeaseCheck from "@/lib/analytics/tabs/leaseCheck";
import loadTraffic from "@/lib/analytics/tabs/traffic";

/*
 * Every /analytics tab, in display order. To add a tab: write a loader in this folder that
 * returns { blocks } (see blocks.js), then add one line here. Partner visibility is set in
 * EXTRA_VIEWER_TABS in access.js.
 */
export const TABS = [
  { slug: "overview", title: "Overview", load: loadOverview },
  { slug: "matchmaking", title: "Matchmaking", load: loadMatchmaking },
  { slug: "landlords", title: "Landlords", load: loadLandlords },
  { slug: "engagement", title: "Listing engagement", load: loadEngagement },
  { slug: "reviews", title: "Reviews", load: loadReviews },
  { slug: "lease-check", title: "Lease check", load: loadLeaseCheck },
  { slug: "traffic", title: "Traffic", load: loadTraffic },
];
