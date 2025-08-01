"use client";
import { useState } from "react";
import {
  Home,
  Heart,
  List,
  Settings,
  Bell,
  Star,
  Plus,
  MapPin,
} from "lucide-react";
import { Header } from "@/components/Header";

// Mock data
const subleases = [
  {
    id: 1,
    name: "Maple Street Apartment",
    address: "123 Maple Street, College Town",
    rent: 1200,
    status: "Active",
    image: "/placeholder.svg?height=200&width=300&text=Maple+Street+Apt",
  },
  {
    id: 2,
    name: "Oak Avenue House",
    address: "456 Oak Avenue, University District",
    rent: 1500,
    status: "Pending",
    image: "/placeholder.svg?height=200&width=300&text=Oak+Avenue+House",
  },
];

const favoriteListings = [
  {
    id: 1,
    name: "Pine Street Studio",
    address: "789 Pine Street, Campus Area",
    rent: 950,
    image: "/placeholder.svg?height=200&width=300&text=Pine+Street+Studio",
  },
  {
    id: 2,
    name: "Cedar Lane Duplex",
    address: "321 Cedar Lane, Student Housing",
    rent: 1800,
    image: "/placeholder.svg?height=200&width=300&text=Cedar+Lane+Duplex",
  },
];

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

// Main Dashboard Component
export default function StudentDashboard() {
  const [activeView, setActiveView] = useState("subleases");

  const handleNavigation = (key) => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setActiveView(key);
  };

  const getPageTitle = () => {
    switch (activeView) {
      case "subleases":
        return "My Subleases";
      case "favorites":
        return "My Favorite Listings";
      case "settings":
        return "Settings";
      default:
        return "Student Dashboard";
    }
  };

  const SubleasesSection = () => (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900">My Subleases</h2>
      <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {subleases.map((sublease) => (
          <Card key={sublease.id} className="hover:shadow-lg transition-shadow">
            <div className="relative overflow-hidden">
              <img
                src={sublease.image}
                alt={sublease.name}
                className="w-full h-48 object-cover"
              />
              <div
                className={`absolute top-3 right-3 px-2 py-1 rounded-full text-xs font-semibold ${
                  sublease.status === "Active"
                    ? "bg-green-600 text-white"
                    : "bg-yellow-500 text-white"
                }`}
              >
                {sublease.status}
              </div>
            </div>
            <CardHeader>
              <CardTitle>{sublease.name}</CardTitle>
              <p className="text-sm text-gray-500">{sublease.address}</p>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-bold text-gray-900">
                ${sublease.rent.toLocaleString()} /month
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const FavoriteListingsSection = () => (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900">My Favorite Listings</h2>
      <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {favoriteListings.map((listing) => (
          <Card key={listing.id} className="hover:shadow-lg transition-shadow">
            <div className="relative overflow-hidden">
              <img
                src={listing.image}
                alt={listing.name}
                className="w-full h-48 object-cover"
              />
            </div>
            <CardHeader>
              <CardTitle>{listing.name}</CardTitle>
              <p className="text-sm text-gray-500">{listing.address}</p>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-bold text-gray-900">
                ${listing.rent.toLocaleString()} /month
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeView) {
      case "subleases":
        return <SubleasesSection />;
      case "favorites":
        return <FavoriteListingsSection />;
      case "settings":
        return (
          <div className="p-8 text-center text-gray-500">
            Settings page coming soon...
          </div>
        );
      default:
        return <SubleasesSection />;
    }
  };

  return (
    <div className="w-full min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <Header />

      <div className="flex">
        {/* Sidebar */}
        <div className="w-64 bg-white border-r border-gray-200 h-screen sticky top-0 overflow-y-auto">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-white font-bold">
                S
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold">Proximity</span>
                <span className="text-xs text-gray-500">Student Portal</span>
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
                  onClick={() => handleNavigation("subleases")}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                    activeView === "subleases"
                      ? "bg-red-50 text-red-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <List className="h-4 w-4" />
                  My Subleases
                </button>
                <button
                  onClick={() => handleNavigation("favorites")}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                    activeView === "favorites"
                      ? "bg-red-50 text-red-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <Heart className="h-4 w-4" />
                  My Favorite Listings
                </button>
                <button
                  onClick={() => handleNavigation("settings")}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                    activeView === "settings"
                      ? "bg-red-50 text-red-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <Settings className="h-4 w-4" />
                  Settings
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
