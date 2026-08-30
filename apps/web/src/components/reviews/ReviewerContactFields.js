"use client";

/*
 * The bottom block of a signed-out review: who wrote it, and whether their name
 * shows on it.
 *
 * The signed-in flow gets all of this from the session and shows only the
 * anonymous toggle. A QR scan has no session, so the same slot collects the four
 * things needed to create an account afterwards: first, last, class, email.
 *
 * Anonymous and contact info are NOT in tension, which the copy has to make
 * obvious: the toggle governs what appears publicly on the listing, while the
 * email is how they get their account and their review's confirmation. Students
 * abandon forms that look like they're about to publish their address.
 */

import { INPUT_CLASS } from "./reviewFormUi";
import { classYearOptions } from "@/components/auth/profileFields";
import { SCHOOLS } from "@/lib/schools";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Everything the account-creation step needs, present and plausible?
 *
 * `requireClassYear` without `requireContact` is the signed-in dorm case: we
 * already know who they are, but dorm_reviews.class_year is NOT NULL and every
 * review card on the Campus Hub renders "Class of <year>", so it still has to
 * be asked.
 */
export function contactReady(contact, { requireContact, requireClassYear = false }) {
  if (requireContact) {
    return !!(
      contact.firstName.trim().length >= 1 &&
      contact.lastName.trim().length >= 1 &&
      contact.classYear &&
      EMAIL_RE.test(contact.email.trim())
    );
  }
  return requireClassYear ? !!contact.classYear : true;
}

export const EMPTY_CONTACT = {
  firstName: "",
  lastName: "",
  classYear: "",
  email: "",
};

export default function ReviewerContactFields({
  contact,
  onContactChange,
  anonymous,
  onAnonymousChange,
  requireContact,
  requireClassYear = false,
  schoolMismatch = false,
  postingAs = null,
}) {
  const set = (key) => (e) => onContactChange({ ...contact, [key]: e.target.value });

  return (
    <div className="space-y-4">
      {/*
        Signed in, so none of the identity questions are asked and no account is
        created afterwards. Say so: without this the step just looks like it is
        missing the fields a signed-out visitor sees.
      */}
      {!requireContact && postingAs && (
        <p className="text-sm text-gray-500">
          Posting as <span className="font-semibold text-gray-700">{postingAs}</span>.
        </p>
      )}
      {!requireContact && requireClassYear && (
        <div className="sm:max-w-[12rem]">
          <label htmlFor="reviewer-class-only" className="block text-sm text-gray-600 mb-1.5">
            Class of <span className="text-red-500">*</span>
          </label>
          <select
            id="reviewer-class-only"
            value={contact.classYear}
            onChange={set("classYear")}
            className={INPUT_CLASS}
          >
            <option value="">Select…</option>
            {classYearOptions().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      )}

      {requireContact && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reviewer-first" className="block text-sm text-gray-600 mb-1.5">
                First name <span className="text-red-500">*</span>
              </label>
              <input
                id="reviewer-first"
                type="text"
                autoComplete="given-name"
                value={contact.firstName}
                onChange={set("firstName")}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="reviewer-last" className="block text-sm text-gray-600 mb-1.5">
                Last name <span className="text-red-500">*</span>
              </label>
              <input
                id="reviewer-last"
                type="text"
                autoComplete="family-name"
                value={contact.lastName}
                onChange={set("lastName")}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reviewer-class" className="block text-sm text-gray-600 mb-1.5">
                Class of <span className="text-red-500">*</span>
              </label>
              <select
                id="reviewer-class"
                value={contact.classYear}
                onChange={set("classYear")}
                className={INPUT_CLASS}
              >
                <option value="">Select…</option>
                {classYearOptions().map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="reviewer-email" className="block text-sm text-gray-600 mb-1.5">
                School email <span className="text-red-500">*</span>
              </label>
              <input
                id="reviewer-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={contact.email}
                onChange={set("email")}
                placeholder="you@wustl.edu"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          {schoolMismatch ? (
            <p className="text-sm text-red-600">
              Use your school email so we can confirm you actually lived there:{" "}
              {SCHOOLS.map((s) => `@${s.domains[0]}`).join(", ")}.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Your email is never shown on the listing. We use it to confirm your review
              and set up your account.
            </p>
          )}
        </>
      )}

      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => onAnonymousChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-400"
        />
        <span className="text-sm text-gray-700">
          <span className="font-semibold">Post anonymously</span>
          <span className="block text-gray-500">
            Your name and photo won&apos;t appear on the listing. It&apos;ll show as
            “Anonymous.”
          </span>
        </span>
      </label>
    </div>
  );
}
