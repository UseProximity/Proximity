import { fetchAll } from "@/lib/analytics/db";
import { gaBreakdown } from "@/lib/analytics/ga";
import { weeklyCounts, periodTotals } from "@/lib/analytics/periods";
import {
  DB,
  GA_FUNNEL_NOTE,
  block,
  safeBlock,
  gaBlock,
  gaStepsTable,
  customDimensionDistribution,
} from "@/lib/analytics/blocks";

/* Lease check: students uploading a lease for review. */

const LEASE_STEPS = [
  { event: "Lease Check Started", label: "Started a lease check" },
  { event: "Lease Check Auth Prompted", label: "Asked to sign in" },
  { event: "Lease Check Completed", label: "Got a result" },
  { event: "Lease Check Questions Copied", label: "Copied the questions" },
  { event: "Lease Check Failed", label: "Hit an error" },
];

export default async function loadLeaseCheck(period) {
  const checks = await fetchAll("lease_checks", "id, created_at", (q) => q.gte("created_at", period.prevStart));

  const blocks = await Promise.all([
    safeBlock("At a glance", () =>
      block("At a glance", {
        tiles: [{ label: "Lease checks saved", ...periodTotals(period, checks) }],
        trends: [
          {
            title: "Lease checks per week",
            source: DB,
            series: [{ label: "Lease checks", values: weeklyCounts(period, checks) }],
          },
        ],
      })
    ),
    gaBlock("Funnel and errors", async () => {
      const [table, reasons, fileTypes] = await Promise.all([
        gaStepsTable(period, "Lease check funnel", LEASE_STEPS),
        gaBreakdown(period, { dimension: "customEvent:reason", event: "Lease Check Failed" }),
        gaBreakdown(period, { dimension: "customEvent:fileType", event: "Lease Check Started" }),
      ]);
      return block("Funnel and errors", {
        tables: [table],
        distributions: [
          customDimensionDistribution("Why lease checks failed", reasons),
          customDimensionDistribution("File types uploaded", fileTypes),
        ],
        notes: [GA_FUNNEL_NOTE],
      });
    }),
  ]);
  return { blocks };
}
