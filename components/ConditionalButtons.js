"use client";

import Link from "next/link";
import { useState } from "react";
import TourRequestModal from "./TourRequestModal";
import ContactLandlordModal from "./ContactLandlordModal";
import TourConfirmModal from "./TourConfirmModal";
import ChatModal from "./ChatModal";

export default function ConditionalButtons({ listing, role }) {
  const [showTourModal, setShowTourModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [tourData, setTourData] = useState(null);

  const handleTourRequest = () => {
    setShowTourModal(true);
  };

  const handleContactLandlord = () => {
    setShowContactModal(true);
  };

  const handleContactSubmit = (formData) => {
    // Close the contact modal and open the chat modal
    setShowContactModal(false);
    setShowChatModal(true);
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
    setShowChatModal(false);
    setTourData(null);
  };

  return (
    <>
      <button
        onClick={handleTourRequest}
        className="bg-red-600 text-white py-2 px-4 rounded-lg text-lg hover:bg-red-700 mt-4 transition-colors"
      >
        Request a tour
      </button>
      <button
        onClick={handleContactLandlord}
        className="text-red-600 border border-red-600 py-2 px-4 rounded-lg text-lg hover:bg-red-50 transition-colors"
      >
        Contact Landlord
      </button>

      {/* Only show Find Roommate button for students */}
      {role === "student" && (
        <Link href="/roommate-finder">
          <button className="bg-blue-600 text-white py-2 px-4 rounded-lg text-lg hover:bg-blue-700 w-full transition-colors">
            Find Roommate
          </button>
        </Link>
      )}

      {/* Modals */}
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

      <ChatModal
        isOpen={showChatModal}
        onClose={() => setShowChatModal(false)}
        profile={{
          name: listing?.owner?.name || "Landlord",
          image: listing?.owner?.image || "/images/default-profile.jpg",
          age: listing?.owner?.age || "Unknown",
          gender: listing?.owner?.gender || "Unknown",
        }}
        currentUser="You"
        conversationType="landlord"
      />
    </>
  );
}
