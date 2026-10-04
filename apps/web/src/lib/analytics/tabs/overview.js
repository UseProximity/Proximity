import { fetchAll, countRows, lookupIds } from "@/lib/analytics/db";
import { weeklyCounts, periodTotals } from "@/lib/analytics/periods";
import { DB, block, safeBlock, within, countValues } from "@/lib/analytics/blocks";

/* Overview: accounts and the state of the site, for the team. */

const signupMethod = (u) => (u.google_account ? "Google" : u.apple_account ? "Apple" : "Email and password");

export default async function loadOverview(period) {
  const roles = await lookupIds("roles");
  const [users, liveListings, listingReviews, dormReviews] = await Promise.all([
    fetchAll("users", "id, created_at, role_id, google_account, apple_account", (q) =>
      q.gte("created_at", period.prevStart)
    ),
    countRows("listings", (q) => q.is("deleted_at", null).eq("unavailable", false).is("paused_at", null)),
    countRows("listing_reviews", (q) => q.is("deleted_at", null)),
    countRows("dorm_reviews", (q) => q.is("deleted_at", null)),
  ]);
  const ofRole = (name) => users.filter((u) => u.role_id === roles[name]);
  const students = ofRole("student");
  const landlords = ofRole("landlord");
  const current = users.filter((u) => within(u.created_at, period.start));

  const blocks = await Promise.all([
    safeBlock("At a glance", () =>
      block("At a glance", {
        tiles: [
          { label: "New accounts", ...periodTotals(period, users) },
          { label: "New student accounts", ...periodTotals(period, students) },
          { label: "New landlord accounts", ...periodTotals(period, landlords) },
          { label: "Live listings today", current: liveListings },
          { label: "Published reviews (all time)", current: listingReviews + dormReviews },
        ],
      })
    ),
    safeBlock("New accounts", () =>
      block("New accounts", {
        trends: [
          {
            title: "New accounts per week",
            source: DB,
            series: [
              { label: "Students", values: weeklyCounts(period, students) },
              { label: "Landlords", values: weeklyCounts(period, landlords) },
            ],
          },
        ],
        distributions: [
          { title: "How new accounts signed up", source: DB, rows: countValues(current, signupMethod) },
        ],
      })
    ),
  ]);
  return { blocks };
}
