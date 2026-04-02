"use client";

import { useState, useEffect, useRef } from "react";
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

const COLORS = ["#dc2626", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

const RANGE_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "6m", label: "6 months" },
];

const METRIC_OPTIONS = [
  { value: "clicks", label: "Clicks" },
  { value: "saves", label: "Saves" },
  { value: "contacts", label: "Contacts" },
];

function generateDateRange(range) {
  const dates = [];
  const days = range === "7d" ? 7 : range === "6m" ? 182 : 30;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function formatLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function LeasingFunnel() {
  const [allListings, setAllListings] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [range, setRange] = useState("30d");
  const [metricType, setMetricType] = useState("clicks");
  const [displayMode, setDisplayMode] = useState("combined");
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Fetch landlord's listings on mount
  useEffect(() => {
    fetch("/api/landlord/listings")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAllListings(data);
          setSelectedIds(data.map((l) => l.id));
        }
      })
      .catch(console.error);
  }, []);

  // Fetch metrics when selection or range changes
  useEffect(() => {
    if (selectedIds.length === 0) {
      setMetrics([]);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ range, listingIds: selectedIds.join(",") });
    fetch(`/api/landlord/metrics?${params}`)
      .then((r) => r.json())
      .then((data) => setMetrics(data.metrics ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedIds, range]);

  // Build chart data
  const dates = generateDateRange(range);
  let chartData = [];

  if (displayMode === "combined") {
    const countsByDate = {};
    metrics
      .filter((m) => m.metric_type === metricType && selectedIds.includes(m.listing_id))
      .forEach((m) => {
        countsByDate[m.recorded_date] = (countsByDate[m.recorded_date] ?? 0) + m.count;
      });
    chartData = dates.map((d) => ({ date: formatLabel(d), value: countsByDate[d] ?? 0 }));
  } else {
    chartData = dates.map((d) => {
      const row = { date: formatLabel(d) };
      selectedIds.forEach((listingId) => {
        const m = metrics.find(
          (x) =>
            x.listing_id === listingId &&
            x.metric_type === metricType &&
            x.recorded_date === d
        );
        const listing = allListings.find((l) => l.id === listingId);
        const key = listing?.title || listing?.address || listingId;
        row[key] = m?.count ?? 0;
      });
      return row;
    });
  }

  // Summary stats
  const relevantMetrics = metrics.filter(
    (m) => m.metric_type === metricType && selectedIds.includes(m.listing_id)
  );
  const totalCount = relevantMetrics.reduce((sum, m) => sum + m.count, 0);
  const dayTotals = dates.map((d) =>
    relevantMetrics
      .filter((m) => m.recorded_date === d)
      .reduce((sum, m) => sum + m.count, 0)
  );
  const peakCount = dayTotals.length ? Math.max(...dayTotals) : 0;
  const avgCount =
    dayTotals.length ? (totalCount / dayTotals.length).toFixed(1) : "0";

  // Dropdown label
  let dropdownLabel = "No listings selected";
  if (selectedIds.length > 0 && selectedIds.length === allListings.length) {
    dropdownLabel = "All listings";
  } else if (selectedIds.length === 1) {
    const l = allListings.find((x) => x.id === selectedIds[0]);
    dropdownLabel = l?.title || l?.address || "1 listing";
  } else if (selectedIds.length > 1) {
    dropdownLabel = `${selectedIds.length} listings`;
  }

  const toggleListing = (id) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const tickInterval =
    range === "7d" ? 0 : range === "30d" ? 4 : 20;

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Multi-select dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 min-w-[180px] justify-between"
          >
            <span className="truncate">{dropdownLabel}</span>
            <svg
              className="h-4 w-4 text-gray-400 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {dropdownOpen && (
            <div className="absolute z-20 top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[240px] max-h-64 overflow-y-auto">
              <div className="flex gap-2 px-3 py-2 border-b border-gray-100">
                <button
                  onClick={() => setSelectedIds(allListings.map((l) => l.id))}
                  className="text-xs text-red-600 hover:underline font-medium"
                >
                  All
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => setSelectedIds([])}
                  className="text-xs text-gray-500 hover:underline"
                >
                  None
                </button>
              </div>
              {allListings.map((listing) => (
                <label
                  key={listing.id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(listing.id)}
                    onChange={() => toggleListing(listing.id)}
                    className="accent-red-600"
                  />
                  <span className="truncate">
                    {listing.title || listing.address}
                  </span>
                </label>
              ))}
              {allListings.length === 0 && (
                <p className="px-3 py-2 text-sm text-gray-400">No listings found</p>
              )}
            </div>
          )}
        </div>

        {/* Range */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                range === opt.value
                  ? "bg-red-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Metric type */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {METRIC_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setMetricType(opt.value)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                metricType === opt.value
                  ? "bg-red-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Display mode */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => setDisplayMode("combined")}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              displayMode === "combined"
                ? "bg-gray-800 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Combined
          </button>
          <button
            onClick={() => setDisplayMode("separate")}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              displayMode === "separate"
                ? "bg-gray-800 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Separate
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {selectedIds.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: `Total ${metricType}`, value: totalCount },
            { label: "Peak day", value: peakCount },
            { label: "Avg / day", value: avgCount },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="bg-white rounded-lg border border-gray-200 shadow-sm p-4"
            >
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                {label}
              </p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        {selectedIds.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
            Select a listing to view metrics
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
            Loading...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                interval={tickInterval}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                }}
              />
              {displayMode === "combined" ? (
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot={false}
                  name={
                    metricType.charAt(0).toUpperCase() + metricType.slice(1)
                  }
                />
              ) : (
                <>
                  {selectedIds.map((listingId, i) => {
                    const listing = allListings.find((l) => l.id === listingId);
                    const key =
                      listing?.title || listing?.address || listingId;
                    return (
                      <Line
                        key={listingId}
                        type="monotone"
                        dataKey={key}
                        stroke={COLORS[i % COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        name={key}
                      />
                    );
                  })}
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
