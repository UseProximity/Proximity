"use client";

import { useState } from "react";
import {
  TrendingUp,
  MapPin,
  Award,
  DollarSign,
  Home,
  Users,
  Target,
  BarChart3,
} from "lucide-react";

// Mock data
const rentComparisonData = [
  {
    type: "Studio",
    yourRent: 1200,
    marketAvg: 1150,
    competitors: 8,
    occupancy: 95,
  },
  {
    type: "1BR",
    yourRent: 1500,
    marketAvg: 1450,
    competitors: 12,
    occupancy: 92,
  },
  {
    type: "2BR",
    yourRent: 1900,
    marketAvg: 1850,
    competitors: 15,
    occupancy: 88,
  },
  {
    type: "3BR",
    yourRent: 2400,
    marketAvg: 2300,
    competitors: 10,
    occupancy: 85,
  },
  {
    type: "4BR",
    yourRent: 2800,
    marketAvg: 2650,
    competitors: 6,
    occupancy: 90,
  },
];

const competitorData = [
  {
    name: "University Commons",
    avgRent: 1650,
    occupancy: 94,
    rating: 4.2,
    distance: "0.3 miles",
  },
  {
    name: "Campus View Apartments",
    avgRent: 1580,
    occupancy: 89,
    rating: 4.0,
    distance: "0.5 miles",
  },
  {
    name: "Student Village",
    avgRent: 1720,
    occupancy: 96,
    rating: 4.5,
    distance: "0.7 miles",
  },
  {
    name: "College Park Residences",
    avgRent: 1450,
    occupancy: 82,
    rating: 3.8,
    distance: "1.2 miles",
  },
  {
    name: "Ivy Tower",
    avgRent: 1890,
    occupancy: 91,
    rating: 4.3,
    distance: "0.9 miles",
  },
];

const marketTrends = [
  {
    quarter: "Q1 2023",
    avgRent: 1520,
    yourRent: 1580,
    marketGrowth: 2.1,
    yourGrowth: 3.2,
  },
  {
    quarter: "Q2 2023",
    avgRent: 1545,
    yourRent: 1620,
    marketGrowth: 1.6,
    yourGrowth: 2.5,
  },
  {
    quarter: "Q3 2023",
    avgRent: 1580,
    yourRent: 1680,
    marketGrowth: 2.3,
    yourGrowth: 3.7,
  },
  {
    quarter: "Q4 2023",
    avgRent: 1610,
    yourRent: 1720,
    marketGrowth: 1.9,
    yourGrowth: 2.4,
  },
  {
    quarter: "Q1 2024",
    avgRent: 1640,
    yourRent: 1780,
    marketGrowth: 1.9,
    yourGrowth: 3.5,
  },
];

const amenityComparison = [
  { amenity: "Pool", yourProperty: true, marketAvg: 65, premium: "+$50" },
  {
    amenity: "Gym/Fitness Center",
    yourProperty: true,
    marketAvg: 78,
    premium: "+$75",
  },
  {
    amenity: "Parking Included",
    yourProperty: true,
    marketAvg: 45,
    premium: "+$100",
  },
  {
    amenity: "Pet Friendly",
    yourProperty: false,
    marketAvg: 60,
    premium: "+$25",
  },
  {
    amenity: "In-Unit Laundry",
    yourProperty: true,
    marketAvg: 40,
    premium: "+$125",
  },
  {
    amenity: "Balcony/Patio",
    yourProperty: true,
    marketAvg: 55,
    premium: "+$60",
  },
  {
    amenity: "High-Speed Internet",
    yourProperty: true,
    marketAvg: 85,
    premium: "+$30",
  },
  {
    amenity: "Study Rooms",
    yourProperty: false,
    marketAvg: 35,
    premium: "+$40",
  },
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
    success: "bg-green-100 text-green-800",
    warning: "bg-yellow-100 text-yellow-800",
    danger: "bg-red-100 text-red-800",
  };

  return (
    <div
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${variants[variant]} ${className}`}
    >
      {children}
    </div>
  );
};

const Progress = ({ value, className = "" }) => (
  <div className={`w-full bg-gray-200 rounded-full h-2 ${className}`}>
    <div
      className="bg-red-600 h-2 rounded-full transition-all duration-300"
      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
    />
  </div>
);

// Custom Bar Chart Component
const ComparisonBarChart = ({ data }) => {
  const maxRent = Math.max(
    ...data.map((item) => Math.max(item.yourRent, item.marketAvg))
  );

  return (
    <div className="w-full h-[300px] p-4">
      <div className="flex items-end justify-between gap-4 h-full">
        {data.map((item, index) => {
          const yourHeight = (item.yourRent / maxRent) * 250;
          const marketHeight = (item.marketAvg / maxRent) * 250;

          return (
            <div
              key={index}
              className="flex flex-col items-center gap-2 flex-1"
            >
              <div className="flex items-end gap-2 h-[250px]">
                <div className="flex flex-col items-center gap-1">
                  <div className="text-xs font-medium text-red-600">
                    ${item.yourRent}
                  </div>
                  <div
                    className="w-8 bg-red-500 rounded-t transition-all duration-300 hover:opacity-80"
                    style={{ height: `${yourHeight}px`, minHeight: "8px" }}
                  />
                  <div className="text-xs text-gray-500">You</div>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="text-xs font-medium text-gray-600">
                    ${item.marketAvg}
                  </div>
                  <div
                    className="w-8 bg-gray-400 rounded-t transition-all duration-300 hover:opacity-80"
                    style={{ height: `${marketHeight}px`, minHeight: "8px" }}
                  />
                  <div className="text-xs text-gray-500">Market</div>
                </div>
              </div>
              <div className="text-xs text-gray-700 font-medium">
                {item.type}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-center gap-4 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-500 rounded" />
          <span className="text-xs text-gray-600">Your Rent</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-gray-400 rounded" />
          <span className="text-xs text-gray-600">Market Average</span>
        </div>
      </div>
    </div>
  );
};

// Market Trends Line Chart
const TrendsLineChart = ({ data }) => {
  const maxRent = Math.max(
    ...data.flatMap((item) => [item.avgRent, item.yourRent])
  );
  const minRent = Math.min(
    ...data.flatMap((item) => [item.avgRent, item.yourRent])
  );
  const range = maxRent - minRent;

  return (
    <div className="w-full h-[200px] p-4">
      <div className="relative w-full h-full">
        <svg className="w-full h-full" viewBox="0 0 400 160">
          {/* Market average line */}
          <polyline
            fill="none"
            stroke="#6b7280"
            strokeWidth="2"
            strokeDasharray="5,5"
            points={data
              .map((item, index) => {
                const x = (index / (data.length - 1)) * 380 + 10;
                const y = 150 - ((item.avgRent - minRent) / range) * 140;
                return `${x},${y}`;
              })
              .join(" ")}
          />

          {/* Your rent line */}
          <polyline
            fill="none"
            stroke="#dc2626"
            strokeWidth="3"
            points={data
              .map((item, index) => {
                const x = (index / (data.length - 1)) * 380 + 10;
                const y = 150 - ((item.yourRent - minRent) / range) * 140;
                return `${x},${y}`;
              })
              .join(" ")}
          />

          {/* Data points */}
          {data.map((item, index) => {
            const x = (index / (data.length - 1)) * 380 + 10;
            const marketY = 150 - ((item.avgRent - minRent) / range) * 140;
            const yourY = 150 - ((item.yourRent - minRent) / range) * 140;

            return (
              <g key={index}>
                <circle cx={x} cy={marketY} r="3" fill="#6b7280" />
                <circle cx={x} cy={yourY} r="4" fill="#dc2626" />
              </g>
            );
          })}
        </svg>

        {/* X-axis labels */}
        <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-gray-500 px-2">
          {data.map((item, index) => (
            <span key={index}>{item.quarter}</span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function MarketComparisons() {
  const [selectedZipCode, setSelectedZipCode] = useState("12345");
  const [selectedPropertyType, setSelectedPropertyType] = useState("all");

  const calculateCompetitiveness = () => {
    const totalYourRent = rentComparisonData.reduce(
      (sum, item) => sum + item.yourRent,
      0
    );
    const totalMarketRent = rentComparisonData.reduce(
      (sum, item) => sum + item.marketAvg,
      0
    );
    return ((totalYourRent / totalMarketRent) * 10).toFixed(1);
  };

  const getMarketPosition = () => {
    const avgDifference =
      rentComparisonData.reduce((sum, item) => {
        return sum + ((item.yourRent - item.marketAvg) / item.marketAvg) * 100;
      }, 0) / rentComparisonData.length;

    if (avgDifference > 10)
      return { tier: "Premium", color: "text-red-600", percentage: 85 };
    if (avgDifference > 0)
      return { tier: "Above Average", color: "text-green-600", percentage: 65 };
    if (avgDifference > -5)
      return { tier: "Competitive", color: "text-blue-600", percentage: 50 };
    return { tier: "Budget", color: "text-gray-600", percentage: 25 };
  };

  const competitiveness = calculateCompetitiveness();
  const marketPosition = getMarketPosition();

  return (
    <div className="w-full min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-2xl">🏘️</div>
            <h1 className="text-2xl font-bold text-gray-900">
              Market Comparisons
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedZipCode}
              onChange={(e) => setSelectedZipCode(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="12345">12345 - Campus Area</option>
              <option value="12346">12346 - Downtown</option>
              <option value="12347">12347 - University District</option>
            </select>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Rent Competitiveness
              </CardTitle>
              <Award className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="text-2xl font-bold">{competitiveness}/10</div>
                <Progress value={competitiveness * 10} className="h-2" />
                <div className="text-xs text-gray-500">
                  <span className="text-green-600 font-medium">
                    Above average
                  </span>{" "}
                  pricing
                </div>
                <Badge variant="success">Competitive</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Market Position
              </CardTitle>
              <Target className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <span className={marketPosition.color}>
                  {marketPosition.tier}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Higher than{" "}
                <span className="font-medium">
                  {marketPosition.percentage}%
                </span>{" "}
                of comparable listings
              </div>
              <Badge variant="default" className="mt-2">
                <TrendingUp className="h-3 w-3 mr-1" />
                Top Quartile
              </Badge>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Demand Score
              </CardTitle>
              <Users className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">High</div>
              <div className="text-xs text-gray-500 mt-1">
                <span className="text-red-600 font-medium">92/100</span> demand
                index
              </div>
              <Badge variant="danger">
                <TrendingUp className="h-3 w-3 mr-1" />
                Hot Market
              </Badge>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Avg. Premium
              </CardTitle>
              <DollarSign className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">+$127</div>
              <div className="text-xs text-gray-500 mt-1">
                <span className="text-green-600 font-medium">+8.2%</span> above
                market
              </div>
              <div className="text-xs text-gray-500 mt-1">Per unit average</div>
            </CardContent>
          </Card>
        </div>

        {/* Rent Comparison Chart */}
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader>
            <CardTitle>Rent Comparison by Property Type</CardTitle>
            <CardDescription>
              Your pricing vs. market average in your area
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ComparisonBarChart data={rentComparisonData} />
          </CardContent>
        </Card>

        {/* Market Trends */}
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              Market Trends Over Time
            </CardTitle>
            <CardDescription>
              Quarterly rent progression comparison
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendsLineChart data={marketTrends} />
            <div className="flex justify-center gap-4 mt-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-600 rounded" />
                <span className="text-xs text-gray-600">Your Average Rent</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 bg-gray-400 rounded"
                  style={{ borderStyle: "dashed" }}
                />
                <span className="text-xs text-gray-600">Market Average</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Competitor Analysis */}
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5 text-purple-600" />
              Competitor Analysis
            </CardTitle>
            <CardDescription>Direct competitors in your area</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-2 font-medium text-gray-700">
                      Property
                    </th>
                    <th className="text-left py-3 px-2 font-medium text-gray-700">
                      Avg Rent
                    </th>
                    <th className="text-left py-3 px-2 font-medium text-gray-700">
                      Occupancy
                    </th>
                    <th className="text-left py-3 px-2 font-medium text-gray-700">
                      Rating
                    </th>
                    <th className="text-left py-3 px-2 font-medium text-gray-700">
                      Distance
                    </th>
                    <th className="text-left py-3 px-2 font-medium text-gray-700">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {competitorData.map((competitor, index) => (
                    <tr
                      key={index}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-3 px-2 font-medium">
                        {competitor.name}
                      </td>
                      <td className="py-3 px-2">${competitor.avgRent}</td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <span>{competitor.occupancy}%</span>
                          <div className="w-16 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-green-500 h-2 rounded-full"
                              style={{ width: `${competitor.occupancy}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-1">
                          <span>{competitor.rating}</span>
                          <div className="text-yellow-400">★</div>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-gray-600">
                        {competitor.distance}
                      </td>
                      <td className="py-3 px-2">
                        <Badge
                          variant={
                            competitor.avgRent > 1700
                              ? "danger"
                              : competitor.avgRent > 1600
                              ? "warning"
                              : "success"
                          }
                        >
                          {competitor.avgRent > 1700
                            ? "Premium"
                            : competitor.avgRent > 1600
                            ? "Mid-tier"
                            : "Budget"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Amenity Comparison */}
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-green-600" />
              Amenity Comparison
            </CardTitle>
            <CardDescription>
              How your amenities compare to market standards
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
              {amenityComparison.map((amenity, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-4 h-4 rounded-full ${
                        amenity.yourProperty ? "bg-green-500" : "bg-gray-300"
                      }`}
                    />
                    <span className="font-medium">{amenity.amenity}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      {amenity.marketAvg}% have this
                    </div>
                    <div className="text-xs text-green-600">
                      {amenity.premium} premium
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-4 grid-cols-1 md:grid-cols-3">
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {amenityComparison.filter((a) => a.yourProperty).length}
                </div>
                <div className="text-sm text-gray-600">Amenities You Offer</div>
                <div className="text-xs text-gray-500 mt-1">
                  vs{" "}
                  {(
                    amenityComparison.reduce((sum, a) => sum + a.marketAvg, 0) /
                    amenityComparison.length
                  ).toFixed(0)}
                  % market avg
                </div>
              </div>
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">+$465</div>
                <div className="text-sm text-gray-600">Total Premium Value</div>
                <div className="text-xs text-gray-500 mt-1">
                  From your amenities
                </div>
              </div>
              <div className="text-center p-4 bg-yellow-50 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">2</div>
                <div className="text-sm text-gray-600">Missing Amenities</div>
                <div className="text-xs text-gray-500 mt-1">
                  Potential +$65/month
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Market Insights */}
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-red-600" />
              Market Insights & Recommendations
            </CardTitle>
            <CardDescription>
              Data-driven suggestions for competitive positioning
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
              <div className="space-y-3">
                <h4 className="font-semibold text-green-600">
                  💪 Your Strengths
                </h4>
                <div className="space-y-2">
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="font-medium text-sm">
                      Premium Positioning
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      Your rents are 8.2% above market average, indicating
                      strong value proposition.
                    </div>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="font-medium text-sm">Amenity Advantage</div>
                    <div className="text-xs text-gray-600 mt-1">
                      You offer 6/8 premium amenities vs 4.8 market average.
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold text-yellow-600">
                  🎯 Opportunities
                </h4>
                <div className="space-y-2">
                  <div className="p-3 bg-yellow-50 rounded-lg">
                    <div className="font-medium text-sm">
                      Add Pet-Friendly Policy
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      60% of competitors allow pets. Could add $25/month
                      premium.
                    </div>
                  </div>
                  <div className="p-3 bg-yellow-50 rounded-lg">
                    <div className="font-medium text-sm">
                      Study Room Addition
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      Only 35% have study rooms. High student demand, $40/month
                      potential.
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
