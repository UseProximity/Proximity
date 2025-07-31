"use client";

import { useState } from "react";
import { Users, Calendar, TrendingDown, TrendingUp } from "lucide-react";

// Mock data
const funnelData = [
  { stage: "Inquiries", count: 127, percentage: 100, color: "bg-red-500" },
  {
    stage: "Applications",
    count: 45,
    percentage: 35.4,
    color: "bg-yellow-500",
  },
  { stage: "Signed Leases", count: 12, percentage: 9.4, color: "bg-green-500" },
];

const leadToLeaseData = [
  { month: "Jan", days: 18 },
  { month: "Feb", days: 22 },
  { month: "Mar", days: 16 },
  { month: "Apr", days: 19 },
  { month: "May", days: 14 },
  { month: "Jun", days: 21 },
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

// Simple Bar Chart Component
const SimpleBarChart = ({ data, dataKey, color = "#10b981" }) => {
  const maxValue = Math.max(...data.map((item) => item[dataKey]));

  return (
    <div className="w-full h-[180px] flex items-end justify-between gap-2 p-4">
      {data.map((item, index) => {
        const height = (item[dataKey] / maxValue) * 140;
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
            <div className="text-xs text-gray-500">{item.month}</div>
          </div>
        );
      })}
    </div>
  );
};

export default function LeasingFunnel() {
  const [selectedTimeframe, setSelectedTimeframe] = useState("month");

  return (
    <div className="w-full min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="text-2xl">📅</div>
          <h1 className="text-2xl font-bold text-gray-900">Leasing Funnel</h1>
        </div>

        {/* Key Metrics */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Conversion Rate
              </CardTitle>
              <Users className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">9.4%</div>
              <div className="text-xs text-gray-500 mt-1">
                <span className="text-red-600 font-medium">-2.1%</span> from
                last month
              </div>
              <div className="text-xs text-gray-500 mt-1">
                12 leases from 127 inquiries
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Avg. Days on Market
              </CardTitle>
              <Calendar className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">28 days</div>
              <div className="text-xs text-gray-500 mt-1">
                <span className="text-green-600 font-medium">-3 days</span> from
                last month
              </div>
              <Badge
                variant="secondary"
                className="mt-2 bg-green-100 text-green-800"
              >
                <TrendingDown className="h-3 w-3 mr-1" />
                Improving
              </Badge>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Abandonment Rate
              </CardTitle>
              <CardDescription className="text-xs">
                Users who started messages but didn&aptos;t send them
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">23.5%</div>
              <div className="text-xs text-gray-500 mt-1">
                <span className="text-red-600 font-medium">+1.8%</span> from
                last month
              </div>
              <div className="text-xs text-gray-500 mt-1">
                30 started, 7 abandoned
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Charts */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          {/* Conversion Funnel */}
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader>
              <CardTitle>Conversion Funnel</CardTitle>
              <CardDescription>
                Journey from inquiries to signed leases
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {funnelData.map((stage, index) => (
                  <div key={stage.stage} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-4 h-4 rounded-full ${stage.color}`}
                        />
                        <span className="font-medium">{stage.stage}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{stage.count}</div>
                        <div className="text-xs text-gray-500">
                          {stage.percentage}%
                        </div>
                      </div>
                    </div>

                    {/* Visual funnel bar */}
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full transition-all duration-500 ${stage.color}`}
                        style={{ width: `${stage.percentage}%` }}
                      />
                    </div>

                    {/* Drop-off indicator */}
                    {index < funnelData.length - 1 && (
                      <div className="text-xs text-red-600 text-right">
                        -{funnelData[index].count - funnelData[index + 1].count}{" "}
                        dropped off
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Lead-to-Lease Time */}
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader>
              <CardTitle>Lead-to-Lease Time</CardTitle>
              <CardDescription>
                Average days from first inquiry to lease signing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleBarChart
                data={leadToLeaseData}
                dataKey="days"
                color="#10b981"
              />
            </CardContent>
          </Card>
        </div>

        {/* Detailed Funnel Analysis */}
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader>
            <CardTitle>Funnel Performance Analysis</CardTitle>
            <CardDescription>
              Detailed breakdown of each stage performance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
              {/* Stage 1: Inquiries */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full" />
                  <h4 className="font-semibold">Inquiries Stage</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Inquiries:</span>
                    <span className="font-medium">127</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Response Rate:</span>
                    <span className="font-medium text-green-600">98%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Avg Response Time:</span>
                    <span className="font-medium">2.3 hours</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Quality Score:</span>
                    <span className="font-medium">8.2/10</span>
                  </div>
                </div>
              </div>

              {/* Stage 2: Applications */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-yellow-500 rounded-full" />
                  <h4 className="font-semibold">Applications Stage</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Applications:</span>
                    <span className="font-medium">45</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Conversion Rate:</span>
                    <span className="font-medium text-yellow-600">35.4%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Avg Processing:</span>
                    <span className="font-medium">3.2 days</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Approval Rate:</span>
                    <span className="font-medium">73%</span>
                  </div>
                </div>
              </div>

              {/* Stage 3: Signed Leases */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full" />
                  <h4 className="font-semibold">Signed Leases</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Signed Leases:</span>
                    <span className="font-medium">12</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Final Conversion:</span>
                    <span className="font-medium text-green-600">9.4%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Avg Lease Value:</span>
                    <span className="font-medium">$1,847</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Revenue Generated:</span>
                    <span className="font-medium text-green-600">$22,164</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Improvement Recommendations */}
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              Improvement Recommendations
            </CardTitle>
            <CardDescription>
              AI-powered suggestions to optimize your leasing funnel
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
              <div className="space-y-3">
                <h4 className="font-semibold text-red-600">🎯 High Impact</h4>
                <div className="space-y-2">
                  <div className="p-3 bg-red-50 rounded-lg">
                    <div className="font-medium text-sm">
                      Reduce Application Drop-off
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      64.6% of inquiries don&aptos;t convert to applications.
                      Consider simplifying your application process.
                    </div>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg">
                    <div className="font-medium text-sm">
                      Follow-up Strategy
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      Implement automated follow-ups for inquiries that
                      don&aptos;t respond within 24 hours.
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-yellow-600">⚡ Quick Wins</h4>
                <div className="space-y-2">
                  <div className="p-3 bg-yellow-50 rounded-lg">
                    <div className="font-medium text-sm">Virtual Tours</div>
                    <div className="text-xs text-gray-600 mt-1">
                      Add virtual tours to increase application conversion by an
                      estimated 15-20%.
                    </div>
                  </div>
                  <div className="p-3 bg-yellow-50 rounded-lg">
                    <div className="font-medium text-sm">
                      Response Templates
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      Create templates for common inquiries to reduce response
                      time to under 1 hour.
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
