"use client";
import React, { useState } from "react";
import Modal from "./Modal";

export default function TourConfirmModal({ isOpen, onClose, tourData }) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
    wantFinancing: true,
  });

  // Set the message when the component mounts or tourData changes
  React.useEffect(() => {
    if (tourData?.listing?.address) {
      setFormData((prev) => ({
        ...prev,
        message: `I am interested in ${tourData.listing.address}.`,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        message: "I am interested in this property.",
      }));
    }
  }, [tourData]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Here you would typically send the data to your backend
    console.log("Tour confirmation submitted:", {
      ...formData,
      selectedDates: tourData?.dates,
      selectedTime: tourData?.time,
      listing: tourData?.listing,
    });
    // Show success message or close modal
    onClose();
  };

  const formatDate = (date) => {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return `${days[date.getDay()]}, ${
      months[date.getMonth()]
    } ${date.getDate()}`;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">
            Confirm your tour
          </h2>
          <div className="flex items-center space-x-2">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" />
              </svg>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" />
              </svg>
            </div>
          </div>
        </div>

        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          How can we reach out to confirm the tour?
        </h3>

        {/* Selected Tour Information */}
        {tourData && (
          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <h4 className="font-semibold text-gray-900 mb-2">
              Selected Tour Times:
            </h4>
            <div className="space-y-1">
              {tourData.dates?.map((date, index) => (
                <p key={index} className="text-gray-700">
                  {formatDate(date)} at {tourData.time}
                </p>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              placeholder="Enter your name"
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
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              placeholder="Enter your email"
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
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              placeholder="Enter your phone number"
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
              rows={3}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              placeholder="Enter your message"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full bg-red-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-red-700 transition-colors"
          >
            Request tour
          </button>

          {/* Financing Checkbox */}
          <div className="flex items-start space-x-3">
            <input
              type="checkbox"
              id="wantFinancing"
              name="wantFinancing"
              checked={formData.wantFinancing}
              onChange={handleInputChange}
              className="w-5 h-5 text-red-600 bg-gray-100 border-gray-300 rounded focus:ring-red-500"
            />
            <label htmlFor="wantFinancing" className="text-sm text-gray-700">
              I want financing information
            </label>
          </div>

          {/* Disclaimer */}
          <div className="text-xs text-gray-500 mt-4">
            By pressing Request tour, you are contacting a buyer&apos;s agent,
            you agree that Proximity and its affiliates may call/text you about
            your inquiry, which may involve use of automated means and
            prerecorded/artificial voices.
          </div>
        </form>
      </div>
    </Modal>
  );
}
