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
 * Two tokens, never interchangeable, both stored only as hashes:
 *
 * - The INLINE token goes back in the API response to whoever submitted the
 *   form, so it proves nothing about the inbox. It is only ever issued for an
 *   account created by that same request, and it can only fill in that
 *   account's profile (and a password the account can't sign in with until the
 *   inbox is proven). Lives in users.profile_setup_token.
 * - The LINK token is minted at send time and exists only in an email, so
 *   opening it proves control of the inbox and verifies the address. Lives in
 *   users.profile_setup_link_hash.
 *
 * The rules that matter: an account that ALREADY exists never gets an inline
 * token, because anyone can type anyone's address into the form; its owner is
 * emailed a link instead. And an account with credentials (a password, Google,
 * or Apple) gets no token of either kind. Their review still attaches to their
 * account; they just don't get handed the keys.
 */
import supabase from "@/lib/supabase";
import { hashToken } from "@/lib/auth/tokenHash";
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

const newRawToken = () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");

async function storeSetupHash(userId, column) {
  const token = newRawToken();
  const { error } = await supabase
    .from("users")
    .update({ [column]: hashToken(token), profile_setup_expires_at: expiryIso() })
    .eq("id", userId);
  if (error) {
    console.error(`[reviewOnboarding] issue ${column} failed:`, error.message);
    return null;
  }
  return token;
}

/** Inline token, for an account this request just created. See the file header. */
const issueProfileSetupToken = (userId) => storeSetupHash(userId, "profile_setup_token");

/*
 * Mint a link token for an email we are about to send. Minting at send time is
 * deliberate: the raw value then exists in exactly one place, that email, and
 * someone whose first email went to spam simply gets a working link in the
 * next one. Callers must only put the result in mail to the account's own
 * address, never in a response.
 */
export const issueProfileSetupLinkToken = (userId) =>
  storeSetupHash(userId, "profile_setup_link_hash");

/** Still has a profile to finish and no way to sign in, so a setup link helps. */
export const needsProfileSetup = (user) =>
  !!user &&
  !user.profile_complete &&
  !user.password_hash &&
  !user.google_account &&
  !user.apple_account;

/**
 * Find or create the account behind a signed-out review.
 *
 * Returns { userId, isNewAccount, setupToken, displayName, existingAccount,
 * setupByEmail }. setupToken is null whenever the account is not ours to hand
 * over (see the file header), in which case the caller must not offer the
 * profile step.
 */
export async function ensureReviewerAccount({
  firstName,
  lastName,
  email,
  phone = null,
  classYear,
  source = null,
  /*
   * How the account reads in the admin Users view. Defaults to the QR/review
   * labelling, which is wrong for anything that isn't a review: a waitlist lead
   * tagged "qr:" sends whoever reads that column looking for a flyer that never
   * existed. Callers outside the review flow pass their own label.
   */
  referralSource = null,
  /*
   * Reviews are only meaningful from a student, so the review paths keep
   * demanding a recognised school domain. The waitlist does not: a parent or an
   * out-of-school roommate joining a building's waitlist is a real lead, and
   * turning them away would cost a signup to enforce a rule reviews need and
   * waitlists don't. Such an account simply carries no school_id.
   */
  requireSchoolEmail = true,
  /*
   * The caller holds proof the submitter controls this inbox (an emailed review
   * invite). Only then may an account that already existed get the inline
   * token, since only then is the submitter known to be its owner.
   */
  inboxProven = false,
  /*
   * The inline token the submitting browser already holds from an earlier
   * review in this session, if any. A match proves it is the same browser that
   * created the account, so it keeps its profile step.
   */
  priorSetupToken = null,
}) {
  const emailNorm = String(email || "").trim().toLowerCase();
  const school = schoolForEmail(emailNorm);
  if (!school && requireSchoolEmail) {
    return { error: "A school email address is required." };
  }

  const displayName =
    [String(firstName || "").trim(), String(lastName || "").trim()]
      .filter(Boolean)
      .join(" ") || emailNorm.split("@")[0];
  const gradYear = normalizeClassYear(classYear);

  const { data: existing } = await supabase
    .from("users")
    .select("id, name, password_hash, google_account, apple_account, profile_complete, is_system, graduation_year, school_id, phone, profile_setup_token, profile_setup_expires_at")
    .eq("email", emailNorm)
    .is("deleted_at", null)
    .maybeSingle();

  const schoolId = school ? await resolveSchoolId(school.shortName) : null;

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
    const phoneNorm = String(phone || "").trim();
    if (claimable && phoneNorm && (!existing.phone || existing.phone === "N/A")) {
      backfill.phone = phoneNorm;
    }
    if (Object.keys(backfill).length) {
      const { error } = await supabase.from("users").update(backfill).eq("id", existing.id);
      if (error) console.error("[reviewOnboarding] backfill failed:", error.message);
    }

    const sameBrowser =
      claimable &&
      !!priorSetupToken &&
      !!existing.profile_setup_token &&
      hashToken(String(priorSetupToken).trim()) === existing.profile_setup_token &&
      new Date(existing.profile_setup_expires_at || 0).getTime() > Date.now();

    if (sameBrowser) {
      return {
        userId: existing.id,
        isNewAccount: false,
        setupToken: String(priorSetupToken).trim(),
        displayName: existing.name || displayName,
        existingAccount: false,
      };
    }

    /*
     * Someone other than the browser that created this account is now writing
     * to it, so any inline token still out there is retired. Otherwise a person
     * who pre-created a shell for a classmate's address could sit on that token
     * and later claim the reviews the classmate attaches to it.
     */
    if (existing.profile_setup_token) {
      const { error } = await supabase
        .from("users")
        .update({ profile_setup_token: null })
        .eq("id", existing.id);
      if (error) console.error("[reviewOnboarding] retire inline token failed:", error.message);
    }

    return {
      userId: existing.id,
      isNewAccount: false,
      /*
       * Never an inline token for an account that existed before this request
       * unless the inbox is proven: whoever typed this address may not own it.
       * If the account still needs setting up, its owner is emailed a link in
       * the review confirmation (or waitlist nudge) instead.
       */
      setupToken: claimable && inboxProven ? await issueProfileSetupToken(existing.id) : null,
      displayName: existing.name || displayName,
      /*
       * The account was already there, so the caller has to SAY that: a
       * returning student who gets the same bare thank-you as everyone else has
       * no idea their review landed on the account they already own.
       */
      existingAccount: !(claimable && inboxProven),
      // ...and whether it still needs setting up, which happens by email.
      setupByEmail: claimable && !inboxProven,
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
      // "N/A" is the placeholder the signup form writes when a path can't ask;
      // the waitlist does ask, so a real number lands here instead.
      phone: String(phone || "").trim() || "N/A",
      description: "",
      referral_source: referralSource || referralSourceLabel(source),
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
  const hash = hashToken(clean);

  // The hash is hex, so it is safe inside the PostgREST or() filter string.
  const { data: user } = await supabase
    .from("users")
    .select("id, name, email, gender, referral_source, graduation_year, graduation_month, profile_complete, profile_setup_expires_at, profile_setup_link_hash, password_hash, google_account, apple_account, email_verified, roles!role_id(name)")
    .or(`profile_setup_token.eq.${hash},profile_setup_link_hash.eq.${hash}`)
    .is("deleted_at", null)
    .maybeSingle();

  if (!user) return null;
  if (user.profile_complete) return null;
  if (!user.profile_setup_expires_at) return null;
  if (new Date(user.profile_setup_expires_at).getTime() < Date.now()) return null;

  const [firstName = "", ...rest] = String(user.name || "").trim().split(/\s+/);
  return {
    userId: user.id,
    email: user.email || "",
    // Whether this account can already be signed into. The account step asks for
    // a password or Google only while this is false.
    hasCredentials:
      !!user.password_hash || !!user.google_account || !!user.apple_account,
    // Google or Apple: a login that survives verification wiping the password.
    hasProviderLogin: !!user.google_account || !!user.apple_account,
    emailVerified: !!user.email_verified,
    // True only for the emailed link token: the one thing that proves the inbox.
    viaEmailLink: user.profile_setup_link_hash === hash,
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

/** Burn both tokens so neither the inline hand-off nor the emailed link outlives the profile. */
export async function clearProfileSetupToken(userId) {
  const { error } = await supabase
    .from("users")
    .update({
      profile_setup_token: null,
      profile_setup_link_hash: null,
      profile_setup_expires_at: null,
    })
    .eq("id", userId);
  if (error) console.error("[reviewOnboarding] clear setup token failed:", error.message);
}

/*
 * Opening a link we emailed proves control of the inbox, which is exactly what
 * email verification asks. Marking it here means an account born from a review
 * becomes fully usable without a second round-trip email.
 *
 * Two paths reach this, and both carry the same proof. The profile-setup link
 * token (never the inline one; see the file header), and a review invite,
 * whose token was mailed to one address before the review was written.
 *
 * Any password already on the row is wiped in the same update. Until now no one
 * had proven they own this inbox, so that password was set by whoever typed the
 * address into a form, possibly a stranger pre-registering someone else's
 * email. The owner who just proved the inbox sets their own on the next step.
 */
export async function markEmailVerifiedFromLink(userId) {
  const { error } = await supabase
    .from("users")
    .update({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires_at: null,
      password_hash: null,
    })
    .eq("id", userId)
    .eq("email_verified", false);
  if (error) console.error("[reviewOnboarding] verify-from-link failed:", error.message);
}
