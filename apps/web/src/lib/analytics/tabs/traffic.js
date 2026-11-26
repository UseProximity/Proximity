import { gaTraffic, gaBreakdown } from "@/lib/analytics/ga";
import { gscConfigured, fetchGscWindows } from "@/lib/seo/gsc";
import { GA, block, gaBlock, safeBlock } from "@/lib/analytics/blocks";

/* Traffic: visitors to the live site, from Google Analytics and Google Search Console. */

const sum = (rows, key) => rows.reduce((a, r) => a + r[key], 0);

export default async function loadTraffic(period) {
  const blocks = await Promise.all([
    gaBlock("At a glance", async () => {
      const t = await gaTraffic(period);
      return block("At a glance", {
        tiles: [
          { label: "Visitors", ...t.visitors },
          { label: "Visits", ...t.sessionTotals },
          { label: "Page views", ...t.pageViewTotals },
        ],
        trends: [
          {
            title: "Traffic per week",
            source: GA,
            series: [
              { label: "Visits", values: t.sessions },
              { label: "Page views", values: t.pageViews },
            ],
          },
        ],
        notes: [
          "Traffic comes from Google Analytics only. Vercel Analytics counts visitors differently, so its numbers will not match these; treat this page as the reference.",
        ],
      });
    }),
    gaBlock("Where visitors come from", async () => {
      const [channels, sources, devices, landing] = await Promise.all([
        gaBreakdown(period, { dimension: "sessionDefaultChannelGroup", metric: "sessions" }),
        gaBreakdown(period, { dimension: "sessionSource", metric: "sessions" }),
        gaBreakdown(period, { dimension: "deviceCategory" }),
        gaBreakdown(period, { dimension: "landingPage", metric: "sessions" }),
      ]);
      return block("Where visitors come from", {
        distributions: [
          { title: "Channel (visits)", source: GA, rows: channels },
          { title: "Top sources (visits)", source: GA, rows: sources },
          { title: "Device (visitors)", source: GA, rows: devices },
          { title: "Top landing pages (visits)", source: GA, rows: landing },
        ],
      });
    }),
    ...(gscConfigured()
      ? [
          safeBlock("Google search", async () => {
            const gsc = await fetchGscWindows();
            return block("Google search", {
              description: `Last 28 days with data (${gsc.currentRange.start} to ${gsc.currentRange.end}); Search Console runs about 3 days behind.`,
              tables: [
                {
                  title: "Search performance",
                  source: "Google Search Console",
                  columns: [
                    { label: "Measure" },
                    { label: "Last 28 days", format: "number" },
                    { label: "28 days before", format: "number" },
                  ],
                  rows: [
                    ["Clicks from Google", sum(gsc.current, "clicks"), sum(gsc.previous, "clicks")],
                    ["Times shown in Google", sum(gsc.current, "impressions"), sum(gsc.previous, "impressions")],
                  ],
                },
              ],
            });
          }),
        ]
      : []),
  ]);
  return { blocks };
}
