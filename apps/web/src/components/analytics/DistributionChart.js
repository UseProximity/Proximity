"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/**
 * Horizontal bars for a breakdown ("budget ranges", "device"). `data` is [{ label, count }],
 * built on the server so only numbers and labels reach the browser.
 */
export default function DistributionChart({ data }) {
  // Room for each bar plus the axis; long breakdowns grow rather than squash.
  const height = Math.max(120, data.length * 32 + 40);
  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
          <YAxis type="category" dataKey="label" width={170} tick={{ fontSize: 12 }} interval={0} />
          <Tooltip />
          <Bar dataKey="count" name="Count" fill="#dc2626" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
