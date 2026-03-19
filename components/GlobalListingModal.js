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

  useEffect(() => {
    if (!listingId) {
      setModalData(null);
      return;
    }
    if (modalData?._id === listingId) return;

    setIsLoading(true);
    fetch(`/api/listing/${listingId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setModalData(data);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [listingId]);

  const handleClose = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("listing");
    const qs = params.toString();
    router.replace(pathname + (qs ? "?" + qs : ""));
  };

  if (!listingId) return null;

  return (
    <ModalListing isOpen={true} onClose={handleClose}>
      {isLoading || !modalData ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600" />
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
