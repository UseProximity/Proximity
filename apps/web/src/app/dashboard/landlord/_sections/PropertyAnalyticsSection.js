"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  Pencil,
  Star,
  MessageSquare,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { getRentRangeLabel } from "@/utils/listingFormatters";
import PropertyPhotosSection from "./PropertyPhotosSection";
import ListingMetricsChart from "./ListingMetricsChart";

export default function PropertyAnalyticsSection({
  handleBackToProperties,
  selectedProperty: p,
  onEditListing,
  viewAsId,
  onPhotosChanged,
}) {
  const router = useRouter();
  const [allTimeMetrics, setAllTimeMetrics] = useState([]);
  const [contactTotals, setContactTotals] = useState({});

  const listingId = p?._id || p?.id;
  useEffect(() => {
    if (!listingId) return;
    const params = new URLSearchParams({ range: "all", listingIds: listingId });
    if (viewAsId) params.set("viewAs", viewAsId);
    fetch(`/api/landlord/metrics?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setAllTimeMetrics(data.metrics ?? []);
        setContactTotals(data.contactTotals ?? {});
      })
      .catch(console.error);
  }, [listingId, viewAsId]);

  if (!p) return null;

  const totalViews = allTimeMetrics
    .filter((m) => m.metric_type === "clicks")
    .reduce((sum, m) => sum + m.count, 0);
  const totalSaves = allTimeMetrics
    .filter((m) => m.metric_type === "saves")
    .reduce((sum, m) => sum + m.count, 0);
  const totalContacts = contactTotals[listingId] ?? 0;

  const units = p.unitTypes ?? [];
  const images = Array.isArray(p.images) ? p.images : [];
  const amenities = Array.isArray(p.amenities) ? p.amenities : [];
  const utilities = Array.isArray(p.utilitiesIncluded)
    ? p.utilitiesIncluded
    : [];

  const handleViewAsStudent = () => {
    window.open(`/browse?panel=${p._id || p.id}`, "_blank");
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
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
            {p.title || p.address}
          </h1>
          {p.title && <p className="text-sm text-gray-500">{p.address}</p>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge
            className={`${
              p.unavailable ? "bg-gray-500" : "bg-green-600"
            } text-white`}
          >
            {p.unavailable ? "Unavailable" : "Available"}
          </Badge>
          <button
            onClick={handleViewAsStudent}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
            View as Student
          </button>
          {onEditListing && (
            <button
              onClick={() => onEditListing(p)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Images */}
      {images.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {images.map((url, i) => (
            <img
              key={i}
              src={url}
              alt=""
              className="h-48 w-72 flex-shrink-0 object-cover rounded-xl border border-gray-200"
            />
          ))}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-5">
        {[
          {
            label: "Views",
            value: totalViews,
            icon: <Eye className="h-4 w-4 text-red-600" />,
          },
          {
            label: "Saves",
            value: totalSaves,
            icon: <Star className="h-4 w-4 text-yellow-500" />,
          },
          {
            label: "Contacts",
            value: totalContacts,
            icon: <MessageSquare className="h-4 w-4 text-blue-500" />,
          },
          {
            label: "Reviews",
            value: p.numReviews ?? 0,
            icon: <MessageSquare className="h-4 w-4 text-purple-500" />,
          },
          {
            label: "Rating",
            value:
              p.numReviews > 0 ? `${Number(p.rating).toFixed(1)} / 5` : "—",
            icon: <ThumbsUp className="h-4 w-4 text-green-500" />,
          },
        ].map(({ label, value, icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              {icon}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-listing metrics chart */}
      <ListingMetricsChart listingId={p._id || p.id} viewAsId={viewAsId} />

      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle>Property Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            {[
              { label: "Home type", value: p.homeType },
              { label: "Lease type", value: p.leaseType },
              { label: "Furnished", value: p.furnished ? "Yes" : "No" },
              {
                label: "Sublease friendly",
                value: p.subleaseFriendly ? "Yes" : "No",
              },
              {
                label: "Move-in date",
                value: p.moveInDate
                  ? new Date(p.moveInDate).toLocaleDateString()
                  : "—",
              },
              { label: "Rent range", value: getRentRangeLabel(units) || "—" },
            ].map(({ label, value }) => (
              <div key={label}>
                <dt className="text-gray-500 font-medium">{label}</dt>
                <dd className="text-gray-900 capitalize mt-0.5">
                  {value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Photos — sits above Units because a landlord edits pictures far more
          often than they edit the unit table. */}
      <PropertyPhotosSection property={p} onChanged={onPhotosChanged} />

      {/* Units */}
      {units.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Units ({units.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    {[
                      "Beds",
                      "Baths",
                      "Rent / mo",
                      "Area (sq ft)",
                      "Availability",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {units.map((u, i) => (
                    <tr
                      key={i}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50"
                    >
                      <td className="px-4 py-2.5">{u.bedrooms ?? "—"}</td>
                      <td className="px-4 py-2.5">{u.bathrooms ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        {u.rent != null ? `$${u.rent.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.area != null ? u.area.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.leaseAvailability ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Amenities & utilities */}
      {(amenities.length > 0 || utilities.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {amenities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Amenities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {amenities.map((a) => (
                    <span
                      key={a}
                      className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {utilities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Utilities Included</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {utilities.map((u) => (
                    <span
                      key={u}
                      className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium"
                    >
                      {u}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Contact info */}
      {(p.contactName || p.contactEmail || p.contactPhone) && (
        <Card>
          <CardHeader>
            <CardTitle>Contact Info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              {p.contactName && (
                <div>
                  <dt className="text-gray-500 font-medium">Name</dt>
                  <dd className="mt-0.5">{p.contactName}</dd>
                </div>
              )}
              {p.contactEmail && (
                <div>
                  <dt className="text-gray-500 font-medium">Email</dt>
                  <dd className="mt-0.5 break-all">{p.contactEmail}</dd>
                </div>
              )}
              {p.contactPhone && (
                <div>
                  <dt className="text-gray-500 font-medium">Phone</dt>
                  <dd className="mt-0.5">{p.contactPhone}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
