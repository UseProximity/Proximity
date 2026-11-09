"use client";

import { useState, useEffect, useRef } from "react";
import { signOut, useSession } from "next-auth/react";
import Modal from "@/components/ui/Modal";
import { submitProfile } from "@/lib/auth/profileSave";
import {
  ROLES,
  GENDERS,
  REFERRAL_SOURCES,
  MONTHS,
  graduationYearOptions,
  getClassYear,
  isProfileComplete,
} from "./profileFields";

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
  const [error, setError] = useState(null);
  // Set once a save is confirmed. `session` is a server-rendered snapshot that
  // keeps saying profileComplete: false until the page is rendered again, and
  // must not reopen the popup for a profile that is already saved.
  const savedRef = useRef(false);

  useEffect(() => {
    // Show only for a resolved identity whose Supabase profile_complete is
    // explicitly false. A deleted or otherwise identity-less session also
    // carries profileComplete: false, so require id too or onboarding reopens
    // for an account that isn't actually signed in.
    if (!savedRef.current && session?.user?.id && session?.user?.profileComplete === false) {
      setIsOpen(true);
    }
    // Pre-select the role the user already has (e.g. a landlord who chose that
    // on the signup form) so they don't have to re-pick it — and can't silently
    // overwrite it back to student.
    const sessionRole = session?.user?.role;
    if (sessionRole) {
      const match = ROLES.find((r) => r.toLowerCase() === sessionRole.toLowerCase());
      if (match) setFormData((prev) => (prev.role ? prev : { ...prev, role: match }));
    }
  }, [session]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const isStudent = formData.role === "Student";

  // Names are trimmed before they are sent, so a name of spaces is not a name.
  const isFormValid = isProfileComplete({
    ...formData,
    firstName: formData.firstName.trim(),
    lastName: formData.lastName.trim(),
  });

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
      setError(null);
      const newRole = formData.role.toLowerCase();
      const payload = {
        name: `${formData.firstName.trim()} ${formData.lastName.trim()}`,
        gender: formData.gender,
        referralSource: formData.referralSource,
        profileComplete: true,
        role: newRole,
        graduation_year: isStudent ? parseInt(formData.graduationYear) : null,
        graduation_month: isStudent ? parseInt(formData.graduationMonth) : null,
      };
      // Pushes the new role into the JWT so the header + dashboard redirects
      // reflect it immediately instead of waiting for the 60s auto-heal. The
      // server ignores the payload and re-reads the database. It never throws.
      const refreshSession = () => update({ profileComplete: true, role: newRole });
      const saved = await submitProfile(payload, refreshSession);
      if (!saved) {
        setError("We couldn't save your profile. Please try again.");
        return;
      }
      savedRef.current = true;
      setIsOpen(false);
      // One attempt, result ignored: the popup is already closed, and if this
      // fails the next server render re-reads the database for itself.
      refreshSession();
    } finally {
      setSaving(false);
    }
  };

  const graduationYears = graduationYearOptions();

  return (
    <Modal isOpen={isOpen} dismissible={false}>
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
              {/* Sized by content, and onto two lines when the card is too narrow
                  for both: a select cannot shrink below its longest option
                  without cutting the name off. */}
              <div className="flex flex-wrap gap-2">
                <select
                  name="graduationMonth"
                  value={formData.graduationMonth}
                  onChange={handleInputChange}
                  className="min-w-0 flex-auto px-4 py-2 rounded-lg border border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
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
                  className="min-w-0 flex-auto px-4 py-2 rounded-lg border border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
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
              {GENDERS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
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
              {REFERRAL_SOURCES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </form>

        {/* Save Button */}
        <div className="pt-4 space-y-3">
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
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
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
            disabled={saving}
            className="w-full text-sm text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
          >
            Log out
          </button>
        </div>
      </div>
    </Modal>
  );
}
