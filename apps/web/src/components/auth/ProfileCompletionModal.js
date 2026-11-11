"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
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

const LABEL_CLASS = "mb-1.5 block text-sm font-semibold text-gray-900";

// 16px on phones: anything smaller makes iOS zoom the page when a field is focused.
const FIELD_CLASS =
  "rounded-xl border border-gray-300 px-4 py-2.5 text-base sm:text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2";

// A short list of answers as tap targets. Real radio inputs, so a screen reader
// gets the group and the checked state, and the arrow keys move within it.
function ChoiceGroup({ legend, name, options, value, onChange, layoutClass, chipClass }) {
  return (
    <fieldset>
      <legend className={LABEL_CLASS}>{legend}</legend>
      <div className={layoutClass}>
        {options.map((option) => (
          <label key={option} className="group relative block cursor-pointer [-webkit-tap-highlight-color:transparent]">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={onChange}
              className="peer sr-only"
            />
            <span
              className={`flex w-full items-center justify-center border border-gray-200 bg-white px-3 text-center text-sm font-medium text-gray-700 transition hover:border-red-300 group-active:scale-[0.97] peer-checked:border-red-500 peer-checked:bg-red-50 peer-checked:text-red-700 peer-focus-visible:ring-2 peer-focus-visible:ring-red-300 peer-focus-visible:ring-offset-2 ${chipClass}`}
            >
              {option}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function ProfileCompletionModal({ session }) {
  const { data: live, update } = useSession();
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
  // Set when the person picks a role themselves, so a later session change
  // (e.g. the "Login as Landlord" switch) never overwrites their choice.
  const rolePickedRef = useRef(false);
  const overlayRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    // Show only for a resolved identity whose Supabase profile_complete is
    // explicitly false. A deleted or otherwise identity-less session also
    // carries profileComplete: false, so require id too or onboarding reopens
    // for an account that isn't actually signed in.
    if (!savedRef.current && session?.user?.id && session?.user?.profileComplete === false) {
      setIsOpen(true);
    }
    // Pre-select the role the user already has (e.g. a landlord who chose that
    // on the signup form) so they don't have to re-pick it, and can't silently
    // overwrite it back to student.
    // `session` is the server-rendered snapshot and goes stale when the client
    // changes the role after mount (Login as Landlord), so prefer the live one.
    const sessionRole = live?.user?.role ?? session?.user?.role;
    if (sessionRole && !rolePickedRef.current) {
      const match = ROLES.find((r) => r.toLowerCase() === sessionRole.toLowerCase());
      if (match) setFormData((prev) => (prev.role === match ? prev : { ...prev, role: match }));
    }
  }, [session, live?.user?.role]);

  // While open: lock the page behind and start keyboard focus inside the card.
  // The overlay is exactly the visible area: its bottom edge moves up by however
  // much of the screen the on-screen keyboard covers, and its top edge follows
  // the visual viewport when iOS scrolls it down inside the page, so the pinned
  // Save button stays above the keyboard and the card stays in view. Phone browsers do not resize the page for the
  // keyboard, but the visual viewport shrinks, and the gap between the two is
  // the keyboard. When the two viewports differ in width the page is zoomed
  // (pinch, or shrunk to fit a wide page) and the gap is not the keyboard, so
  // nothing moves.
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    cardRef.current?.focus({ preventScroll: true });

    const overlay = overlayRef.current;
    const viewport = window.visualViewport;
    const clearKeyboard = () => {
      const zoomed = Math.abs(viewport.width - window.innerWidth) > 1;
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      if (zoomed || covered < 0) {
        overlay.style.removeProperty("--vv-top");
        overlay.style.removeProperty("--vv-bottom");
      } else {
        overlay.style.setProperty("--vv-top", `${viewport.offsetTop}px`);
        overlay.style.setProperty("--vv-bottom", `${covered}px`);
      }
    };
    if (viewport) {
      clearKeyboard();
      viewport.addEventListener("resize", clearKeyboard);
      viewport.addEventListener("scroll", clearKeyboard);
    }
    return () => {
      document.body.style.overflow = "";
      viewport?.removeEventListener("resize", clearKeyboard);
      viewport?.removeEventListener("scroll", clearKeyboard);
    };
  }, [isOpen]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name === "role") rolePickedRef.current = true;
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
      // fails the next server render re-reads the database for itself, once the
      // 60s role refresh window has passed.
      refreshSession();
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const graduationYears = graduationYearOptions();

  // Not dismissible: no backdrop click handler, no close button. Log out is the
  // one way out.
  return (
    <div
      ref={overlayRef}
      className="fixed inset-x-0 top-[var(--vv-top,0px)] bottom-[var(--vv-bottom,0px)] z-[1100] flex items-center justify-center bg-white/60 p-3 backdrop-blur-md sm:p-4"
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-completion-title"
        tabIndex={-1}
        className="flex max-h-full w-full scroll-pb-24 flex-col overflow-y-auto overscroll-contain max-w-lg rounded-3xl bg-white shadow-2xl shadow-red-900/10 outline-none ring-1 ring-gray-200"
      >
        <div className="shrink-0 px-5 pt-5 text-center sm:px-8 sm:pt-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 ring-1 ring-red-100 sm:h-[4.5rem] sm:w-[4.5rem] sm:rounded-3xl [@media(max-height:32rem)]:h-10 [@media(max-height:32rem)]:w-10">
            <Image src="/logo.svg" alt="" width={52} height={52} className="h-10 w-10 sm:h-[3.25rem] sm:w-[3.25rem] [@media(max-height:32rem)]:h-7 [@media(max-height:32rem)]:w-7" />
          </div>
          <h2 id="profile-completion-title" className="mt-3 text-xl font-bold tracking-tight text-gray-900 sm:mt-4 sm:text-2xl">
            Welcome to <span className="text-red-600">Proximity</span>
          </h2>
          <p className="mt-1 text-sm text-gray-600 [@media(max-height:32rem)]:hidden sm:text-base">
            Just a few quick details and you&apos;re in.
          </p>
        </div>

        <form className="flex-1 space-y-4 px-5 py-5 sm:px-8">
          <ChoiceGroup
            legend="I am a…"
            name="role"
            options={ROLES}
            value={formData.role}
            onChange={handleInputChange}
            layoutClass="grid grid-cols-2 gap-2"
            chipClass="h-11 rounded-xl text-base"
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="firstName" className={LABEL_CLASS}>
                First name
              </label>
              <input
                type="text"
                id="firstName"
                name="firstName"
                value={formData.firstName}
                onChange={handleInputChange}
                className={`block w-full ${FIELD_CLASS}`}
                placeholder="Enter your first name"
              />
            </div>
            <div>
              <label htmlFor="lastName" className={LABEL_CLASS}>
                Last name
              </label>
              <input
                type="text"
                id="lastName"
                name="lastName"
                value={formData.lastName}
                onChange={handleInputChange}
                className={`block w-full ${FIELD_CLASS}`}
                placeholder="Enter your last name"
              />
            </div>
          </div>

          {/* Graduation Month + Year, students only */}
          {isStudent && (
            <fieldset>
              <legend className={LABEL_CLASS}>Expected graduation</legend>
              {/* Sized by content, and onto two lines when the card is too narrow
                  for both: a select cannot shrink below its longest option
                  without cutting the name off. */}
              <div className="flex flex-wrap gap-2">
                <select
                  name="graduationMonth"
                  aria-label="Graduation month"
                  value={formData.graduationMonth}
                  onChange={handleInputChange}
                  className={`${FIELD_CLASS} min-w-0 flex-auto`}
                >
                  <option value="">Month</option>
                  {MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <select
                  name="graduationYear"
                  aria-label="Graduation year"
                  value={formData.graduationYear}
                  onChange={handleInputChange}
                  className={`${FIELD_CLASS} min-w-0 flex-auto`}
                >
                  <option value="">Year</option>
                  {graduationYears.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              {classYear && (
                <p className="mt-1.5 text-xs font-medium text-red-600">
                  You are a {classYear}
                </p>
              )}
            </fieldset>
          )}

          <ChoiceGroup
            legend="Gender"
            name="gender"
            options={GENDERS}
            value={formData.gender}
            onChange={handleInputChange}
            layoutClass="grid grid-cols-3 gap-2"
            chipClass="h-10 rounded-xl"
          />

          <ChoiceGroup
            legend="How'd you find us?"
            name="referralSource"
            options={REFERRAL_SOURCES}
            value={formData.referralSource}
            onChange={handleInputChange}
            layoutClass="flex flex-wrap gap-2"
            chipClass="h-10 rounded-full px-4"
          />
        </form>

        {/* Stacked, except on short screens (landscape phones, or a keyboard
            open), where one row keeps the pinned footer slim. */}
        <div className="sticky bottom-0 shrink-0 border-t border-gray-100 bg-white px-5 py-3 sm:px-8">
          {error && (
            <p role="alert" className="mb-2 text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-1.5 [@media(max-height:32rem)]:flex-row-reverse [@media(max-height:32rem)]:items-center [@media(max-height:32rem)]:gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={!isFormValid || saving}
              className={`rounded-xl py-2.5 font-semibold [@media(max-height:32rem)]:flex-1 text-white transition-colors ${FOCUS_RING} ${
                isFormValid ? "bg-red-600 hover:bg-red-700" : "cursor-not-allowed bg-gray-300"
              }`}
            >
              {saving ? "Saving..." : "Get started"}
            </button>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/" })}
              className={`shrink-0 rounded-md px-2 py-1 text-sm text-gray-500 underline hover:text-gray-700 ${FOCUS_RING}`}
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
