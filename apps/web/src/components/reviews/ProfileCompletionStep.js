"use client";

/*
 * "Finish your profile", for someone with no session.
 *
 * The signed-in equivalent is ProfileCompletionModal, which reads
 * session.user.profileComplete. A QR reviewer has no session at all, so this
 * renders inline right after their review posts and is authorized by the
 * profile-setup token instead. Both surfaces ask for the same fields, from
 * components/auth/profileFields.js, so they can't drift apart.
 *
 * What they already typed into the review (name, email, class year) arrives as
 * `prefill` and is shown filled in. Retyping it would read as though the review
 * hadn't registered.
 *
 * Nothing here happens implicitly: the account stays profile_complete=false
 * until Save is pressed. Skipping is a first-class outcome: the same link is in
 * their inbox for a week.
 */

import { useState } from "react";
import toast from "react-hot-toast";
import { INPUT_CLASS } from "./reviewFormUi";
import {
  ROLES,
  GENDERS,
  REFERRAL_SOURCES,
  MONTHS,
  graduationYearOptions,
  getClassYear,
  isProfileComplete,
} from "@/components/auth/profileFields";

export default function ProfileCompletionStep({
  token,
  prefill,
  onCompleted,
  onSkip,
  heading = "One last thing: finish your profile",
  intro = "Your review is posted. We started an account with what you gave us, so you can edit your review, save places and message landlords.",
}) {
  const [formData, setFormData] = useState({
    firstName: prefill?.firstName || "",
    lastName: prefill?.lastName || "",
    // A review is left by a student; they can still change it.
    role: prefill?.role
      ? ROLES.find((r) => r.toLowerCase() === String(prefill.role).toLowerCase()) || "Student"
      : "Student",
    graduationMonth: prefill?.graduationMonth ? String(prefill.graduationMonth) : "",
    graduationYear: prefill?.graduationYear ? String(prefill.graduationYear) : "",
    gender: prefill?.gender || "",
    referralSource: prefill?.referralSource || "",
  });
  const [saving, setSaving] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const isStudent = formData.role === "Student";
  const isFormValid = isProfileComplete(formData);

  const classYear =
    isStudent && formData.graduationYear && formData.graduationMonth
      ? getClassYear(
          parseInt(formData.graduationYear, 10),
          parseInt(formData.graduationMonth, 10)
        )
      : null;

  async function handleSave() {
    if (saving || !isFormValid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/profile/complete-from-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          role: formData.role.toLowerCase(),
          gender: formData.gender,
          referralSource: formData.referralSource,
          graduationYear: isStudent ? parseInt(formData.graduationYear, 10) : null,
          graduationMonth: isStudent ? parseInt(formData.graduationMonth, 10) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Couldn't save your profile. Please try again.");
        return;
      }
      if (onCompleted) onCompleted(data);
    } catch {
      toast.error("Couldn't save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm">
      <div className="mb-5">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700">
          <span aria-hidden="true">✓</span> Review posted
        </div>
        <h2 className="text-xl font-bold text-gray-900">{heading}</h2>
        <p className="mt-1 text-sm text-gray-600">{intro}</p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="profile-first" className="block text-sm text-gray-600 mb-1.5">
              First name <span className="text-red-500">*</span>
            </label>
            <input
              id="profile-first"
              name="firstName"
              type="text"
              value={formData.firstName}
              onChange={handleInputChange}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="profile-last" className="block text-sm text-gray-600 mb-1.5">
              Last name <span className="text-red-500">*</span>
            </label>
            <input
              id="profile-last"
              name="lastName"
              type="text"
              value={formData.lastName}
              onChange={handleInputChange}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        {prefill?.email && (
          <div>
            <label htmlFor="profile-email" className="block text-sm text-gray-600 mb-1.5">
              Email
            </label>
            <input
              id="profile-email"
              type="email"
              value={prefill.email}
              readOnly
              className={`${INPUT_CLASS} bg-gray-100 text-gray-500`}
            />
            <p className="mt-1 text-xs text-gray-500">
              This is the account we created for you.
            </p>
          </div>
        )}

        <div>
          <label htmlFor="profile-role" className="block text-sm text-gray-600 mb-1.5">
            I am a… <span className="text-red-500">*</span>
          </label>
          <select
            id="profile-role"
            name="role"
            value={formData.role}
            onChange={handleInputChange}
            className={INPUT_CLASS}
          >
            <option value="">Select your role</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        {isStudent && (
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">
              Expected graduation <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <select
                name="graduationMonth"
                value={formData.graduationMonth}
                onChange={handleInputChange}
                className={`${INPUT_CLASS} flex-1`}
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
                className={`${INPUT_CLASS} flex-1`}
              >
                <option value="">Year</option>
                {graduationYearOptions().map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            {classYear && (
              <p className="mt-1.5 text-xs text-red-600 font-medium">You are a {classYear}</p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="profile-gender" className="block text-sm text-gray-600 mb-1.5">
            Gender <span className="text-red-500">*</span>
          </label>
          <select
            id="profile-gender"
            name="gender"
            value={formData.gender}
            onChange={handleInputChange}
            className={INPUT_CLASS}
          >
            <option value="">Select your gender</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="profile-referral" className="block text-sm text-gray-600 mb-1.5">
            How&apos;d you find us? <span className="text-red-500">*</span>
          </label>
          <select
            id="profile-referral"
            name="referralSource"
            value={formData.referralSource}
            onChange={handleInputChange}
            className={INPUT_CLASS}
          >
            <option value="">Select one…</option>
            {REFERRAL_SOURCES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={!isFormValid || saving}
        className="mt-5 w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "Saving…" : "Finish my profile"}
      </button>

      <button
        type="button"
        onClick={onSkip}
        className="mt-2 w-full py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition"
      >
        Not now, I&apos;ll finish it later
      </button>
    </div>
  );
}
