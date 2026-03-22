"use client";

import Link from "next/link";
import { useState } from "react";
import TourRequestModal from "./TourRequestModal";
import ContactLandlordModal from "./ContactLandlordModal";
import TourConfirmModal from "./TourConfirmModal";
import { useChatContext } from "@/components/chat/ChatContext";

export default function ConditionalButtons({ listing, role }) {
  const [showTourModal, setShowTourModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [tourData, setTourData] = useState(null);
  const { openConversation } = useChatContext();

  const handleContactSubmit = () => {
    setShowContactModal(false);
    openConversation(
      {
        name: listing?.owner?.name || "Landlord",
        image: listing?.owner?.image || null,
      },
      "landlord"
    );
  };

  const handleTourConfirm = (data) => {
    setTourData(data);
    setShowTourModal(false);
    setShowConfirmModal(true);
  };

  const closeAllModals = () => {
    setShowTourModal(false);
    setShowContactModal(false);
    setShowConfirmModal(false);
    setTourData(null);
  };

  return (
    <>
      <button
        onClick={() => setShowTourModal(true)}
        className="bg-red-600 text-white py-2 px-4 rounded-lg text-lg hover:bg-red-700 mt-4 transition-colors"
      >
        Request a tour
      </button>
      <button
        onClick={() => setShowContactModal(true)}
        className="text-red-600 border border-red-600 py-2 px-4 rounded-lg text-lg hover:bg-red-50 transition-colors"
      >
        Contact Landlord
      </button>

      {role === "student" && (
        <Link href="/roommate-finder">
          <button className="bg-blue-600 text-white py-2 px-4 rounded-lg text-lg hover:bg-blue-700 w-full transition-colors">
            Find Roommate
          </button>
        </Link>
      )}

      <TourRequestModal
        isOpen={showTourModal}
        onClose={() => setShowTourModal(false)}
        onConfirm={handleTourConfirm}
        listing={listing}
      />

      <ContactLandlordModal
        isOpen={showContactModal}
        onClose={() => setShowContactModal(false)}
        onSubmit={handleContactSubmit}
        listing={listing}
      />

      <TourConfirmModal
        isOpen={showConfirmModal}
        onClose={closeAllModals}
        tourData={tourData}
      />
    </>
  );
}
