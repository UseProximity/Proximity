/*
 * Accounts born from a signed-out review (the QR flow).
 *
 * A student who scans a flyer writes their review first and thinks about an
 * account second. So the contact block at the bottom of the form is enough to
 * create a real `users` row, but a DELIBERATELY INCOMPLETE one:
 * profile_complete stays false until they fill in the rest themselves. Nothing
 * here ever flips that flag; only /api/profile/complete-from-review does, and
 * only when a human presses Save.
 *
 * The profile-setup token authorizes that one action for a week. It is not a
 * session and cannot sign anyone in. The worst it can do is edit the profile of
 * an account that has no way to log in yet.
 *
 * The one rule that matters: an account that ALREADY has credentials (a
 * password, Google, or Apple) never gets a token. Otherwise typing a
 * classmate's @wustl.edu address into the review form would hand you an edit
 * link to their profile. Their review still attaches to their account; they
 * just don't get handed the keys.
 */
import supabase from "@/lib/supabase";
import { schoolForEmail } from "@/lib/schools";
import { referralSourceLabel } from "./source";

export const PROFILE_SETUP_TTL_DAYS = 7;

// Graduation is stored as month + year; a "Class of 2029" answer only pins the
// year, so we assume the May commencement and let them correct it on the
// profile step, where the month is a real field.
const COMMENCEMENT_MONTH = 5;

/** schools.short_name is the join key between lib/schools.js and the schools table. */
export async function resolveSchoolId(shortName) {
  if (!shortName) return null;
  const { data } = await supabase
    .from("schools")
    .select("id")
    .eq("short_name", shortName)
    .maybeSingle();
  return data?.id ?? null;
}

/** A plausible graduation year, or null. Guards against junk in the dropdown. */
export function normalizeClassYear(classYear) {
  const year = Number.parseInt(classYear, 10);
  if (!Number.isInteger(year)) return null;
  const now = new Date().getFullYear();
  return year >= now - 12 && year <= now + 10 ? year : null;
}

function expiryIso() {
  return new Date(
    Date.now() + PROFILE_SETUP_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

/*
 * Issue (or re-issue) a profile-setup token. Re-issuing is deliberate: someone
 * who reviews twice, or whose first email went to spam, should get a working
 * link rather than a dead one, and the old value has no other purpose.
 */
async function issueProfileSetupToken(userId) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const { error } = await supabase
    .from("users")
    .update({
      profile_setup_token: token,
      profile_setup_expires_at: expiryIso(),
    })
    .eq("id", userId);
  if (error) {
    console.error("[reviewOnboarding] issue setup token failed:", error.message);
    return null;
  }
  return token;
}

/**
 * Find or create the account behind a signed-out review.
 *
 * Returns { userId, isNewAccount, setupToken, displayName }. setupToken is
 * null whenever the account is not ours to hand over (see the file header), in
 * which case the caller must not offer the profile step.
 */
export async function ensureReviewerAccount({
  firstName,
  lastName,
  email,
  classYear,
  source = null,
}) {
  const emailNorm = String(email || "").trim().toLowerCase();
  const school = schoolForEmail(emailNorm);
  if (!school) return { error: "A school email address is required." };

  const displayName =
    [String(firstName || "").trim(), String(lastName || "").trim()]
      .filter(Boolean)
      .join(" ") || emailNorm.split("@")[0];
  const gradYear = normalizeClassYear(classYear);

  const { data: existing } = await supabase
    .from("users")
    .select("id, name, password_hash, google_account, apple_account, profile_complete, is_system, graduation_year, school_id")
    .eq("email", emailNorm)
    .is("deleted_at", null)
    .maybeSingle();

  const schoolId = await resolveSchoolId(school.shortName);

  if (existing) {
    // A shared/system account (e.g. the Proximity placeholder landlord) is never
    // a reviewer and must never be handed a setup token.
    if (existing.is_system) {
      return { error: "That email can't be used to leave a review." };
    }

    const hasCredentials =
      !!existing.password_hash || !!existing.google_account || !!existing.apple_account;
    const claimable = !hasCredentials && !existing.profile_complete;

    /*
     * Only ever fill blanks on an account we didn't just create. A real user's
     * name is theirs; a review form is not the place to rewrite it.
     */
    const backfill = {};
    if (!existing.school_id && schoolId) backfill.school_id = schoolId;
    if (claimable && !existing.graduation_year && gradYear) {
      backfill.graduation_year = gradYear;
      backfill.graduation_month = COMMENCEMENT_MONTH;
    }
    if (claimable && !existing.name) backfill.name = displayName;
    if (Object.keys(backfill).length) {
      const { error } = await supabase.from("users").update(backfill).eq("id", existing.id);
      if (error) console.error("[reviewOnboarding] backfill failed:", error.message);
    }

    return {
      userId: existing.id,
      isNewAccount: false,
      setupToken: claimable ? await issueProfileSetupToken(existing.id) : null,
      displayName: existing.name || displayName,
    };
  }

  const { data: studentRole } = await supabase
    .from("roles")
    .select("id")
    .eq("name", "student")
    .maybeSingle();

  /*
   * email_verified false, no password: the account exists but cannot be logged
   * into until they either set a password via the emailed link or sign in with
   * Google on the same address (auth.js matches an existing row by email).
   * Column defaults mirror /api/auth/signup so both paths produce the same shape.
   */
  const verificationToken = crypto.randomUUID();
  const { data: created, error: insertError } = await supabase
    .from("users")
    .insert({
      email: emailNorm,
      name: displayName,
      role_id: studentRole?.id ?? null,
      school_id: schoolId,
      profile_complete: false,
      email_verified: false,
      email_verification_token: verificationToken,
      email_verification_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      graduation_year: gradYear,
      graduation_month: gradYear ? COMMENCEMENT_MONTH : null,
      gender: "unspecified",
      phone: "N/A",
      description: "",
      referral_source: referralSourceLabel(source),
    })
    .select("id")
    .maybeSingle();

  if (insertError || !created?.id) {
    console.error("[reviewOnboarding] account insert failed:", insertError?.message);
    return { error: "Couldn't create your account. Please try again." };
  }

  return {
    userId: created.id,
    isNewAccount: true,
    setupToken: await issueProfileSetupToken(created.id),
    displayName,
  };
}

/**
 * Resolve a profile-setup token to the account it belongs to, with the values
 * the profile form should open pre-filled with. Null when the token is unknown,
 * expired, or the profile is already finished.
 */
export async function loadProfileSetupUser(token) {
  const clean = String(token || "").trim();
  if (!clean) return null;

  const { data: user } = await supabase
    .from("users")
    .select("id, name, email, gender, referral_source, graduation_year, graduation_month, profile_complete, profile_setup_expires_at, roles!role_id(name)")
    .eq("profile_setup_token", clean)
    .is("deleted_at", null)
    .maybeSingle();

  if (!user) return null;
  if (user.profile_complete) return null;
  if (!user.profile_setup_expires_at) return null;
  if (new Date(user.profile_setup_expires_at).getTime() < Date.now()) return null;

  const [firstName = "", ...rest] = String(user.name || "").trim().split(/\s+/);
  return {
    userId: user.id,
    prefill: {
      firstName,
      lastName: rest.join(" "),
      email: user.email || "",
      role: user.roles?.name || "student",
      graduationYear: user.graduation_year ?? "",
      graduationMonth: user.graduation_month ?? "",
      gender: user.gender && user.gender !== "unspecified" ? user.gender : "",
      referralSource: "",
    },
  };
}

/** Burn the token so the emailed link is single-use. */
export async function clearProfileSetupToken(userId) {
  const { error } = await supabase
    .from("users")
    .update({ profile_setup_token: null, profile_setup_expires_at: null })
    .eq("id", userId);
  if (error) console.error("[reviewOnboarding] clear setup token failed:", error.message);
}

/*
 * Opening the emailed setup link proves control of the inbox, which is exactly
 * what email verification asks. Marking it here means a QR-born account becomes
 * fully usable without a second round-trip email. The inline (never-emailed)
 * path deliberately does NOT reach this.
 */
export async function markEmailVerifiedFromSetupLink(userId) {
  const { error } = await supabase
    .from("users")
    .update({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires_at: null,
    })
    .eq("id", userId)
    .eq("email_verified", false);
  if (error) console.error("[reviewOnboarding] verify-from-link failed:", error.message);
}
