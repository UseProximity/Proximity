"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import ModalListing from "@/components/show-listings/ModalListing";
import ListingModalInfo from "@/components/show-listings/ListingModalInfo";

function GlobalListingModalInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const listingId = searchParams.get("listing");
  const [modalData, setModalData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!listingId) {
      setModalData(null);
      setNotFound(false);
      return;
    }
    if (modalData?._id === listingId) return;

    setIsLoading(true);
    setNotFound(false);
    fetch(`/api/listing/${listingId}`)
      .then((res) => {
        if (!res.ok) { setNotFound(true); return null; }
        return res.json();
      })
      .then((data) => {
        if (data) setModalData(data);
        setIsLoading(false);
      })
      .catch(() => { setNotFound(true); setIsLoading(false); });
  }, [listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("listing");
    const qs = params.toString();
    router.replace(pathname + (qs ? "?" + qs : ""));
  };

  if (!listingId) return null;

  return (
    <ModalListing isOpen={true} onClose={handleClose}>
      {isLoading ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600" />
        </div>
      ) : notFound || !modalData ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center px-6">
          <p className="text-2xl">🏠</p>
          <p className="text-lg font-semibold text-gray-800">Listing not found</p>
          <p className="text-sm text-gray-500">This listing may have been removed or the link is invalid.</p>
          <button
            onClick={handleClose}
            className="mt-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"
          >
            Close
          </button>
        </div>
      ) : (
        <ListingModalInfo session={session} listing={modalData} />
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
