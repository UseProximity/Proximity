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

const METRIC_COLORS = { clicks: "#dc2626", saves: "#d97706", contacts: "#2563eb" };
const METRIC_LABELS = { clicks: "Views", saves: "Saves", contacts: "Contacts" };

const RANGE_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "6m", label: "6 months" },
  { value: "all", label: "All time" },
];

function generateDateRange(range, metrics, selectedIds, selectedMetrics) {
  if (range === "all") {
    const relevant = metrics.filter(
      (m) => selectedIds.includes(m.listing_id) && selectedMetrics.includes(m.metric_type)
    );
    if (relevant.length === 0) return [];
    const oldest = relevant.reduce(
      (min, m) => (m.recorded_date < min ? m.recorded_date : min),
      relevant[0].recorded_date
    );
    const dates = [];
    const start = new Date(oldest + "T00:00:00");
    start.setDate(start.getDate() - 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split("T")[0]);
    }
    return dates;
  }
  const days = range === "7d" ? 7 : range === "6m" ? 182 : 30;
  const dates = [];
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

export default function LeasingFunnel({ viewAsId } = {}) {
  const [allListings, setAllListings] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [range, setRange] = useState("30d");
  const [selectedMetrics, setSelectedMetrics] = useState(["clicks", "saves", "contacts"]);
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    const qs = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";
    fetch(`/api/landlord/listings${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAllListings(data);
          setSelectedIds(data.map((l) => l.id));
        }
      })
      .catch(console.error);
  }, [viewAsId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedIds.length === 0) {
      setMetrics([]);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ range, listingIds: selectedIds.join(",") });
    if (viewAsId) params.set("viewAs", viewAsId);
    fetch(`/api/landlord/metrics?${params}`)
      .then((r) => r.json())
      .then((data) => setMetrics(data.metrics ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedIds, range]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build chart data — one key per metric type, summed across selected listings
  const dates = generateDateRange(range, metrics, selectedIds, selectedMetrics);
  const chartData = dates.map((d) => {
    const row = { date: formatLabel(d) };
    ["clicks", "saves", "contacts"].forEach((type) => {
      row[type] = metrics
        .filter((m) => m.metric_type === type && selectedIds.includes(m.listing_id) && m.recorded_date === d)
        .reduce((sum, m) => sum + m.count, 0);
    });
    return row;
  });

  // Y-axis domain scales to the largest selected metric
  const maxValue = selectedMetrics.length > 0
    ? Math.max(...chartData.flatMap((d) => selectedMetrics.map((t) => d[t] ?? 0)), 1)
    : 1;

  // Per-metric totals across selected listings
  const totalViews = metrics.filter((m) => m.metric_type === "clicks" && selectedIds.includes(m.listing_id)).reduce((sum, m) => sum + m.count, 0);
  const totalSaves = metrics.filter((m) => m.metric_type === "saves" && selectedIds.includes(m.listing_id)).reduce((sum, m) => sum + m.count, 0);
  const totalContacts = metrics.filter((m) => m.metric_type === "contacts" && selectedIds.includes(m.listing_id)).reduce((sum, m) => sum + m.count, 0);

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

  const toggleMetric = (type) =>
    setSelectedMetrics((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );

  const tickInterval =
    range === "7d" ? 0 : range === "30d" ? 4 : range === "6m" ? 20 : Math.max(1, Math.floor(dates.length / 10));

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Listings dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 min-w-[180px] justify-between"
          >
            <span className="truncate">{dropdownLabel}</span>
            <svg className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {dropdownOpen && (
            <div className="absolute z-20 top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[240px] max-h-64 overflow-y-auto">
              <div className="flex gap-2 px-3 py-2 border-b border-gray-100">
                <button onClick={() => setSelectedIds(allListings.map((l) => l.id))} className="text-xs text-red-600 hover:underline font-medium">All</button>
                <span className="text-gray-300">|</span>
                <button onClick={() => setSelectedIds([])} className="text-xs text-gray-500 hover:underline">None</button>
              </div>
              {allListings.map((listing) => (
                <label key={listing.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                  <input type="checkbox" checked={selectedIds.includes(listing.id)} onChange={() => toggleListing(listing.id)} className="accent-red-600" />
                  <span className="truncate">{listing.title || listing.address}</span>
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
                range === opt.value ? "bg-red-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Metric toggles — colored pills */}
        <div className="flex gap-1.5">
          {["clicks", "saves", "contacts"].map((type) => {
            const active = selectedMetrics.includes(type);
            return (
              <button
                key={type}
                onClick={() => toggleMetric(type)}
                className={`px-3 py-1.5 text-sm rounded-full font-medium transition-colors border ${
                  active ? "text-white" : "bg-white text-gray-400 border-gray-200"
                }`}
                style={active ? { backgroundColor: METRIC_COLORS[type], borderColor: METRIC_COLORS[type] } : {}}
              >
                {METRIC_LABELS[type]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary cards */}
      {selectedIds.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Views", value: totalViews, color: METRIC_COLORS.clicks },
            { label: "Total Saves", value: totalSaves, color: METRIC_COLORS.saves },
            { label: "Total Contacts", value: totalContacts, color: METRIC_COLORS.contacts },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        {selectedIds.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Select a listing to view metrics</div>
        ) : loading ? (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} interval={tickInterval} />
              <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} domain={[0, maxValue]} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                formatter={(val, name) => [val, METRIC_LABELS[name] ?? name]}
              />
              <Legend formatter={(name) => METRIC_LABELS[name] ?? name} wrapperStyle={{ fontSize: 12 }} />
              {["clicks", "saves", "contacts"].filter((t) => selectedMetrics.includes(t)).map((type) => (
                <Line
                  key={type}
                  type="monotone"
                  dataKey={type}
                  stroke={METRIC_COLORS[type]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  name={type}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
