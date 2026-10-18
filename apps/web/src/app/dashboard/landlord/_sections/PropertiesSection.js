"use client";

import { Home, Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import PropertyCard from "./PropertyCard";
import { PublishButton } from "@/components/listings/editor/DraftControls";

// Complete enough to publish in bulk: some unit has a listing with a rent.
// The server applies the same test (/api/landlord/publish, scope "new").
const hasPrice = (property) =>
  (property.unitTypes ?? []).some((u) => (u.leases ?? []).some((l) => Number(l.rent) > 0));

/*
 * The landlord's properties, in one of two views under the Properties menu:
 *
 *   live    What students can see. A live property with unpublished additions
 *           stays here, carrying an amber count of them.
 *   drafts  What they can't yet. New properties that have never been published
 *           (where the website importer puts what it reads), then live
 *           properties with unpublished units or listings waiting on them.
 *
 * Same cards in both, so a draft looks like the listing it will become.
 */
export default function PropertiesSection({
  user,
  mode = "live",
  handlePropertySelect,
  router,
  onAddListing,
  onDeleteListing,
  onEditLease,
  onWithdrawLease,
  onRepublishLease,
  onManageCoOwners,
  onPublished,
}) {
  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading properties...</p>
      </div>
    );
  }

  const all = user.listings ?? [];
  const live = all.filter((l) => !l.isDraft);
  const newDrafts = all.filter((l) => l.isDraft);
  const readyDrafts = newDrafts.filter((l) => l.ownership !== "lease" && hasPrice(l));
  const pendingOnLive = live.filter(
    (l) =>
      (l.draftUnitCount ?? 0) + (l.draftLeaseCount ?? 0) > 0 ||
      (l.ownership === "lease" && l.myLeases?.some((x) => x.isDraft))
  );

  const cardProps = {
    handlePropertySelect,
    onDeleteListing,
    onEditLease,
    onWithdrawLease,
    onRepublishLease,
    onManageCoOwners,
    onPublished,
  };
  const grid = (list) => (
    <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {list.map((property) => (
        <PropertyCard
          key={property._id}
          property={property}
          missingPrice={property.isDraft && !hasPrice(property)}
          {...cardProps}
        />
      ))}
    </div>
  );

  const addButton = (
    <button
      onClick={onAddListing}
      className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
    >
      <Plus className="h-4 w-4" />
      Add Listing
    </button>
  );

  if (mode === "drafts") {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Drafts</h1>
            <p className="text-gray-500 text-sm sm:text-base">
              Students can&apos;t see anything here until you publish it.
            </p>
          </div>
          {addButton}
        </div>

        {newDrafts.length === 0 && pendingOnLive.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-amber-200 bg-amber-50/40 px-6 py-12 text-center">
            <FileText className="h-8 w-8 text-amber-400" />
            <p className="mt-3 text-gray-700 font-medium">No drafts right now.</p>
            <p className="mt-1 max-w-md text-sm text-gray-500">
              New units and listings you add to a live property start here, so
              you can check them before students see them.
            </p>
          </div>
        ) : (
          <>
            {newDrafts.length > 0 && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
                    New properties ({newDrafts.length})
                  </h2>
                  <PublishButton
                    kind="all"
                    scope="new"
                    size="md"
                    label={`Publish ${readyDrafts.length} complete ${readyDrafts.length === 1 ? "property" : "properties"}`}
                    disabledReason={
                      readyDrafts.length ? null : "None are complete yet. Each needs a listing with a price."
                    }
                    confirmText={`Publish ${readyDrafts.length} complete ${
                      readyDrafts.length === 1 ? "property" : "properties"
                    }? Each goes live with all its units and listings. Properties still missing a price stay here. This can't be undone, but you can still edit or withdraw them.`}
                    successText={(r) =>
                      `Published ${r?.published ?? 0} ${r?.published === 1 ? "property" : "properties"}.${
                        r?.skipped ? ` ${r.skipped} still need a price.` : ""
                      }`
                    }
                    onPublished={onPublished}
                  />
                </div>
                {grid(newDrafts)}
              </section>
            )}
            {pendingOnLive.length > 0 && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
                      Unpublished changes on live properties ({pendingOnLive.length})
                    </h2>
                    <p className="text-xs text-gray-500">
                      These properties are live. Students see them as they were
                      until you publish the new units and listings.
                    </p>
                  </div>
                  <PublishButton
                    kind="all"
                    scope="live"
                    size="md"
                    label="Publish all changes"
                    confirmText={`Publish your new units and listings on ${pendingOnLive.length} live ${
                      pendingOnLive.length === 1 ? "property" : "properties"
                    }? Students will see them right away. Drafts other landlords added stay theirs to publish. This can't be undone, but you can still edit or withdraw them.`}
                    successText="Published. Students can see your changes now."
                    onPublished={onPublished}
                  />
                </div>
                {grid(pendingOnLive)}
              </section>
            )}
          </>
        )}
      </div>
    );
  }

  // Empty state when no live properties
  if (live.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-red-50">
          <Home className="h-6 w-6 text-red-600" />
        </div>
        <p className="text-gray-600 text-lg">
          You don&apos;t have any live properties yet.
        </p>
        {newDrafts.length > 0 && (
          <p className="text-sm text-amber-700">
            You have {newDrafts.length} {newDrafts.length === 1 ? "draft" : "drafts"} waiting
            to be published under Properties, Drafts.
          </p>
        )}
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
            {live.filter((l) => !l.unavailable).length} Available
          </Badge>
          <Badge variant="secondary" className="bg-gray-100 text-gray-600">
            {live.filter((l) => l.unavailable).length} Unavailable
          </Badge>
          {addButton}
        </div>
      </div>

      {grid(live)}
    </div>
  );
}
