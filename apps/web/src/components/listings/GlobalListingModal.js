/*
 * URL-driven listing detail modal that can open from any page in the app. Watches the
 * ?listing= search param — when present it fetches that listing from /api/listing/[id]
 * and renders it inside ModalListing + ListingModalInfo. Closing the modal removes the
 * param from the URL via router.replace so the back button works correctly and the URL
 * stays shareable. Mounted once in the root layout so a listing can be opened from the
 * browse map, search results, a saved list, or a direct link without any page transition.
 * Uses Suspense to avoid blocking the rest of the page while the modal data loads.
 *
 * ?preview=1 alongside ?listing= is the landlord's "View as Student": the same
 * modal, fed by the owner-only /api/landlord/listings/[id]/preview instead of
 * the public route, so a draft renders as it will once published and a live
 * property as students see it today. An amber strip across the top says which,
 * and ListingModalInfo's preview flag turns off Save, Contact and reviewing.
 * The strip can publish a draft; it tells the dashboard through a window event
 * because the modal lives in the root layout, outside the dashboard's tree.
 */
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Eye, MapPin } from "lucide-react";
import ModalListing from "@/components/listings/ModalListing";
import ListingModalInfo from "@/components/listings/ListingModalInfo";
import { PublishButton } from "@/components/listings/editor/DraftControls";

/*
 * What the landlord is looking at, in one line. A draft previews as it WILL
 * be; a live property as it IS, with any held-back drafts counted so nobody
 * wonders where the unit they added yesterday went. "Unavailable" gets its own
 * warning because it is the surprise worth preventing: a building whose units
 * have no listing is published, and invisible.
 */
function PreviewStrip({ listing, onPublished }) {
  const { isDraft, hiddenDraftUnits, hiddenDraftLeases, canPublish } = listing.preview;
  const hidden = (hiddenDraftUnits ?? 0) + (hiddenDraftLeases ?? 0);
  const noUnits = (listing.unitTypes ?? []).length === 0;

  const headline = isDraft
    ? "Preview. This is how students will see this property once it's published."
    : "Preview. This is what students see right now.";
  const detail = isDraft
    ? "Students can't see it yet."
    : hidden > 0
    ? `${hidden} unpublished ${hidden === 1 ? "change is" : "changes are"} not shown here. Students see the property as it was until you publish ${hidden === 1 ? "it" : "them"}.`
    : null;
  const unavailableNote = noUnits
    ? "There are no units here yet, so students have nothing to choose from."
    : listing.unavailable
    ? isDraft
      ? "No unit here has a live listing, so students would see this marked Unavailable."
      : "No unit here has a live listing, so students see this marked Unavailable."
    : null;

  return (
    <div className="shrink-0 rounded-t-xl border-b border-amber-200 bg-amber-50 px-6 py-3 pr-14">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex flex-1 items-start gap-2.5 min-w-0">
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div className="text-sm text-amber-900">
            <p>
              <span className="font-semibold">{headline}</span>
              {detail && <span> {detail}</span>}
            </p>
            {unavailableNote && (
              <p className="mt-0.5 text-xs text-amber-800">{unavailableNote}</p>
            )}
          </div>
        </div>
        {canPublish && (
          <div className="shrink-0 sm:pl-2">
            <PublishButton
              kind="property"
              id={listing._id}
              label="Publish property"
              size="md"
              onPublished={onPublished}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function GlobalListingModalInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const listingId = searchParams.get("listing");
  const preview = searchParams.get("preview") === "1";
  const viewAsId = searchParams.get("viewAs");
  const [modalData, setModalData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!listingId) {
      setModalData(null);
      setNotFound(false);
      return;
    }
    // Same listing, same mode: nothing to refetch. A switch between the public
    // view and the owner's preview of one listing is a different document.
    if (modalData?._id === listingId && !!modalData.preview === preview) return;

    setIsLoading(true);
    setNotFound(false);
    const url = preview
      ? `/api/landlord/listings/${listingId}/preview${viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : ""}`
      : `/api/listing/${listingId}`;
    fetch(url)
      .then((res) => {
        if (!res.ok) { setNotFound(true); return null; }
        return res.json();
      })
      .then((data) => {
        if (data) setModalData(data);
        setIsLoading(false);
      })
      .catch(() => { setNotFound(true); setIsLoading(false); });
  }, [listingId, preview, viewAsId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("listing");
    params.delete("preview");
    params.delete("unit");
    const qs = params.toString();
    router.replace(pathname + (qs ? "?" + qs : ""));
  };

  // A draft published from the strip: let the dashboard reload its lists, then
  // close. The property is live now, so there is nothing left to preview.
  const handlePublished = () => {
    window.dispatchEvent(
      new CustomEvent("proximity:listing-published", { detail: { listingId } })
    );
    handleClose();
  };

  // Open this listing's panel on the browse map. Only offered when the modal is
  // launched from the homepage (e.g. the "Popular rentals" cards) — elsewhere
  // the user is already in a browse/map context.
  const handleViewOnMap = () => {
    router.push(`/browse?panel=${listingId}&view=map`);
  };
  const showViewOnMap = pathname === "/" && !!modalData && !preview;

  if (!listingId) return null;

  const strip =
    preview && modalData?.preview && !isLoading && !notFound ? (
      <PreviewStrip listing={modalData} onPublished={handlePublished} />
    ) : null;

  return (
    <ModalListing isOpen={true} onClose={handleClose} header={strip}>
      {isLoading ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600" />
        </div>
      ) : notFound || !modalData ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center px-6">
          <p className="text-2xl">🏠</p>
          <p className="text-lg font-semibold text-gray-800">
            {preview ? "Couldn't load this preview" : "Listing not found"}
          </p>
          <p className="text-sm text-gray-500">
            {preview
              ? "You may need to sign in again, or this property may no longer be yours."
              : "This listing may have been removed or the link is invalid."}
          </p>
          <button
            onClick={handleClose}
            className="mt-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"
          >
            Close
          </button>
        </div>
      ) : (
        <>
          <ListingModalInfo
            session={session}
            listing={modalData}
            initialUnitId={searchParams.get("unit")}
            preview={preview}
            tabBarAction={
              showViewOnMap ? (
                <button
                  onClick={handleViewOnMap}
                  className="flex items-center gap-1.5 px-1 py-2 text-sm font-semibold text-red-600 whitespace-nowrap hover:text-red-700 transition-colors"
                >
                  <MapPin className="h-4 w-4" />
                  View on map
                </button>
              ) : null
            }
          />
        </>
      )}
    </ModalListing>
  );
}

export default function GlobalListingModal() {
  return (
    <Suspense fallback={null}>
      <GlobalListingModalInner />
    </Suspense>
  );
}
