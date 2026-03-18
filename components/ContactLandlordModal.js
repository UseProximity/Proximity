"use client";
import React, { useState, useEffect } from "react";

export default function ContactLandlordModal({
  isOpen,
  onClose,
  onSubmit,
  listing,
}) {
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    message: "",
    wantFinancing: true,
  });

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  // Set the message when the component mounts or listing changes
  useEffect(() => {
    if (listing?.address) {
      setFormData((prev) => ({
        ...prev,
        message: `I am interested in ${listing.address}.`,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        message: "I am interested in this property.",
      }));
    }
  }, [listing]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Persist contacted listing for dashboard tracking
    if (listing?._id) {
      fetch("/api/contacted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: listing._id }),
      }).catch(() => {});
    }

    if (onSubmit) {
      onSubmit(formData);
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden p-2">
      <div className="bg-white rounded-xl shadow-2xl border border-gray-100 relative w-full max-w-md max-h-[95vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xl z-10 w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 hover:scale-110"
        >
          ×
        </button>
        <div className="p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Contact a Landlord
          </h2>

          <p className="text-gray-600 mb-6">
            Connect with the property landlord.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name Field */}
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                required
                className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-base"
                placeholder="Enter your name"
              />
            </div>

            {/* Phone Field */}
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Phone <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                required
                className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-base"
                placeholder="Enter your phone number"
              />
            </div>

            {/* Email Field */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                required
                className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-base"
                placeholder="Enter your email"
              />
            </div>

            {/* Message Field */}
            <div>
              <label
                htmlFor="message"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Message
              </label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleInputChange}
                rows={4}
                className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-base resize-none"
                placeholder="Enter your message"
              />
            </div>

            {/* Financing Checkbox */}
            <div className="flex items-start space-x-3 pt-2">
              <input
                type="checkbox"
                id="wantFinancing"
                name="wantFinancing"
                checked={formData.wantFinancing}
                onChange={handleInputChange}
                className="w-5 h-5 text-red-600 bg-gray-100 border-gray-300 rounded focus:ring-red-500 mt-0.5"
              />
              <label
                htmlFor="wantFinancing"
                className="text-sm text-gray-700 leading-relaxed"
              >
                I want financing information
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full bg-red-600 text-white py-4 px-6 rounded-lg font-semibold text-base hover:bg-red-700 transition-colors mt-8"
            >
              Contact Landlord
            </button>

            {/* Disclaimer */}
            <div className="text-xs text-gray-500 mt-4">
              By pressing Contact Landlord, you are contacting the property
              landlord. You agree that Proximity and its affiliates may
              call/text you about your inquiry, which may involve use of
              automated means and prerecorded/artificial voices. You don&apos;t
              need to consent as a condition of any rental inquiry.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
