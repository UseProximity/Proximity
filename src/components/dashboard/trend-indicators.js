"use client";

import { useState } from "react";
import {
  TrendingUp,
  Clock,
  MapPin,
  Calendar,
  Users,
  Eye,
  MessageSquare,
} from "lucide-react";

// Mock data
const trafficData = [
  { date: "Jan 1", views: 45, inquiries: 8, applications: 2 },
  { date: "Jan 5", views: 52, inquiries: 12, applications: 4 },
  { date: "Jan 10", views: 48, inquiries: 9, applications: 3 },
  { date: "Jan 15", views: 61, inquiries: 15, applications: 6 },
  { date: "Jan 20", views: 55, inquiries: 11, applications: 4 },
  { date: "Jan 25", views: 67, inquiries: 18, applications: 7 },
  { date: "Jan 30", views: 72, inquiries: 22, applications: 9 },
];

const peakTimesData = [
  { time: "6AM", activity: 12 },
  { time: "9AM", activity: 45 },
  { time: "12PM", activity: 78 },
  { time: "3PM", activity: 92 },
  { time: "6PM", activity: 156 },
  { time: "9PM", activity: 134 },
  { time: "12AM", activity: 23 },
];

const seasonalTrends = [
  { month: "Jan", inquiries: 89, leases: 12 },
  { month: "Feb", inquiries: 76, leases: 8 },
  { month: "Mar", inquiries: 134, leases: 18 },
  { month: "Apr", inquiries: 156, leases: 22 },
  { month: "May", inquiries: 198, leases: 28 },
  { month: "Jun", inquiries: 167, leases: 24 },
  { month: "Jul", inquiries: 145, leases: 19 },
  { month: "Aug", inquiries: 189, leases: 26 },
  { month: "Sep", inquiries: 123, leases: 16 },
  { month: "Oct", inquiries: 98, leases: 13 },
  { month: "Nov", inquiries: 87, leases: 11 },
  { month: "Dec", inquiries: 65, leases: 7 },
];

const heatmapData = [
  { area: "Campus District", intensity: 95, color: "bg-red-600" },
  { area: "Downtown", intensity: 78, color: "bg-red-500" },
  { area: "University Heights", intensity: 82, color: "bg-red-500" },
  { area: "Student Village", intensity: 67, color: "bg-red-400" },
  { area: "Greek Row", intensity: 89, color: "bg-red-600" },
  { area: "Off-Campus", intensity: 45, color: "bg-red-300" },
];

// Simple components
const Card = ({ children, className = "" }) => (
  <div
    className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}
  >
    {children}
  </div>
);

const CardHeader = ({ children, className = "" }) => (
  <div className={`p-6 pb-2 ${className}`}>{children}</div>
);

const CardContent = ({ children, className = "" }) => (
  <div className={`p-6 pt-0 ${className}`}>{children}</div>
);

const CardTitle = ({ children, className = "" }) => (
  <h3
    className={`text-lg font-semibold leading-none tracking-tight ${className}`}
  >
    {children}
  </h3>
);

const CardDescription = ({ children, className = "" }) => (
  <p className={`text-sm text-gray-500 ${className}`}>{children}</p>
);

const Badge = ({ children, variant = "default", className = "" }) => {
  const variants = {
    default: "bg-red-600 text-white",
    secondary: "bg-gray-100 text-gray-900",
  };

  return (
    <div
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${variants[variant]} ${className}`}
    >
      {children}
    </div>
  );
};

// Simple Line Chart Component
const SimpleLineChart = ({ data, lines }) => {
  const maxValue = Math.max(
    ...data.flatMap((item) => lines.map((line) => item[line.key]))
  );
  const minValue = Math.min(
    ...data.flatMap((item) => lines.map((line) => item[line.key]))
  );
  const range = maxValue - minValue;

  return (
    <div className="w-full h-[200px] p-4">
      <div className="relative w-full h-full">
        {/* Grid lines */}
        <div className="absolute inset-0 grid grid-rows-4 opacity-20">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="border-t border-gray-300" />
          ))}
        </div>

        {/* Chart area */}
        <svg className="w-full h-full" viewBox="0 0 400 160">
          {lines.map((line, lineIndex) => {
            const points = data
              .map((item, index) => {
                const x = (index / (data.length - 1)) * 380 + 10;
                const y = 150 - ((item[line.key] - minValue) / range) * 140;
                return `${x},${y}`;
              })
              .join(" ");

            return (
              <g key={lineIndex}>
                <polyline
                  fill="none"
                  stroke={line.color}
                  strokeWidth="2"
                  points={points}
                  className="transition-all duration-300"
                />
                {data.map((item, index) => {
                  const x = (index / (data.length - 1)) * 380 + 10;
                  const y = 150 - ((item[line.key] - minValue) / range) * 140;
                  return (
                    <circle
                      key={index}
                      cx={x}
                      cy={y}
                      r="3"
                      fill={line.color}
                      className="hover:r-4 transition-all duration-200"
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* X-axis labels */}
        <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-gray-500 px-2">
          {data.map((item, index) => (
            <span key={index}>{item.date}</span>
          ))}
        </div>
      </div>
    </div>
  );
};

// Simple Bar Chart Component
const SimpleBarChart = ({ data, dataKey, color = "#8b5cf6" }) => {
  const maxValue = Math.max(...data.map((item) => item[dataKey]));

  return (
    <div className="w-full h-[200px] flex items-end justify-between gap-2 p-4">
      {data.map((item, index) => {
        const height = (item[dataKey] / maxValue) * 160;
        return (
          <div key={index} className="flex flex-col items-center gap-2 flex-1">
            <div className="text-xs font-medium text-gray-700">
              {item[dataKey]}
            </div>
            <div
              className="w-full rounded-t-md transition-all duration-300 hover:opacity-80"
              style={{
                height: `${height}px`,
                backgroundColor: color,
                minHeight: "4px",
              }}
            />
            <div className="text-xs text-gray-500">{item.time}</div>
          </div>
        );
      })}
    </div>
  );
};

// Seasonal Chart Component
const SeasonalChart = ({ data }) => {
  const maxInquiries = Math.max(...data.map((item) => item.inquiries));
  const maxLeases = Math.max(...data.map((item) => item.leases));

  return (
    <div className="w-full h-[250px] p-4">
      <div className="flex items-end justify-between gap-1 h-full">
        {data.map((item, index) => {
          const inquiryHeight = (item.inquiries / maxInquiries) * 200;
          const leaseHeight = (item.leases / maxLeases) * 200;

          return (
            <div
              key={index}
              className="flex flex-col items-center gap-2 flex-1"
            >
              <div className="flex items-end gap-1 h-[200px]">
                <div className="flex flex-col items-center gap-1">
                  <div className="text-xs font-medium text-red-600">
                    {item.inquiries}
                  </div>
                  <div
                    className="w-4 bg-red-500 rounded-t transition-all duration-300 hover:opacity-80"
                    style={{ height: `${inquiryHeight}px`, minHeight: "4px" }}
                  />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="text-xs font-medium text-green-600">
                    {item.leases}
                  </div>
                  <div
                    className="w-4 bg-green-500 rounded-t transition-all duration-300 hover:opacity-80"
                    style={{ height: `${leaseHeight}px`, minHeight: "4px" }}
                  />
                </div>
              </div>
              <div className="text-xs text-gray-500">{item.month}</div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-center gap-4 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-500 rounded" />
          <span className="text-xs text-gray-600">Inquiries</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 rounded" />
          <span className="text-xs text-gray-600">Leases</span>
        </div>
      </div>
    </div>
  );
};

export default function TrendIndicators() {
  const [selectedTimeframe, setSelectedTimeframe] = useState("30days");
  const [selectedMetric, setSelectedMetric] = useState("views");

  const calculateTrend = (data, key) => {
    if (data.length < 2) return 0;
    const recent = data.slice(-3).reduce((sum, item) => sum + item[key], 0) / 3;
    const previous =
      data.slice(-6, -3).reduce((sum, item) => sum + item[key], 0) / 3;
    return ((recent - previous) / previous) * 100;
  };

  const viewsTrend = calculateTrend(trafficData, "views");
  const inquiriesTrend = calculateTrend(trafficData, "inquiries");

  return (
    <div className="w-full min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-2xl">📈</div>
            <h1 className="text-2xl font-bold text-gray-900">
              Trend Indicators
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedTimeframe}
              onChange={(e) => setSelectedTimeframe(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
              <option value="90days">Last 90 Days</option>
              <option value="1year">Last Year</option>
            </select>
          </div>
        </div>

        {/* Key Trend Metrics */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Views Trend</CardTitle>
              <Eye className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {viewsTrend >= 0 ? "+" : ""}
                {viewsTrend.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                <span
                  className={
                    viewsTrend >= 0 ? "text-green-600" : "text-red-600"
                  }
                >
                  {viewsTrend >= 0 ? "↗" : "↘"}{" "}
                  {Math.abs(viewsTrend).toFixed(1)}%
                </span>{" "}
                vs previous period
              </div>
              <Badge
                variant="secondary"
                className={`mt-2 ${
                  viewsTrend >= 0
                    ? "bg-green-100 text-green-800"
                    : "bg-red-100 text-red-800"
                }`}
              >
                {viewsTrend >= 0 ? "Growing" : "Declining"}
              </Badge>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Inquiries Trend
              </CardTitle>
              <MessageSquare className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {inquiriesTrend >= 0 ? "+" : ""}
                {inquiriesTrend.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                <span
                  className={
                    inquiriesTrend >= 0 ? "text-green-600" : "text-red-600"
                  }
                >
                  {inquiriesTrend >= 0 ? "↗" : "↘"}{" "}
                  {Math.abs(inquiriesTrend).toFixed(1)}%
                </span>{" "}
                vs previous period
              </div>
              <Badge
                variant="secondary"
                className={`mt-2 ${
                  inquiriesTrend >= 0
                    ? "bg-green-100 text-green-800"
                    : "bg-red-100 text-red-800"
                }`}
              >
                {inquiriesTrend >= 0 ? "Growing" : "Declining"}
              </Badge>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Peak Activity
              </CardTitle>
              <Clock className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">6PM</div>
              <div className="text-xs text-gray-500 mt-1">156 activities</div>
              <div className="text-xs text-gray-500 mt-1">
                Best time to post listings
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Hottest Area
              </CardTitle>
              <MapPin className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Campus</div>
              <div className="text-xs text-gray-500 mt-1">
                95% activity score
              </div>
              <Badge variant="default" className="mt-2">
                🔥 Hot Zone
              </Badge>
            </CardContent>
          </Card>
        </div>

        {/* Main Charts */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          {/* Traffic Trends Over Time */}
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                Traffic Trends Over Time
              </CardTitle>
              <CardDescription>
                Views and inquiries over the past 30 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleLineChart
                data={trafficData}
                lines={[
                  { key: "views", color: "#dc2626", label: "Views" },
                  { key: "inquiries", color: "#10b981", label: "Inquiries" },
                ]}
              />
              <div className="flex justify-center gap-4 mt-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-600 rounded" />
                  <span className="text-xs text-gray-600">Views</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-600 rounded" />
                  <span className="text-xs text-gray-600">Inquiries</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Peak Search Times */}
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-purple-600" />
                Peak Search Times
              </CardTitle>
              <CardDescription>Student activity by time of day</CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleBarChart
                data={peakTimesData}
                dataKey="activity"
                color="#8b5cf6"
              />
            </CardContent>
          </Card>
        </div>

        {/* Seasonal Trends */}
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              Seasonal Trends
            </CardTitle>
            <CardDescription>
              Monthly patterns in inquiries and lease signings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SeasonalChart data={seasonalTrends} />
            <div className="mt-4 grid gap-4 grid-cols-1 md:grid-cols-3">
              <div className="text-center p-3 bg-red-50 rounded-lg">
                <div className="text-lg font-bold text-red-600">
                  Peak Season
                </div>
                <div className="text-sm text-gray-600">May - August</div>
                <div className="text-xs text-gray-500 mt-1">
                  Highest inquiry volume
                </div>
              </div>
              <div className="text-center p-3 bg-yellow-50 rounded-lg">
                <div className="text-lg font-bold text-yellow-600">
                  Moderate Season
                </div>
                <div className="text-sm text-gray-600">
                  March - April, September
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Steady activity
                </div>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <div className="text-lg font-bold text-blue-600">
                  Low Season
                </div>
                <div className="text-sm text-gray-600">October - February</div>
                <div className="text-xs text-gray-500 mt-1">Reduced demand</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Geographic Heatmap */}
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-red-600" />
              Geographic Activity Heatmap
            </CardTitle>
            <CardDescription>
              Interest levels across different neighborhoods
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {heatmapData.map((area, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full ${area.color}`} />
                    <span className="font-medium">{area.area}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{area.intensity}%</div>
                    <div className="text-xs text-gray-500">activity</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Visual heatmap representation */}
            <div className="mt-6 relative w-full h-[200px] bg-gradient-to-br from-red-50 to-red-100 rounded-lg overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-red-500/20 via-yellow-500/30 to-red-500/40" />
              <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-2">
                <div className="text-sm font-medium mb-1">
                  Activity Intensity
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 bg-red-300 rounded" />
                  <span>Low</span>
                  <div className="w-3 h-3 bg-red-500 rounded" />
                  <span>Medium</span>
                  <div className="w-3 h-3 bg-red-700 rounded" />
                  <span>High</span>
                </div>
              </div>
              <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg p-2">
                <div className="text-xs font-medium">Campus District</div>
                <div className="text-xs text-gray-500">
                  Highest Activity (95%)
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Trend Insights */}
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              Trend Insights & Predictions
            </CardTitle>
            <CardDescription>
              AI-powered analysis of your listing trends
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
              <div className="space-y-3">
                <h4 className="font-semibold text-green-600">
                  📈 Positive Trends
                </h4>
                <div className="space-y-2">
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="font-medium text-sm">
                      Evening Traffic Surge
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      6PM-9PM shows 40% higher activity. Consider posting new
                      listings during these hours.
                    </div>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="font-medium text-sm">
                      Spring Momentum Building
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      March inquiries up 23% vs February. Prepare for peak
                      season demand.
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-red-600">
                  ⚠️ Areas to Watch
                </h4>
                <div className="space-y-2">
                  <div className="p-3 bg-red-50 rounded-lg">
                    <div className="font-medium text-sm">
                      Off-Campus Interest Declining
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      45% activity vs 95% on-campus. Consider adjusting pricing
                      or amenities.
                    </div>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg">
                    <div className="font-medium text-sm">
                      Weekend Activity Drop
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      Saturday-Sunday 30% lower activity. Focus marketing on
                      weekdays.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
