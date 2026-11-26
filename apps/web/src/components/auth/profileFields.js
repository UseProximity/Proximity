/*
 * The field vocabulary of "complete your profile", in one place.
 *
 * Two surfaces ask for it now: the session-driven ProfileCompletionModal (a
 * signed-in account with profile_complete=false) and the inline step at the end
 * of the signed-out QR review flow, which has no session and is authorized by a
 * profile-setup token instead. They must ask for the same things in the same
 * words. A student who answers "Junior" in one place and finds no such option
 * in the other is looking at a bug.
 *
 * Client-safe; no server imports.
 */

export const ROLES = ["Student", "Landlord", "Parent", "Other"];

export const GENDERS = ["Male", "Female", "Other"];

export const REFERRAL_SOURCES = [
  "Social Media",
  "A Friend",
  "Colleague",
  "On Campus",
  "Other",
];

export const MONTHS = [
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

/** The eight graduation years the dropdown offers, starting this year. */
export function graduationYearOptions() {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, i) => currentYear + i);
}

/** Class standing implied by a graduation date, for the confirmation line. */
export function getClassYear(gradYear, gradMonth) {
  const now = new Date();
  const monthsUntilGrad =
    (gradYear - now.getFullYear()) * 12 + (gradMonth - (now.getMonth() + 1));
  if (monthsUntilGrad <= 0) return "Graduate / Alumni";
  if (monthsUntilGrad <= 12) return "Senior";
  if (monthsUntilGrad <= 24) return "Junior";
  if (monthsUntilGrad <= 36) return "Sophomore";
  return "Freshman";
}

/*
 * What the review flow asks for as "class": a graduating year, which the profile
 * step then shows as a real month + year it can correct. Runs one year back so a
 * student reviewing the place they just moved out of can still say Class of
 * <last year>.
 */
export function classYearOptions() {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, i) => currentYear - 1 + i);
}

/** Every profile field answered? Shared so both surfaces gate Save identically. */
export function isProfileComplete(formData) {
  const isStudent = formData.role === "Student";
  return !!(
    formData.firstName &&
    formData.lastName &&
    formData.role &&
    formData.gender &&
    formData.referralSource &&
    (!isStudent || (formData.graduationMonth && formData.graduationYear))
  );
}
