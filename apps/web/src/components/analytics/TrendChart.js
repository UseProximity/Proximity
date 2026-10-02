"use client";

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

// Distinct, readable in a legend; the first matches the brand red used elsewhere.
const COLORS = ["#dc2626", "#2563eb", "#d97706", "#059669", "#7c3aed", "#475569"];

/**
 * One line per series over the period's weeks. `data` is [{ week, [seriesLabel]: n }],
 * built on the server so only numbers reach the browser.
 */
export default function TrendChart({ data, seriesLabels }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="week" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip labelFormatter={(week) => `Week of ${week}`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {seriesLabels.map((label, i) => (
            <Line
              key={label}
              type="linear"
              dataKey={label}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
