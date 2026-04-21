"use client";

import { useState, useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import Modal from "@/components/Modal";

const ROLES = ["Student", "Landlord", "Parent", "Other"];

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

function getClassYear(gradYear, gradMonth) {
  const now = new Date();
  const monthsUntilGrad =
    (gradYear - now.getFullYear()) * 12 + (gradMonth - (now.getMonth() + 1));
  if (monthsUntilGrad <= 0) return "Graduate / Alumni";
  if (monthsUntilGrad <= 12) return "Senior";
  if (monthsUntilGrad <= 24) return "Junior";
  if (monthsUntilGrad <= 36) return "Sophomore";
  return "Freshman";
}

export default function ProfileCompletionModal({ session }) {
  const { update } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    role: "",
    graduationMonth: "",
    graduationYear: "",
    gender: "",
    referralSource: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Show only if Supabase profile_complete is explicitly false
    if (session?.user?.profileComplete === false) {
      setIsOpen(true);
    }
  }, [session]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const isStudent = formData.role === "Student";

  const isFormValid =
    formData.firstName &&
    formData.lastName &&
    formData.role &&
    formData.gender &&
    formData.referralSource &&
    (!isStudent || (formData.graduationMonth && formData.graduationYear));

  const classYear =
    isStudent && formData.graduationYear && formData.graduationMonth
      ? getClassYear(
          parseInt(formData.graduationYear),
          parseInt(formData.graduationMonth)
        )
      : null;

  const handleSave = async () => {
    try {
      setSaving(true);
      const payload = {
        name: `${formData.firstName.trim()} ${formData.lastName.trim()}`,
        gender: formData.gender,
        referralSource: formData.referralSource,
        profileComplete: true,
        role: formData.role.toLowerCase(),
        graduation_year: isStudent ? parseInt(formData.graduationYear) : null,
        graduation_month: isStudent ? parseInt(formData.graduationMonth) : null,
      };
      const res = await fetch("/api/editProfile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setIsOpen(false);
      await update({ profileComplete: true });
    } catch (e) {
      console.error(e);
      alert("Couldn't save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const currentYear = new Date().getFullYear();
  const graduationYears = Array.from({ length: 8 }, (_, i) => currentYear + i);

  return (
    <Modal isOpen={isOpen} onClose={() => signOut({ callbackUrl: "/" })}>
      <div className="p-6 space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Complete Your Profile</h2>
        <p className="text-gray-600">
          Please fill out the following information to complete your profile and
          access all features of Proximity.
        </p>
        <form className="space-y-6">
          {/* First Name */}
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
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

          {/* Last Name */}
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
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

          {/* Role */}
          <div>
            <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
              I am a…
            </label>
            <select
              id="role"
              name="role"
              value={formData.role}
              onChange={handleInputChange}
              className="block w-full px-4 py-2 rounded-lg border border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
            >
              <option value="">Select your role</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Graduation Month + Year — students only */}
          {isStudent && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Expected Graduation
              </label>
              <div className="flex gap-2">
                <select
                  name="graduationMonth"
                  value={formData.graduationMonth}
                  onChange={handleInputChange}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
                >
                  <option value="">Month</option>
                  {MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <select
                  name="graduationYear"
                  value={formData.graduationYear}
                  onChange={handleInputChange}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
                >
                  <option value="">Year</option>
                  {graduationYears.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              {classYear && (
                <p className="mt-1.5 text-xs text-red-600 font-medium">
                  You are a {classYear}
                </p>
              )}
            </div>
          )}

          {/* Gender */}
          <div>
            <label htmlFor="gender" className="block text-sm font-medium text-gray-700 mb-1">
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
            <label htmlFor="referralSource" className="block text-sm font-medium text-gray-700 mb-1">
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
              isFormValid ? "bg-red-600 hover:bg-red-700" : "bg-gray-300 cursor-not-allowed"
            }`}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
