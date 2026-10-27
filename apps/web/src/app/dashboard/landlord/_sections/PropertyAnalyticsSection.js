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
import EditorContact from "@/components/listings/editor/EditorContact";
import EditorUnits from "@/components/listings/editor/EditorUnits";
import ImportGaps from "@/components/listings/editor/ImportGaps";
import BackToTop from "@/components/ui/BackToTop";
import ListingMetricsChart from "./ListingMetricsChart";
import AgentTab from "@/components/landlord/AgentTab";
import { DraftBadge, PublishButton } from "@/components/listings/editor/DraftControls";

export default function PropertyAnalyticsSection({
  handleBackToProperties,
  backLabel = "Back to Properties",
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
  const pendingCount = (p.draftUnitCount ?? 0) + (p.draftLeaseCount ?? 0);

  /*
   * Opens the same listing popup students get from the homepage cards, right
   * here over the dashboard, through the global ?listing= modal in preview
   * mode. It used to send the landlord off to the browse page in a new tab,
   * which could not show a draft at all (the public API hides them) and
   * counted the landlord's own look as a student click in their metrics.
   * Built from window.location so the dashboard's own tab/property/viewAs
   * params, which it writes with history.replaceState, come along.
   */
  const handleViewAsStudent = () => {
    const params = new URLSearchParams(window.location.search);
    params.set("listing", listingId);
    params.set("preview", "1");
    router.push(`?${params.toString()}`);
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
          {backLabel}
        </Button>
        <div className="h-4 w-px bg-gray-300" />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {p.title || p.address}
          </h1>
          {p.title && <p className="text-sm text-gray-500">{p.address}</p>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {p.isDraft ? (
            <DraftBadge className="px-2.5 py-1 text-xs" />
          ) : (
            <Badge
              className={`${
                p.unavailable ? "bg-gray-500" : "bg-green-600"
              } text-white`}
            >
              {p.unavailable ? "Unavailable" : "Available"}
            </Badge>
          )}
          {/* On a draft this shows what students WILL see once it's published;
              on a live property, what they see now. */}
          <button
            onClick={handleViewAsStudent}
            title={
              p.isDraft
                ? "See this draft the way students will once it's published"
                : "See this property the way students see it now"
            }
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
            View as Student
          </button>
          {/* No Edit button. Everything below this header is editable in place
              now, the old button opened a separate modal over a panel that
              already edits itself, which meant two ways to change the same
              record and two chances to disagree about it. */}
        </div>
      </div>

      {/*
        * The draft banner. Amber across the top, so nobody mistakes a draft for
        * what students are seeing. Publishing the property takes everything on
        * it live at once; on a live property with unpublished additions, the
        * same button publishes the owner's pending units and listings together.
        */}
      {p.isDraft ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">
              This property is a draft. Students can&apos;t see it yet.
            </p>
            <p className="text-xs text-amber-800">
              Check the details, units and listings below, then publish it to put
              all of it on Proximity.
            </p>
          </div>
          {isPropertyOwner && (
            <PublishButton kind="property" id={listingId} label="Publish property"
              size="md" onPublished={onPhotosChanged} />
          )}
        </div>
      ) : (
        pendingCount > 0 && (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-amber-900">
              <span className="font-semibold">
                {pendingCount} unpublished {pendingCount === 1 ? "change" : "changes"} here.
              </span>{" "}
              Marked Draft below. Students see the property as it was until you
              publish them.
            </p>
            {isPropertyOwner && (
              <PublishButton kind="property" id={listingId} label="Publish all"
                size="md" onPublished={onPhotosChanged} />
            )}
          </div>
        )
      )}

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
      {/* Stat cards. A draft has had no visitors, so it skips straight to the
          editor below rather than showing a wall of zeroes. */}
      {!p.isDraft && (
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
            label: "Inquiries",
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

      )}

      {/* Per-listing metrics chart */}
      {!p.isDraft && (
        <ListingMetricsChart listingId={p._id || p.id} viewAsId={viewAsId} />
      )}

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
      <BackToTop />
      {/* A draft says what it still needs, with a way to each field. */}
      {p.isDraft && <ImportGaps listing={p} />}

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

      {/* Who students reach: one block for every lease this landlord owns
          here, so it sits above the units rather than inside each offering. */}
      <EditorContact listing={p} onChanged={onPhotosChanged} />

      <EditorUnits
        listing={p}
        isPropertyOwner={isPropertyOwner}
        currentUserEmail={currentUserEmail}
        onChanged={onPhotosChanged}
      />

      {/* The listing's agent: what Proxy knows, what is waiting on the
          landlord, and the conversation that edits the listing (PRD v3). */}
      {!p.isDraft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent</CardTitle>
          </CardHeader>
          <CardContent>
            <AgentTab listingId={listingId} viewAsId={viewAsId} />
          </CardContent>
        </Card>
      )}

    </div>
  );
}
