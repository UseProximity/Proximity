"use client";

import LeasingFunnel from "@/components/dashboard/leasing-funnel";

export default function AnalyticsDashboardSection({ viewAsId }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="text-2xl">📊</div>
        <h2 className="text-xl font-bold text-gray-900">Analytics</h2>
        <p className="text-sm text-gray-500 ml-1">
          Track performance across your listings
        </p>
      </div>
      <LeasingFunnel viewAsId={viewAsId} />
    </div>
  );
}
