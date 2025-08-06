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
      <div className="w-full max-w-lg mx-auto">
        {/* Header with gradient background */}
        <div
          className="bg-gradient-to-r from-red-500 to-red-600 text-white p-4 rounded-t-lg"
          onWheel={(e) => e.stopPropagation()}
          onScroll={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-2">Confirm Your Tour</h2>
              <p className="text-red-100">Complete your booking details</p>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-12 h-12 bg-red-400 rounded-xl flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-white"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="w-12 h-12 bg-red-400 rounded-xl flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-white"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 bg-white">
          {/* Selected Tour Information with better styling */}
          {tourData && (
            <div className="bg-gradient-to-r from-red-50 to-pink-50 border-l-4 border-red-500 p-4 rounded-lg mb-6">
              <h4 className="font-bold text-lg text-gray-900 mb-3 flex items-center">
                <svg
                  className="w-5 h-5 text-red-500 mr-2"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"
                    clipRule="evenodd"
                  />
                </svg>
                Your Selected Tour Times
              </h4>
              <div className="space-y-2">
                {tourData.dates?.map((date, index) => (
                  <div
                    key={index}
                    className="flex items-center p-2 bg-white rounded-lg shadow-sm border border-red-200"
                  >
                    <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center mr-3">
                      <span className="text-white font-bold text-xs">
                        {date.getDate()}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        {formatDate(date)}
                      </p>
                      <p className="text-red-600 font-medium">
                        {tourData.time}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h3 className="text-lg font-bold text-gray-900 mb-4">
            How can we reach you to confirm?
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name and Email in a single column for smaller modal */}
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  className="w-full p-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors"
                  placeholder="Enter your full name"
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  className="w-full p-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors"
                  placeholder="Enter your email"
                />
              </div>
            </div>

            {/* Phone Field */}
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-semibold text-gray-700 mb-2"
              >
                Phone Number <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                required
                className="w-full p-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors"
                placeholder="Enter your phone number"
              />
            </div>

            {/* Message Field */}
            <div>
              <label
                htmlFor="message"
                className="block text-sm font-semibold text-gray-700 mb-2"
              >
                Additional Message
              </label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleInputChange}
                rows={3}
                className="w-full p-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors resize-none"
                placeholder="Any specific questions or requests?"
              />
            </div>

            {/* Financing Checkbox with better styling */}
            <div className="flex items-start space-x-3 p-3 bg-red-50 rounded-xl border border-red-200">
              <input
                type="checkbox"
                id="wantFinancing"
                name="wantFinancing"
                checked={formData.wantFinancing}
                onChange={handleInputChange}
                className="w-5 h-5 text-red-600 bg-white border-red-300 rounded focus:ring-red-500 mt-1"
              />
              <div>
                <label
                  htmlFor="wantFinancing"
                  className="font-medium text-gray-900 block"
                >
                  I&apos;m interested in financing options
                </label>
                <p className="text-sm text-gray-600 mt-1">
                  Get pre-qualified and learn about mortgage options
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-3 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 px-4 border-2 border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 hover:border-gray-400 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 bg-gradient-to-r from-red-500 to-red-600 text-white py-3 px-4 rounded-xl font-semibold hover:from-red-600 hover:to-red-700 transition-all transform hover:scale-105 shadow-lg"
              >
                Confirm Tour Request
              </button>
            </div>

            {/* Disclaimer with better styling */}
            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 mt-4">
              <p className="text-xs text-gray-600 leading-relaxed">
                <strong>Privacy Notice:</strong> By submitting this request, you
                agree that Proximity and its affiliated agents may contact you
                about your inquiry using automated systems and prerecorded
                messages. Message and data rates may apply.
              </p>
            </div>
          </form>
        </div>
      </div>
    </Modal>
  );
}
