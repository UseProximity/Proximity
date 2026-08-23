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
import {
  AMENITY_LABELS,
  UTILITY_LABELS,
  LEASE_TERM_PRESETS,
} from "@/components/listings/listingFormOptions";
import ListingMetricsChart from "./ListingMetricsChart";

// Units store lease terms as month counts; landlords set them with named
// presets ("Semester", "12-Month"), so echo the same names back here.
const formatLeaseTerms = (months) => {
  if (!Array.isArray(months) || months.length === 0) return "—";
  return months
    .slice()
    .sort((a, b) => a - b)
    .map(
      (m) =>
        LEASE_TERM_PRESETS.find((p) => p.months === m)?.label ?? `${m}-Month`
    )
    .join(", ");
};

export default function PropertyAnalyticsSection({
  handleBackToProperties,
  selectedProperty: p,
  onEditListing,
  viewAsId,
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
  const hasUnitTitles = units.some((u) => u.title);
  const images = Array.isArray(p.images) ? p.images : [];
  const amenities = Array.isArray(p.amenities) ? p.amenities : [];
  const customAmenities = Array.isArray(p.customAmenities)
    ? p.customAmenities
    : [];
  const utilities = Array.isArray(p.utilitiesIncluded)
    ? p.utilitiesIncluded
    : [];

  const handleViewAsStudent = () => {
    window.open(`/browse?panel=${p._id || p.id}`, "_blank");
  };

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header: back link on its own line, then title left / actions right, so
          nothing has to wrap mid-button on narrower screens. */}
      <div className="space-y-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToProperties}
          className="-ml-2 flex items-center gap-2 whitespace-nowrap hover:bg-red-50 hover:text-red-600"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Back to Properties
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 truncate">
              {p.title || p.address}
            </h1>
            {p.title && (
              <p className="text-sm text-gray-500 truncate">{p.address}</p>
            )}
          </div>
          {/* shrink-0 only from sm up: on a phone these three must be allowed to
              wrap, or they push the page into a horizontal scroll. */}
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
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
              <Eye className="h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-nowrap">View as Student</span>
            </button>
            {onEditListing && (
              <button
                onClick={() => onEditListing(p)}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">Edit</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Images — deliberately small. This page is about performance, so the
          photos are a reference strip, not the subject; keeping them short is
          what lets the stat cards and the chart sit above the fold on landing. */}
      {images.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {images.map((url, i) => (
            <img
              key={i}
              src={url}
              alt=""
              className="h-28 w-40 flex-shrink-0 object-cover rounded-lg border border-gray-200"
            />
          ))}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
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
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-1">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              {icon}
            </CardHeader>
            <CardContent className="p-4 pt-0">
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
              { label: "21+ only", value: p.twentyOnePlus ? "Yes" : "No" },
              {
                // An empty move-in date is the "Available now" signal, not
                // missing data — say so rather than showing a dash.
                label: "Available from",
                value: p.moveInDate
                  ? new Date(p.moveInDate).toLocaleDateString()
                  : "Available now",
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
                      ...(hasUnitTitles ? ["Unit"] : []),
                      "Beds",
                      "Baths",
                      "Rent / mo",
                      "Area (sq ft)",
                      "Lease terms",
                      "Status",
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
                      {hasUnitTitles && (
                        <td className="px-4 py-2.5 font-medium text-gray-900">
                          {u.title || "—"}
                        </td>
                      )}
                      <td className="px-4 py-2.5">{u.bedrooms ?? "—"}</td>
                      <td className="px-4 py-2.5">{u.bathrooms ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        {u.rent != null ? `$${u.rent.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.area != null ? u.area.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {formatLeaseTerms(u.leaseTermMonths)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.available === false
                              ? "bg-gray-100 text-gray-600"
                              : "bg-green-50 text-green-700"
                          }`}
                        >
                          {u.available === false ? "Unavailable" : "Available"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Amenities & utilities. Values are stored as slugs (air_conditioning);
          show the same labels the landlord picked in the edit form. */}
      {(amenities.length > 0 ||
        customAmenities.length > 0 ||
        utilities.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(amenities.length > 0 || customAmenities.length > 0) && (
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
                      {AMENITY_LABELS[a] ?? a}
                    </span>
                  ))}
                  {customAmenities.map((a) => (
                    <span
                      key={`custom-${a}`}
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
                      {UTILITY_LABELS[u] ?? u}
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
