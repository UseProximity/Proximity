"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";

const METRIC_COLORS = {
  clicks: "#dc2626",
  saves: "#d97706",
  contacts: "#2563eb",
};
const METRIC_LABELS = { clicks: "Views", saves: "Saves", contacts: "Contacts" };
const RANGE_OPTIONS_CHART = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "6m", label: "6 months" },
];

function generateDates(range) {
  const days = range === "7d" ? 7 : range === "6m" ? 182 : 30;
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000);
    return d.toISOString().split("T")[0];
  });
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ListingMetricsChart({ listingId, viewAsId }) {
  const [range, setRange] = useState("30d");
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedMetrics, setSelectedMetrics] = useState([
    "clicks",
    "saves",
    "contacts",
  ]);

  useEffect(() => {
    if (!listingId) return;
    setLoading(true);
    const params = new URLSearchParams({ range, listingIds: listingId });
    if (viewAsId) params.set("viewAs", viewAsId);
    fetch(`/api/landlord/metrics?${params}`)
      .then((r) => r.json())
      .then((data) => setMetrics(data.metrics ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [listingId, range]);

  const dates = generateDates(range);
  const chartData = dates.map((d) => {
    const row = { date: fmtDate(d) };
    ["clicks", "saves", "contacts"].forEach((type) => {
      const m = metrics.find(
        (x) => x.metric_type === type && x.recorded_date === d
      );
      row[type] = m?.count ?? 0;
    });
    return row;
  });

  const maxValue =
    selectedMetrics.length > 0
      ? Math.max(
          ...chartData.flatMap((d) => selectedMetrics.map((t) => d[t] ?? 0)),
          1
        )
      : 1;

  const toggleMetric = (type) => {
    setSelectedMetrics((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const tickInterval = range === "7d" ? 0 : range === "30d" ? 4 : 20;

  return (
    <Card>
      {/* Wraps rather than forcing a page-wide horizontal scroll on phones. */}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium">
          Engagement Over Time
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {["clicks", "saves", "contacts"].map((type) => {
              const active = selectedMetrics.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleMetric(type)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors border ${
                    active
                      ? "text-white"
                      : "bg-white text-gray-400 border-gray-200"
                  }`}
                  style={
                    active
                      ? {
                          backgroundColor: METRIC_COLORS[type],
                          borderColor: METRIC_COLORS[type],
                        }
                      : {}
                  }
                >
                  {METRIC_LABELS[type]}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1">
            {RANGE_OPTIONS_CHART.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setRange(value)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                  range === value
                    ? "bg-red-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            Loading…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={chartData}
              margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                interval={tickInterval}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                allowDecimals={false}
                domain={[0, maxValue]}
              />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(val, name) => [val, METRIC_LABELS[name] ?? name]}
              />
              <Legend
                formatter={(name) => METRIC_LABELS[name] ?? name}
                wrapperStyle={{ fontSize: 12 }}
              />
              {["clicks", "saves", "contacts"]
                .filter((t) => selectedMetrics.includes(t))
                .map((type) => (
                  <Line
                    key={type}
                    type="monotone"
                    dataKey={type}
                    stroke={METRIC_COLORS[type]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
