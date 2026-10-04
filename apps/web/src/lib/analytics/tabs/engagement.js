import { fetchAll, lookupIds } from "@/lib/analytics/db";
import { gaBreakdown } from "@/lib/analytics/ga";
import { weeklyCounts, periodTotals } from "@/lib/analytics/periods";
import { DB, GA, block, safeBlock, gaBlock, customDimensionDistribution } from "@/lib/analytics/blocks";

/*
 * Listing engagement: what students do with listings. Views, saves and contacts come from the
 * per-listing daily counters, the same numbers landlords see on their dashboard.
 */

const SOURCE_LABELS = { matchmaking: "Matchmaking recommendations" };

export default async function loadEngagement(period) {
  const metricTypes = await lookupIds("metric_types");
  const [daily, waitlist] = await Promise.all([
    fetchAll("listing_metrics_daily", "id, recorded_date, count, metric_type_id", (q) =>
      q.gte("recorded_date", period.prevStart.slice(0, 10))
    ),
    fetchAll("waitlist_clicks", "id, created_at", (q) => q.gte("created_at", period.prevStart)),
  ]);
  const ofType = (name) => daily.filter((d) => d.metric_type_id === metricTypes[name]);
  const byCount = (r) => r.count;
  const weekly = (name) => weeklyCounts(period, ofType(name), "recorded_date", byCount);
  const totals = (name) => periodTotals(period, ofType(name), "recorded_date", byCount);

  const blocks = await Promise.all([
    safeBlock("At a glance", () =>
      block("At a glance", {
        tiles: [
          { label: "Listing views", ...totals("clicks") },
          { label: "Saves", ...totals("saves") },
          { label: "Contacts", ...totals("contacts") },
          { label: "Waitlist sign-ups", ...periodTotals(period, waitlist) },
        ],
        trends: [
          {
            title: "Listing engagement per week",
            source: DB,
            series: [
              { label: "Views", values: weekly("clicks") },
              { label: "Saves", values: weekly("saves") },
              { label: "Contacts", values: weekly("contacts") },
              { label: "Waitlist sign-ups", values: weeklyCounts(period, waitlist) },
            ],
          },
        ],
      })
    ),
    gaBlock("Who opens listings", async () => {
      const [devices, sources] = await Promise.all([
        gaBreakdown(period, { dimension: "deviceCategory", event: "Listing Opened" }),
        gaBreakdown(period, { dimension: "customEvent:source", event: "Listing Opened" }),
      ]);
      return block("Who opens listings", {
        distributions: [
          { title: "Device", source: GA, rows: devices },
          customDimensionDistribution("Where listing opens came from", sources, (v) => SOURCE_LABELS[v] ?? v),
        ],
        notes: ["Listing opens without a recorded source came from browsing the map and list."],
      });
    }),
  ]);
  return { blocks };
}
