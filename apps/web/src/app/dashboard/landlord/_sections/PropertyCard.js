"use client";

import {
  Home,
  MapPin,
  Bed,
  Bath,
  Square,
  Eye,
  User,
  Pencil,
  Users,
  Trash2,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { PublishButton } from "@/components/listings/editor/DraftControls";
import {
  getUnitValuesLabel,
  getAreaRangeLabel,
  getRentRangeLabel,
} from "@/utils/listingFormatters";

/**
 * Rent across the landlord's OWN offerings at a property: the dashboard
 * equivalent of getRentRangeLabel, but scoped to what is actually theirs.
 */
function myLeaseRentLabel(myLeases = []) {
  // Nothing on the market is not a price on request. It is no offer at all,
  // and "Contact for Pricing" invites an enquiry students cannot make.
  if (myLeases.length && !myLeases.some((l) => l.isLive)) return "Not listed";
  const rents = myLeases
    .filter((l) => l.isLive && l.rent != null)
    .map((l) => Number(l.rent))
    .filter(Number.isFinite);
  if (!rents.length) return "Contact for Pricing";
  const lo = Math.min(...rents);
  const hi = Math.max(...rents);
  const fmt = (n) => `$${n.toLocaleString("en-US")}`;
  return lo === hi ? fmt(lo) : `${fmt(lo)}-${fmt(hi)}`;
}

/*
 * One property on the dashboard. Shared by the Live and Drafts views so a draft
 * looks exactly like the listing it will become, marked out by an amber dashed
 * edge, an amber Draft badge where Available would sit, and a Publish button.
 * A live property carrying unpublished additions keeps its live look and gains
 * an amber count of them.
 */
export default function PropertyCard({
  property,
  handlePropertySelect,
  onDeleteListing,
  onEditLease,
  onWithdrawLease,
  onRepublishLease,
  onManageCoOwners,
  onPublished,
  missingPrice = false,
}) {
  const isDraft = !!property.isDraft;
  const pendingCount = isDraft
    ? 0
    : (property.draftUnitCount ?? 0) + (property.draftLeaseCount ?? 0);
  const rentLabel =
    property.ownership === "lease"
      ? myLeaseRentLabel(property.myLeases)
      : getRentRangeLabel(property.unitTypes);

  return (
    <Card
      className={`hover:shadow-xl transition-all duration-300 cursor-pointer group shadow-md hover:scale-[1.02] ${
        isDraft ? "border-2 border-dashed border-amber-300 bg-amber-50/40" : "border-0"
      }`}
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
              isDraft
                ? "from-amber-50 to-amber-100"
                : property.unavailable
                ? "from-gray-100 to-gray-200"
                : "from-red-100 to-red-200"
            }`}
          >
            <Home
              className={`h-16 w-16 ${
                isDraft
                  ? "text-amber-400"
                  : property.unavailable
                  ? "text-gray-400"
                  : "text-red-400"
              }`}
            />
          </div>
        )}
        {/* Not the shared Badge: its default red wins over amber in the CSS. */}
        {isDraft ? (
          <span className="absolute top-3 right-3 rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm">
            Draft
          </span>
        ) : (
          <Badge
            className={`absolute top-3 right-3 shadow-sm ${
              property.unavailable ? "bg-gray-500" : "bg-green-600"
            }`}
          >
            {property.unavailable ? "Unavailable" : "Available"}
          </Badge>
        )}
        {pendingCount > 0 && (
          <span className="absolute top-3 left-3 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 shadow-sm">
            {pendingCount} unpublished {pendingCount === 1 ? "change" : "changes"}
          </span>
        )}
      </div>
      {/* A draft says so in words as well as colour, and says what to do next. */}
      {isDraft && (
        <p className="px-4 pt-3 text-xs text-amber-800">
          Not visible to students. Open it to check the details, then publish.
          {missingPrice && (
            <span className="block font-semibold">
              No price yet, so Publish all complete skips it.
            </span>
          )}
        </p>
      )}
      {/* Availability is not a switch anyone flips here. It is the sum of
          the offerings on this property, so when the badge reads grey the
          useful thing to say is which offerings would turn it green. */}
      {!isDraft && property.unavailable && (
        <p className="px-4 pt-3 text-xs text-amber-700">
          Students can&apos;t see this: no unit here has a live offering.
          Publish a listing on a unit to put it back on the market.
        </p>
      )}

      <CardHeader className="pb-2">
        <CardTitle className="text-lg group-hover:text-red-600 transition-colors">
          {property.name}
          {/*TODO should a property have a name? Would is be easier for the landlord to manage? */}
        </CardTitle>
        <div className="flex items-center gap-1 text-sm text-gray-500">
          <MapPin className="h-3 w-3" />
          <span className="truncate">{property.address}</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {property.ownership === "lease" && property.myLeases?.length > 0 && (
          <>
            <p className="text-xs text-gray-500">
              Your {property.myLeases.length === 1 ? "listing" : "listings"}:{" "}
              {property.myLeases
                .map(
                  (x) =>
                    `${x.unitLabel ?? `${x.bedrooms ?? "?"} bed`}${
                      x.isDraft ? " (draft)" : x.isLive ? "" : " (withdrawn)"
                    }`
                )
                .join(", ")}
            </p>
            {/* The withdrawal itself always worked; only the card never
                admitted it, so the button read as broken and got pressed
                again. Say the state, and offer the way back. */}
            {!property.myLeases.some((x) => x.isLive || x.isDraft) && (
              <p className="text-xs text-amber-700">
                Withdrawn. Students can&apos;t see your price or contact
                details. Publish it again when you&apos;re ready.
              </p>
            )}
          </>
        )}

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

        {/*
          * At a property someone else owns, the building's rent range is
          * mostly OTHER landlords' prices, so quoting it back as "your"
          * listing is simply wrong. Show their own offering instead.
          */}
        <div className="text-xl font-bold text-gray-900">
          {rentLabel}
          <span className="text-sm font-normal text-gray-500">
            /month
          </span>
        </div>

        {/* A draft has had no visitors, and a row of zeroes says nothing. */}
        {!isDraft && (
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-red-600" />
            <span className="text-sm font-medium text-gray-700">
              {property.numClicks ?? 0} views
            </span>
          </div>
        )}

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

        {/*
          * Edit / Co-owners / Delete all act on the shared PROPERTY record,
          * so they belong to whoever owns that record. A landlord who owns
          * only an offering here (ownership: "lease") gets their own
          * controls instead. The property is not theirs to change, and
          * showing them buttons that 403 is worse than showing none.
          */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          {property.ownership === "lease" ? (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditLease(property);
                }}
                className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-blue-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-blue-50 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit my listing
              </button>
              {property.myLeases?.some((x) => x.isDraft) ? (
                // Their pending offerings are published from the property page,
                // one by one, where each can be checked first.
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePropertySelect(property);
                  }}
                  className="flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-800 font-medium px-2.5 py-1.5 rounded-md hover:bg-amber-50 transition-colors"
                >
                  Review drafts
                </button>
              ) : property.myLeases?.some((x) => x.isLive) ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onWithdrawLease(property);
                  }}
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-red-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Withdraw
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRepublishLease(property);
                  }}
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-green-700 font-medium px-2.5 py-1.5 rounded-md hover:bg-green-50 transition-colors"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Publish again
                </button>
              )}
              <span className="ml-auto self-center text-[11px] text-gray-400">
                Listed at another owner&apos;s property
              </span>
            </>
          ) : (
            <>
              {/*
                * Opens the property itself, where the building, each unit
                * and each offering are edited in place through their own
                * endpoints. It used to open a flat form that posted the
                * whole listing back at once, which overwrote the rent and
                * sublease flag of whichever offering on each unit happened
                * to be oldest (someone else's, at a shared property) and
                * deleted every photo the form had not loaded.
                */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePropertySelect(property);
                }}
                className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-blue-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-blue-50 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              {!isDraft && (
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
              )}
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
              {(isDraft || pendingCount > 0) && (
                <span className="ml-auto">
                  <PublishButton
                    kind="property"
                    id={property.id ?? property._id}
                    label={isDraft ? "Publish" : "Publish all"}
                    onPublished={onPublished}
                  />
                </span>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
