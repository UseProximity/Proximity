"use client";
import React, { useState } from "react";
import Modal from "./Modal";

export default function ContactLandlordModal({ isOpen, onClose, listing }) {
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    message: "",
    wantFinancing: true,
  });

  // Set the message when the component mounts or listing changes
  React.useEffect(() => {
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

  const handleSubmit = (e) => {
    e.preventDefault();
    // Here you would typically send the data to your backend
    console.log("Contact form submitted:", formData);
    // Show success message or close modal
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="w-full max-w-lg">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Contact a Buyer&apos;s Agent
        </h2>

        <p className="text-gray-600 mb-6">
          Connect with a local buyer&apos;s agent.
        </p>

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
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              placeholder="Enter your message"
            />
          </div>

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

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full bg-red-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-red-700 transition-colors"
          >
            Contact agent
          </button>

          {/* Disclaimer */}
          <div className="text-xs text-gray-500 mt-4">
            By pressing Contact agent, you are contacting a buyer&apos;s agent,
            you agree that Proximity and its affiliates, and{" "}
            <span className="underline">real estate professionals</span> may
            call/text you about your inquiry, which may involve use of automated
            means and prerecorded/artificial voices. You don&apos;t need to
            consent as a condition of any purchase.
          </div>
        </form>
      </div>
    </Modal>
  );
}
