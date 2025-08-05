"use client";

import { useState } from "react";
import {
  Calendar,
  BarChart3,
  TrendingUp,
  MapPin,
  Settings,
  Bell,
  Target,
  Search,
  Home,
  Plus,
  User,
  Eye,
  MessageSquare,
  Clock,
  TrendingDown,
  Star,
  ThumbsUp,
  Bed,
  Bath,
  Square,
  ArrowLeft,
  Menu,
} from "lucide-react";

import LeasingFunnel from "@/components/landlord-dashboard/leasing-funnel";
import TrendIndicators from "@/components/landlord-dashboard/trend-indicators";
import MarketComparisons from "@/components/landlord-dashboard/market-comparisons";
import { Header } from "@/components/Header";

// Mock data
const properties = [
  {
    id: 1,
    name: "Maple Street Apartment",
    address: "123 Maple Street, College Town",
    beds: 2,
    baths: 1,
    sqft: 850,
    viewCount: 1247,
    weeklyGrowth: 12.5,
    monthlyGrowth: 8.3,
    image: "/placeholder.svg?height=200&width=300&text=Maple+Street+Apt",
    status: "Available",
    rent: 1500,
  },
  {
    id: 2,
    name: "Oak Avenue House",
    address: "456 Oak Avenue, University District",
    beds: 3,
    baths: 2,
    sqft: 1200,
    viewCount: 892,
    weeklyGrowth: -3.2,
    monthlyGrowth: 15.7,
    image: "/placeholder.svg?height=200&width=300&text=Oak+Avenue+House",
    status: "Rented",
    rent: 2100,
  },
  {
    id: 3,
    name: "Pine Street Studio",
    address: "789 Pine Street, Campus Area",
    beds: 0,
    baths: 1,
    sqft: 450,
    viewCount: 634,
    weeklyGrowth: 8.9,
    monthlyGrowth: -2.1,
    image: "/placeholder.svg?height=200&width=300&text=Pine+Street+Studio",
    status: "Available",
    rent: 950,
  },
  {
    id: 4,
    name: "Cedar Lane Duplex",
    address: "321 Cedar Lane, Student Housing",
    beds: 4,
    baths: 2,
    sqft: 1600,
    viewCount: 1523,
    weeklyGrowth: 18.4,
    monthlyGrowth: 22.6,
    image: "/placeholder.svg?height=200&width=300&text=Cedar+Lane+Duplex",
    status: "Available",
    rent: 2800,
  },
];

const reviews = [
  {
    id: 1,
    tenant: "Sarah Johnson",
    rating: 5,
    date: "2 days ago",
    comment:
      "Excellent landlord! Very responsive to maintenance requests and the property was exactly as described.",
    helpful: 12,
    property: "Maple Street Apartment",
  },
  {
    id: 2,
    tenant: "Mike Chen",
    rating: 4,
    date: "1 week ago",
    comment:
      "Great communication throughout the lease process. Property was clean and well-maintained.",
    helpful: 8,
    property: "Oak Avenue House",
  },
];

const mockLandlord = {
  name: "John Smith",
  age: 45,
  gender: "Male",
  numReviews: 4,
  rating: 4,
  image: "https://picsum.photos/200/200?random=101",
  description:
    "Experienced landlord with a passion for providing quality housing.",
  role: "landlord",
  favorites: [],
  email: "john.smith@example.com",
  phone: "+1234567890",
};

// Simple components
const Card = ({ children, className = "", onClick }) => (
  <div
    className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}
    onClick={onClick}
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

const Button = ({
  children,
  variant = "default",
  size = "default",
  className = "",
  onClick,
  ...props
}) => {
  const baseClasses =
    "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background";

  const variants = {
    default: "bg-red-600 text-white hover:bg-red-700",
    ghost: "hover:bg-gray-100 hover:text-gray-900",
    outline: "border border-gray-200 bg-white hover:bg-gray-50",
  };

  const sizes = {
    default: "h-10 py-2 px-4",
    sm: "h-9 px-3 rounded-md",
    icon: "h-10 w-10",
  };

  return (
    <button
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
};

const Badge = ({ children, variant = "default", className = "" }) => {
  const variants = {
    default: "bg-red-600 text-white",
    secondary: "bg-gray-100 text-gray-900",
    outline: "border border-gray-200 bg-white text-gray-900",
  };

  return (
    <div
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${variants[variant]} ${className}`}
    >
      {children}
    </div>
  );
};

const StarRating = ({ rating, size = "sm" }) => {
  const starSize = size === "lg" ? "h-5 w-5" : "h-4 w-4";

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`${starSize} ${
            star <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
          }`}
        />
      ))}
    </div>
  );
};

// Main Dashboard Component
export default function ProximityDashboard() {
  const [activeView, setActiveView] = useState("profile");
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleNavigation = (key) => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setActiveView(key);
    setSelectedProperty(null);
    setSidebarOpen(false);
  };

  const handlePropertySelect = (property) => {
    setSelectedProperty(property);
    setActiveView("property-analytics");
  };

  const handleBackToProperties = () => {
    setSelectedProperty(null);
    setActiveView("properties");
  };

  const getPageTitle = () => {
    if (selectedProperty) return selectedProperty.name;
    switch (activeView) {
      case "properties":
        return "Properties";
      case "settings":
        return "Settings";
      case "reviews":
        return "My Reviews";
      case "profile":
        return "My Profile";
      case "analytics":
        return "Analytics";
      default:
        return "Landlord Dashboard";
    }
  };

  const Profile = () => (
    <div className="bg-white p-8 rounded-lg shadow-lg mb-8">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Profile Image */}
        <div className="flex-shrink-0">
          <img
            src={mockLandlord.image}
            alt={mockLandlord.name}
            className="w-32 h-32 rounded-full object-cover border border-gray-200 shadow-md"
          />
        </div>

        {/* Profile Info */}
        <div className="flex-1">
          <h1 className="text-4xl font-bold text-gray-900">
            {mockLandlord.name}
          </h1>
          <div className="text-yellow-500 text-xl mt-2">
            {"★".repeat(mockLandlord.rating)}
            <span className="text-gray-300">
              {"★".repeat(5 - mockLandlord.rating)}
            </span>
          </div>
          <p className="text-gray-500 mt-2 text-lg">0 active listings</p>
          <p className="text-gray-600 text-base mt-4">
            {mockLandlord.description}
          </p>
          <p className="text-gray-400 text-base mt-2">
            {mockLandlord.age} years old • {mockLandlord.gender}
          </p>
          <p className="text-gray-500 text-base mt-2">
            📞 {mockLandlord.phone} • ✉️ {mockLandlord.email}
          </p>

          {/* Additional Info */}
          <div className="mt-6">
            <h2 className="text-xl font-semibold text-gray-900">About Me</h2>
            <p className="text-gray-600 mt-2">
              I am an experienced landlord with a passion for providing quality
              housing. I believe in maintaining open communication with my
              tenants and ensuring their needs are met promptly.
            </p>
          </div>
        </div>

        {/* Edit Button */}
        <div className="flex-shrink-0">
          <Button
            variant="default"
            size="default"
            className="w-full md:w-auto text-white bg-red-600 hover:bg-red-700"
          >
            Edit Profile
          </Button>
        </div>
      </div>
    </div>
  );

  // Analytics Dashboard Content
  const AnalyticsDashboard = () => (
    <div className="space-y-6">
      {/* Listing Performance */}
      <div className="space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="text-2xl">📊</div>
          <h2 className="text-xl font-bold text-gray-900">
            Listing Performance
          </h2>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Listing Views
              </CardTitle>
              <Eye className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">2,847</div>
              <div className="text-xs text-gray-500 mt-1">
                <span className="text-green-600 font-medium">+12.5%</span> from
                last week
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Inquiries</CardTitle>
              <MessageSquare className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">127</div>
              <div className="text-xs text-gray-500 mt-1">
                <span className="text-green-600 font-medium">+8.2%</span> from
                last week
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Conversion Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">9.4%</div>
              <div className="text-xs text-gray-500 mt-1">
                <span className="text-red-600 font-medium">-2.1%</span> from
                last month
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Avg. Time on Page
              </CardTitle>
              <Clock className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">5.4 min</div>
              <div className="text-xs text-gray-500 mt-1">
                <span className="text-green-600 font-medium">+0.8 min</span>{" "}
                from last week
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Leasing Funner */}
      <LeasingFunnel />

      {/* Trend Indicators */}
      <TrendIndicators />

      {/* Market Comparisons */}
      <MarketComparisons />
    </div>
  );

  // Properties Page Content
  const PropertiesPage = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Properties</h1>
          <p className="text-gray-500">
            Manage and view analytics for all your listings
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            {properties.filter((p) => p.status === "Available").length}{" "}
            Available
          </Badge>
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            {properties.filter((p) => p.status === "Rented").length} Rented
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {properties.map((property) => (
          <Card
            key={property.id}
            className="hover:shadow-xl transition-all duration-300 cursor-pointer group border-0 shadow-md hover:scale-[1.02]"
            onClick={() => handlePropertySelect(property)}
          >
            <div className="relative overflow-hidden">
              <div className="w-full h-48 bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center">
                <Home className="h-16 w-16 text-red-400" />
              </div>
              <Badge
                className={`absolute top-3 right-3 shadow-sm ${
                  property.status === "Available"
                    ? "bg-green-600"
                    : "bg-blue-600"
                }`}
              >
                {property.status}
              </Badge>
            </div>

            <CardHeader className="pb-2">
              <CardTitle className="text-lg group-hover:text-red-600 transition-colors">
                {property.name}
              </CardTitle>
              <div className="flex items-center gap-1 text-sm text-gray-500">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{property.address}</span>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <Bed className="h-3 w-3" />
                    <span className="font-medium">
                      {property.beds === 0 ? "Studio" : `${property.beds} bed`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Bath className="h-3 w-3" />
                    <span className="font-medium">{property.baths} bath</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Square className="h-3 w-3" />
                    <span className="font-medium">{property.sqft} SF</span>
                  </div>
                </div>
              </div>

              <div className="text-xl font-bold text-gray-900">
                ${property.rent.toLocaleString()}
                <span className="text-sm font-normal text-gray-500">
                  /month
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-red-600" />
                <span className="text-sm font-medium text-gray-700">
                  {property.viewCount.toLocaleString()} views
                </span>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <div className="flex items-center gap-2">
                  {property.weeklyGrowth >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  )}
                  <span
                    className={`text-sm font-medium ${
                      property.weeklyGrowth >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {property.weeklyGrowth >= 0 ? "+" : ""}
                    {property.weeklyGrowth}% this week
                  </span>
                </div>
                <div
                  className={`text-sm font-medium ${
                    property.monthlyGrowth >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {property.monthlyGrowth >= 0 ? "+" : ""}
                  {property.monthlyGrowth}% monthly
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const ReviewsPage = () => {
    const [selectedProperty, setSelectedProperty] = useState("All Properties");
    const [selectedRating, setSelectedRating] = useState("All Ratings");
    const [currentPage, setCurrentPage] = useState(1);

    const reviewsPerPage = 5;

    // Mock data for rating distribution
    const ratingDistribution = [
      { stars: 5, count: 10 },
      { stars: 4, count: 5 },
      { stars: 3, count: 2 },
      { stars: 2, count: 1 },
      { stars: 1, count: 0 },
    ];

    // Filter reviews based on selected property and rating
    const filteredReviews = reviews.filter((review) => {
      const matchesProperty =
        selectedProperty === "All Properties" ||
        review.property === selectedProperty;
      const matchesRating =
        selectedRating === "All Ratings" ||
        review.rating === parseInt(selectedRating);
      return matchesProperty && matchesRating;
    });

    // Paginate reviews
    const startIndex = (currentPage - 1) * reviewsPerPage;
    const paginatedReviews = filteredReviews.slice(
      startIndex,
      startIndex + reviewsPerPage
    );

    return (
      <div className="space-y-6">
        {/* Header Section */}
        {/* Header Section */}
        <div className="space-y-6">
          <div className="flex flex-col items-center space-y-4">
            {/* Average Rating and Total Reviews */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Star className="h-6 w-6 text-yellow-400" />
                <span className="text-2xl font-bold">
                  {(
                    reviews.reduce((sum, review) => sum + review.rating, 0) /
                    reviews.length
                  ).toFixed(1)}
                </span>
              </div>
              <div className="text-sm text-gray-600">
                <span className="font-bold">{reviews.length}</span> Reviews
              </div>
            </div>

            {/* Enlarged Rating Distribution Chart */}
            <div className="flex items-center gap-6">
              {ratingDistribution.map((rating) => (
                <div key={rating.stars} className="flex flex-col items-center">
                  <span className="text-sm font-medium">{rating.stars}★</span>
                  <div
                    className="w-6 bg-red-600 rounded"
                    style={{ height: `${rating.count * 15}px` }}
                  ></div>
                  <span className="text-xs text-gray-500">{rating.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <select
            value={selectedProperty}
            onChange={(e) => setSelectedProperty(e.target.value)}
            className="border rounded-lg px-4 py-2 text-sm"
          >
            <option>All Properties</option>
            {properties.map((property) => (
              <option key={property.id}>{property.name}</option>
            ))}
          </select>
          <select
            value={selectedRating}
            onChange={(e) => setSelectedRating(e.target.value)}
            className="border rounded-lg px-4 py-2 text-sm"
          >
            <option>All Ratings</option>
            {[5, 4, 3, 2, 1].map((rating) => (
              <option key={rating} value={rating}>
                {rating} Stars
              </option>
            ))}
          </select>
        </div>

        {/* Reviews List */}
        <Card>
          <CardContent className="p-6">
            <div className="space-y-6 py-5">
              {paginatedReviews.map((review) => (
                <div
                  key={review.id}
                  className="border-b border-gray-100 last:border-0 pb-6 last:pb-0"
                >
                  <div className="flex items-start gap-4">
                    <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <h4 className="font-medium">{review.tenant}</h4>
                        <StarRating rating={review.rating} />
                        <span className="text-xs text-gray-500">
                          {review.date}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">{review.comment}</p>
                      <div className="text-xs text-gray-500">
                        Property:{" "}
                        <span className="font-medium">{review.property}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <button className="flex items-center gap-1 hover:text-red-600">
                          <MessageSquare className="h-3 w-3" />
                          Reply
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            className="px-4 py-2 text-sm border rounded-lg disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {currentPage} of{" "}
            {Math.ceil(filteredReviews.length / reviewsPerPage)}
          </span>
          <button
            onClick={() =>
              setCurrentPage((prev) =>
                Math.min(
                  prev + 1,
                  Math.ceil(filteredReviews.length / reviewsPerPage)
                )
              )
            }
            disabled={
              currentPage === Math.ceil(filteredReviews.length / reviewsPerPage)
            }
            className="px-4 py-2 text-sm border rounded-lg disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  // Property Analytics Content
  const PropertyAnalytics = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToProperties}
          className="flex items-center gap-2 hover:bg-red-50 hover:text-red-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Properties
        </Button>
        <div className="h-4 w-px bg-gray-300" />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {selectedProperty?.name}
          </h1>
          <p className="text-sm text-gray-500">{selectedProperty?.address}</p>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 max-w-7xl mx-auto">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Property Views
            </CardTitle>
            <Eye className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {selectedProperty?.viewCount}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              <span className="text-green-600 font-medium">
                +{selectedProperty?.weeklyGrowth}%
              </span>{" "}
              this week
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Rent</CardTitle>
            <Home className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${selectedProperty?.rent}</div>
            <div className="text-xs text-gray-500 mt-1">Per month</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Property Size</CardTitle>
            <Square className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{selectedProperty?.sqft}</div>
            <div className="text-xs text-gray-500 mt-1">Square feet</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <MapPin className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{selectedProperty?.status}</div>
            <div className="text-xs text-gray-500 mt-1">Current status</div>
          </CardContent>
        </Card>
      </div>

      {/* Leasing Funner */}
      <LeasingFunnel />

      {/* Trend Indicators */}
      <TrendIndicators />

      {/* Market Comparisons */}
      <MarketComparisons />
    </div>
  );

  const renderContent = () => {
    if (selectedProperty) return <PropertyAnalytics />;
    switch (activeView) {
      case "properties":
        return <PropertiesPage />;
      case "reviews":
        return <ReviewsPage />;
      case "profile":
        return <Profile />;
      case "analytics":
        return <AnalyticsDashboard />;
      default:
        return <Profile />;
    }
  };

  return (
    <div className="w-full min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <Header />

      <div className="flex">
        {/* Sidebar */}
        <div
          className={`${
            sidebarOpen ? "block" : "hidden"
          } md:block w-64 bg-white border-r border-gray-200 h-screen sticky top-0 overflow-y-auto`}
        >
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-white font-bold">
                P
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold">Proximity</span>
                <span className="text-xs text-gray-500">Landlord Portal</span>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                Overview
              </h3>
              <div className="space-y-1">
                <button
                  onClick={() => handleNavigation("profile")}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                    activeView === "profile"
                      ? "bg-red-50 text-red-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <User className="h-4 w-4" />
                  My Profile
                </button>
                <button
                  onClick={() => handleNavigation("analytics")}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                    activeView === "analytics"
                      ? "bg-red-50 text-red-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <BarChart3 className="h-4 w-4" />
                  Analytics
                </button>
                <button
                  onClick={() => handleNavigation("properties")}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                    activeView === "properties" || selectedProperty
                      ? "bg-red-50 text-red-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <MapPin className="h-4 w-4" />
                  Properties
                </button>
                <button
                  onClick={() => handleNavigation("reviews")}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                    activeView === "reviews"
                      ? "bg-red-50 text-red-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <Star className="h-4 w-4" />
                  Reviews
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          <div className="flex items-center justify-between border-b bg-white px-6 py-4">
            <h1 className="text-lg font-semibold text-gray-900">
              {getPageTitle()}
            </h1>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-red-50 hover:text-red-600"
              >
                <Bell className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-red-50 hover:text-red-600"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <main className="p-6">{renderContent()}</main>
        </div>
      </div>
    </div>
  );
}
