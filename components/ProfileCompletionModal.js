"use client";

import { useState, useEffect } from "react";
import Modal from "@/components/Modal";

export default function ProfileCompletionModal({ session }) {
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    birthday: "",
    gender: "",
    referralSource: "",
  });
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState(null);

  useEffect(() => {
    if (session?.user?.profileComplete === false) {
      setIsOpen(true);
    }

    const params = new URLSearchParams(window.location.search);
    setRole(params.get("role"));
  }, [session]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const isFormValid =
    formData.firstName && formData.lastName && formData.birthday && formData.gender && formData.referralSource;

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await fetch("/api/editProfile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: `${formData.firstName?.trim()} ${formData.lastName?.trim()}`,
          birthday: formData.birthday,
          gender: formData.gender,
          referralSource: formData.referralSource,
          profileComplete: true,
          role: role,
        }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const updated = await res.json();
      console.log("Profile updated:", updated);
      setIsOpen(false);
      window.location.reload();
    } catch (e) {
      console.error(e);
      alert("Couldn't save your profile. Please try again.");
    } finally {
      console.log("Saving profile data:", formData);
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => {}}>
      <div className="p-6 space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">
          Complete Your Profile
        </h2>
        <p className="text-gray-600">
          Please fill out the following information to complete your profile and
          access all features of Proximity.
        </p>
        <form className="space-y-6">
          {/* Name Field */}
          <div>
            <label
              htmlFor="firstName"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              First Name
            </label>
            <input
              type="text"
              id="firstName"
              name="firstName"
              value={formData.firstName}
              onChange={handleInputChange}
              className="block w-full px-4 py-2 rounded-lg border border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
              placeholder="Enter your first name"
            />
          </div>

          <div>
            <label
              htmlFor="lastName"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Last Name
            </label>
            <input
              type="text"
              id="lastName"
              name="lastName"
              value={formData.lastName}
              onChange={handleInputChange}
              className="block w-full px-4 py-2 rounded-lg border border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
              placeholder="Enter your last name"
            />
          </div>

          {/* Birthday Field */}
          <div>
            <label
              htmlFor="birthday"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Birthday
            </label>
            <input
              type="date"
              id="birthday"
              name="birthday"
              value={formData.birthday}
              onChange={handleInputChange}
              max={new Date().toISOString().split("T")[0]}
              className="block w-full px-4 py-2 rounded-lg border border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
            />
          </div>

          {/* Gender Field */}
          <div>
            <label
              htmlFor="gender"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Gender
            </label>
            <select
              id="gender"
              name="gender"
              value={formData.gender}
              onChange={handleInputChange}
              className="block w-full px-4 py-2 rounded-lg border border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
            >
              <option value="">Select your gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* How'd you find us */}
          <div>
            <label
              htmlFor="referralSource"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              How&apos;d you find us?
            </label>
            <select
              id="referralSource"
              name="referralSource"
              value={formData.referralSource}
              onChange={handleInputChange}
              className="block w-full px-4 py-2 rounded-lg border border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
            >
              <option value="" disabled>Select one…</option>
              <option value="Social Media">Social Media</option>
              <option value="A Friend">A Friend</option>
              <option value="Colleague">Colleague</option>
              <option value="On Campus">On Campus</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </form>

        {/* Save Button */}
        <div className="pt-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={!isFormValid || saving}
            className={`w-full px-4 py-2 rounded-lg text-white font-medium transition-all ${
              isFormValid
                ? "bg-red-600 hover:bg-red-700"
                : "bg-gray-300 cursor-not-allowed"
            }`}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
