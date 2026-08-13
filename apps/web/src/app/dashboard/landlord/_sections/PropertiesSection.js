"use client";

import { useState } from "react";
import {
  Home,
  Plus,
  MapPin,
  Bed,
  Bath,
  Square,
  Eye,
  User,
  Pencil,
  Users,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import {
  getUnitValuesLabel,
  getAreaRangeLabel,
  getRentRangeLabel,
} from "@/utils/listingFormatters";

export default function PropertiesSection({
  user,
  setUser,
  handlePropertySelect,
  router,
  onAddListing,
  onEditListing,
  onDeleteListing,
  onManageCoOwners,
}) {
  const [togglingId, setTogglingId] = useState(null);

  async function handleToggleUnavailable(e, property) {
    e.stopPropagation();
    setTogglingId(property._id);
    try {
      const res = await fetch(`/api/listing/${property._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unavailable: !property.unavailable }),
      });
      if (res.ok) {
        const { unavailable } = await res.json();
        setUser((prev) => ({
          ...prev,
          listings: prev.listings.map((l) =>
            l._id === property._id ? { ...l, unavailable } : l
          ),
        }));
      }
    } finally {
      setTogglingId(null);
    }
  }
  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading properties...</p>
      </div>
    );
  }

  // Empty state when no properties
  if (!user.listings || user.listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-red-50">
          <Home className="h-6 w-6 text-red-600" />
        </div>
        <p className="text-gray-600 text-lg">
          You don&apos;t have any properties yet.
        </p>
        <div className="flex gap-3">
          <Button
            variant="default"
            className="text-white bg-red-600 hover:bg-red-700"
            onClick={onAddListing}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Listing
          </Button>
          <Button
            variant="outline"
            className="border-gray-300"
            onClick={() => router.push("/browse")}
          >
            Browse Listings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Properties</h1>
          <p className="text-gray-500 text-sm sm:text-base">
            Manage and view analytics for all your listings
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2 sm:gap-3">
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            {user.listings.filter((l) => !l.unavailable).length} Available
          </Badge>
          <Badge variant="secondary" className="bg-gray-100 text-gray-600">
            {user.listings.filter((l) => l.unavailable).length} Unavailable
          </Badge>
          <button
            onClick={onAddListing}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Listing
          </button>
        </div>
      </div>

      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {user.listings.map((property) => (
          <Card
            key={property._id}
            className="hover:shadow-xl transition-all duration-300 cursor-pointer group border-0 shadow-md hover:scale-[1.02]"
            onClick={() => handlePropertySelect(property)}
          >
            <div className="relative overflow-hidden rounded-t-lg">
              {property.images?.length > 0 ? (
                <img
                  src={property.images[0]}
                  alt={property.title || property.address}
                  className="w-full h-48 object-cover"
                />
              ) : (
                <div
                  className={`w-full h-48 bg-gradient-to-br flex items-center justify-center ${
                    property.unavailable
                      ? "from-gray-100 to-gray-200"
                      : "from-red-100 to-red-200"
                  }`}
                >
                  <Home
                    className={`h-16 w-16 ${
                      property.unavailable ? "text-gray-400" : "text-red-400"
                    }`}
                  />
                </div>
              )}
              <Badge
                className={`absolute top-3 right-3 shadow-sm ${
                  property.unavailable ? "bg-gray-500" : "bg-green-600"
                }`}
              >
                {property.unavailable ? "Unavailable" : "Available"}
              </Badge>
              <button
                onClick={(e) => handleToggleUnavailable(e, property)}
                disabled={togglingId === property._id}
                className="absolute bottom-3 left-3 bg-white/90 hover:bg-white text-xs font-semibold px-2.5 py-1 rounded-full shadow transition disabled:opacity-50"
              >
                {togglingId === property._id
                  ? "Saving…"
                  : property.unavailable
                  ? "Mark Available"
                  : "Mark Unavailable"}
              </button>
            </div>

            <CardHeader className="pb-2">
              <CardTitle className="text-lg group-hover:text-red-600 transition-colors line-clamp-1">
                {property.title || property.address}
              </CardTitle>
              {/* Only show the address separately when the title isn't already it,
                  otherwise every card reads the same line twice. */}
              {property.title && (
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{property.address}</span>
                </div>
              )}
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <Bed className="h-3 w-3" />
                    <span className="font-medium">
                      {getUnitValuesLabel(property.unitTypes, "bedrooms")} bed
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Bath className="h-3 w-3" />
                    <span className="font-medium">
                      {getUnitValuesLabel(property.unitTypes, "bathrooms")} bath
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Square className="h-3 w-3" />
                    <span className="font-medium">
                      {getAreaRangeLabel(property.unitTypes)} SF
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-xl font-bold text-gray-900">
                {getRentRangeLabel(property.unitTypes)}
                <span className="text-sm font-normal text-gray-500">
                  /month
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-red-600" />
                <span className="text-sm font-medium text-gray-700">
                  {property.numClicks ?? 0} views
                </span>
              </div>

              {property.coOwners?.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <User className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    Shared with:{" "}
                    {property.coOwners
                      .map((o) => o.name || "Unknown")
                      .join(", ")}
                  </span>
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditListing(property);
                  }}
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-blue-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-blue-50 transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onManageCoOwners(property);
                  }}
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-purple-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-purple-50 transition-colors"
                >
                  <Users className="h-3.5 w-3.5" />
                  Co-owners
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteListing(property);
                  }}
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-red-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
