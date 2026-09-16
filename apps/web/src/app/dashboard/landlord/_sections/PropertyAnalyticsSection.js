"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  Star,
  MessageSquare,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import EditorOverview from "@/components/listings/editor/EditorOverview";
import { PropertyPhotoRow } from "@/components/listings/editor/EditorImageRows";
import EditorUnits from "@/components/listings/editor/EditorUnits";
import ListingMetricsChart from "./ListingMetricsChart";

export default function PropertyAnalyticsSection({
  handleBackToProperties,
  selectedProperty: p,
  viewAsId,
  onPhotosChanged,
  currentUserEmail,
}) {
  const router = useRouter();
  const [allTimeMetrics, setAllTimeMetrics] = useState([]);
  const [contactTotals, setContactTotals] = useState({});

  const listingId = p?._id || p?.id;
  // "lease" ownership means they hold an offering here but not the property
  // record; getUser tags it, and every endpoint re-checks it server-side.
  const isPropertyOwner = p?.ownership !== "lease";
  /*
   * Traffic figures belong to the property, and the API scopes them to
   * listing_landlords — so a lease-only stake gets an empty set no matter who
   * asks. Fetching it anyway painted a row of confident zeroes over a building
   * that is in fact being viewed and saved, which is worse than not showing it.
   */
  useEffect(() => {
    if (!listingId || !isPropertyOwner) return;
    const params = new URLSearchParams({ range: "all", listingIds: listingId });
    if (viewAsId) params.set("viewAs", viewAsId);
    fetch(`/api/landlord/metrics?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setAllTimeMetrics(data.metrics ?? []);
        setContactTotals(data.contactTotals ?? {});
      })
      .catch(console.error);
  }, [listingId, viewAsId, isPropertyOwner]);

  if (!p) return null;

  const totalViews = allTimeMetrics
    .filter((m) => m.metric_type === "clicks")
    .reduce((sum, m) => sum + m.count, 0);
  const totalSaves = allTimeMetrics
    .filter((m) => m.metric_type === "saves")
    .reduce((sum, m) => sum + m.count, 0);
  const totalContacts = contactTotals[listingId] ?? 0;

  const images = Array.isArray(p.images) ? p.images : [];

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
          {/* No Edit button. Everything below this header is editable in place
              now — the old button opened a separate modal over a panel that
              already edits itself, which meant two ways to change the same
              record and two chances to disagree about it. */}
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

      {/*
        * The listing as a student sees it, made editable. Structured the same
        * way — the building, then each unit, then the offerings on it — because
        * that is the shape of the data now, and because a landlord checking
        * their listing wants to see what a renter sees.
        *
        * Each level saves through its own endpoint. Nothing here can post the
        * whole property at once, which is what let a property owner's save
        * silently rewrite another landlord's offering.
        */}
      <EditorOverview
        listing={p}
        canEdit={isPropertyOwner}
        onChanged={onPhotosChanged}
      />

      <PropertyPhotoRow
        listing={p}
        isPropertyOwner={isPropertyOwner}
        onChanged={onPhotosChanged}
      />

      <EditorUnits
        listing={p}
        isPropertyOwner={isPropertyOwner}
        currentUserEmail={currentUserEmail}
        onChanged={onPhotosChanged}
      />

    </div>
  );
}
