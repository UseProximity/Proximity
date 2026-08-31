/*
 * Submission endpoint for the review flow. Serves both entry points:
 *   - /refer/<userId> — ambassador referral link (referrerId present, recorded on the review)
 *   - /review         — public "Add a Review" page (no referrer; referrer_id stays null)
 *
 * @auth optional
 *
 * Auth: signing in is OPTIONAL, because a student who scans a QR code on a flyer has no
 * account yet and asking for one first loses the review.
 *   - Signed in: the review is attributed to that account and the school must match its
 *     email domain. Max 2 reviews per account.
 *   - Signed out: the `reviewer` block (first, last, class, school email) creates an
 *     incomplete account (lib/reviews/onboarding.js) which the review is attributed to,
 *     and the response carries a profile-setup token so the caller can offer to finish it.
 *     Soft per-client rate limit stands in for the login that isn't there.
 * Either way reviews auto-publish (legitimacy=true).
 *
 * School: never self-declared. It is proved by an email domain in both paths (the
 * session's when signed in, the submitted reviewer email when not). It's stored on the
 * USER (users.school_id): a review's school is derived by joining through its author,
 * not duplicated onto the review row.
 *
 * Listing resolution (no user choice): the reviewer-selected address is compared against
 * our catalog. On an EXACT street-address match the review is attached to that listing
 * (tie-break across same-address listings: prefer non-sublease, then a landlord-owned one).
 * With no match we auto-create a minimal listing "stub" owned by the shared Proximity
 * account, with real walk/drive times computed (same as the landlord add-listing flow).
 *
 * Emails (best-effort, never block the review):
 *   - Recipient is entered-email-first: if the reviewer typed a landlord email, that
 *     address is notified (even if the listing already has an owner on file). Otherwise
 *     we fall back to the listing owner — but never when the listing is a sublease or the
 *     owner is a student (i.e. a sublease manager); those cases send no landlord email.
 *   - Messaging depends on whether the recipient has an account and whether the property
 *     is new. info@useproximity.org is BCC'd on every notification.
 *   - For an existing listing, if the landlord email entered in the review differs from
 *     the listing owner's email, a mismatch alert is sent to info@useproximity.org.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { insertAsUser } from "@/lib/supabaseWithUser";
import { fetchAllWalkTimes } from "@/utils/walkTimes";
import { fetchAllDriveTimes } from "@/utils/driveTimes";
import { fetchAndStoreStreetView } from "@/lib/streetview";
import nodemailer from "nodemailer";
import { sendMailSafe } from "@/lib/outreach";
import { isKnownSchool, schoolMatchesEmail, schoolForEmail } from "@/lib/schools";
import { getBaseUrl, sendReviewWelcomeEmail, sendReviewLiveEmail } from "@/lib/email";
import { normalizeReviewSource } from "@/lib/reviews/source";
import { listingPlaceName } from "@/lib/reviews/placeName";
import { anonReviewRateKey, anonReviewRateLimited } from "@/lib/reviews/rateLimit";
import {
  ensureReviewerAccount,
  normalizeClassYear,
  resolveSchoolId,
} from "@/lib/reviews/onboarding";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROXIMITY_EMAIL = "info@useproximity.org"; // shared placeholder landlord account
const TEAM_EMAIL = "info@useproximity.org"; // BCC / internal alerts
const REVIEW_LIMIT = 2; // max reviews per account (all reviews count)
const SITE_URL = "https://useproximity.org";

const _mailer = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

function emailConfigured() {
  return !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

// Count non-deleted reviews authored by a user.
async function countUserReviews(userId) {
  const { count } = await supabase
    .from("listing_reviews")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);
  return count ?? 0;
}

// Valid half-star rating: between 0.5 and 5 in 0.5 increments.
function isHalfStar(v) {
  return typeof v === "number" && v >= 0.5 && v <= 5 && Number.isInteger(v * 2);
}

async function resolveOtherHomeTypeId() {
  const { data } = await supabase
    .from("home_types")
    .select("id")
    .eq("label", "Other")
    .maybeSingle();
  return data?.id ?? null;
}

// Look up (or lazily create) the shared Proximity landlord account.
async function resolveProximityLandlordId() {
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", PROXIMITY_EMAIL)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: role } = await supabase
    .from("roles")
    .select("id")
    .eq("name", "landlord")
    .maybeSingle();
  const { data: created } = await supabase
    .from("users")
    .insert({
      email: PROXIMITY_EMAIL,
      name: "Proximity",
      role_id: role?.id ?? null,
      profile_complete: true,
    })
    .select("id")
    .maybeSingle();
  return created?.id ?? null;
}

// Canonical forms for common USPS street-type suffixes + directionals. Lets equivalent
// address spellings compare equal — the same building is entered as "Ave" by one source
// (a hand-typed listing) and "Avenue" by another (the Mapbox autocomplete), and both must
// resolve to the same listing instead of spawning a duplicate.
const STREET_TOKEN_SYNONYMS = {
  ave: "avenue", av: "avenue", avenu: "avenue",
  st: "street", str: "street",
  rd: "road",
  dr: "drive", drv: "drive",
  blvd: "boulevard", blv: "boulevard",
  ln: "lane",
  ct: "court", crt: "court",
  pl: "place",
  ter: "terrace", terr: "terrace",
  cir: "circle",
  pkwy: "parkway", pky: "parkway",
  hwy: "highway",
  sq: "square",
  trl: "trail",
  pt: "point",
  // directionals
  n: "north", s: "south", e: "east", w: "west",
  ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
};

// Normalize the street-address line (drop city/state/zip) and canonicalize common
// abbreviations so equivalent forms compare equal ("608 Kingsland Ave" == "608 Kingsland Avenue").
function normStreet(addr) {
  const line = String(addr || "").split(",")[0].trim().toLowerCase();
  const cleaned = line.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((tok) => STREET_TOKEN_SYNONYMS[tok] || tok)
    .join(" ");
}

// Compute listing_walk_times rows (campus places + nearest shuttle) for a coordinate —
// same data the landlord add-listing flow stores, resolved to location_id rows.
async function buildWalkTimeRows(lat, lng) {
  let placeWalkMinutes = {};
  let shuttleWalkMinutes = null;
  try {
    ({ placeWalkMinutes, shuttleWalkMinutes } = await fetchAllWalkTimes(lat, lng));
  } catch (err) {
    console.error("[reviewReferral] walk times failed:", err?.message);
    return [];
  }
  const rows = [];
  try {
    const { data: locations } = await supabase.from("locations").select("id, name");
    if (locations?.length) {
      for (const [key, minutes] of Object.entries(placeWalkMinutes ?? {})) {
        const loc = locations.find((l) => l.name.toLowerCase() === key.toLowerCase());
        if (loc && minutes != null) rows.push({ location_id: loc.id, minutes });
      }
      if (shuttleWalkMinutes != null) {
        const shuttleLoc = locations.find((l) => l.name.toLowerCase() === "shuttle_nearest");
        if (shuttleLoc) rows.push({ location_id: shuttleLoc.id, minutes: shuttleWalkMinutes });
      }
    }
  } catch (e) {
    console.error("[reviewReferral] resolve walk-time locations failed:", e?.message);
  }
  return rows;
}

// Same shape as buildWalkTimeRows — resolved location_id rows, upserted after stub create.
async function buildDriveTimeRows(lat, lng) {
  let placeDriveMinutes = {};
  try {
    ({ placeDriveMinutes } = await fetchAllDriveTimes(lat, lng));
  } catch (err) {
    console.error("[reviewReferral] drive times failed:", err?.message);
    return [];
  }
  const rows = [];
  try {
    const { data: locations } = await supabase.from("locations").select("id, name");
    if (locations?.length) {
      for (const [key, minutes] of Object.entries(placeDriveMinutes ?? {})) {
        const loc = locations.find((l) => l.name.toLowerCase() === key.toLowerCase());
        if (loc && minutes != null) rows.push({ location_id: loc.id, minutes });
      }
    }
  } catch (e) {
    console.error("[reviewReferral] resolve drive-time locations failed:", e?.message);
  }
  return rows;
}

// Find an existing listing whose street address matches the searched address (after
// canonicalizing suffix/directional abbreviations; see normStreet), within a tight geo box.
// Same-address ties: prefer a non-sublease, then one whose owner has the 'landlord' role.
async function findExactAddressListingId({ address, lat, lng }) {
  const target = normStreet(address);
  if (!target || lat == null || lng == null) return null;

  const latPad = 0.01;
  const lngPad = 0.013;
  const { data } = await supabase
    .from("listings")
    .select("id, address, lease_type, created_at")
    .is("deleted_at", null)
    .gte("latitude", lat - latPad)
    .lte("latitude", lat + latPad)
    .gte("longitude", lng - lngPad)
    .lte("longitude", lng + lngPad)
    .limit(100);

  const exact = (data || []).filter((l) => normStreet(l.address) === target);
  if (exact.length === 0) return null;
  if (exact.length === 1) return exact[0].id;

  const ids = exact.map((l) => l.id);
  const { data: lls } = await supabase
    .from("listing_landlords")
    .select("listing_id, owner:users!user_id(roles!role_id(name))")
    .in("listing_id", ids);
  const hasLandlordOwner = {};
  for (const ll of lls || []) {
    if (ll.owner?.roles?.name === "landlord") hasLandlordOwner[ll.listing_id] = true;
  }

  exact.sort((a, b) => {
    const aSub = (a.lease_type || "").toLowerCase() === "sublease";
    const bSub = (b.lease_type || "").toLowerCase() === "sublease";
    if (aSub !== bSub) return aSub ? 1 : -1; // non-sublease first
    const aLL = !!hasLandlordOwner[a.id];
    const bLL = !!hasLandlordOwner[b.id];
    if (aLL !== bLL) return aLL ? -1 : 1; // landlord-owned first
    return new Date(a.created_at) - new Date(b.created_at); // stable
  });
  return exact[0].id;
}

// First real (non-placeholder, non-system) owner account for a listing.
async function getRealOwner(listingId, proximityId) {
  const { data } = await supabase
    .from("listing_landlords")
    .select("is_primary, owner:users!user_id(id, name, email, is_system, deleted_at, roles!role_id(name))")
    .eq("listing_id", listingId);
  const owners = (data || [])
    .map((o) => ({ is_primary: o.is_primary, ...(o.owner || {}), role: o.owner?.roles?.name ?? null }))
    .filter((u) => u.id && !u.is_system && !u.deleted_at && u.id !== proximityId && u.email);
  if (!owners.length) return null;
  owners.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
  return owners[0];
}

async function sendLandlordReviewEmail({ to, toName, listingAddress, listingId, scenario }) {
  if (!emailConfigured()) {
    console.warn("[reviewReferral] Email env not set — skipping landlord notification.");
    return;
  }
  const listingUrl = `${SITE_URL}/browse?listing=${listingId}`;
  const loginUrl = `${SITE_URL}/login`;
  const addr = listingAddress || "your property";

  let subject, intro, ctaLabel, ctaUrl;
  if (scenario === "claim_new") {
    subject = "A review was submitted for your property on Proximity";
    intro = `A student just submitted a review under your name for <strong>${addr}</strong>. Sign in to your Proximity account, then reply to this email to let us know — we'll connect this property to your account and walk you through the next steps.`;
    ctaLabel = "Sign in";
    ctaUrl = loginUrl;
  } else if (scenario === "alert_old") {
    subject = "New review for your property on Proximity";
    intro = `A student just left a review for your property at <strong>${addr}</strong>.`;
    ctaLabel = "View your listing";
    ctaUrl = listingUrl;
  } else {
    subject = "A review was submitted for your property on Proximity";
    intro = `A student just submitted a review for <strong>${addr}</strong>. To view the review or respond to it, create a free account on Proximity and reply to this email to let us know — we'll give you directions to get set up.`;
    ctaLabel = "Create an account";
    ctaUrl = loginUrl;
  }

  await sendMailSafe(_mailer, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to,
    bcc: TEAM_EMAIL,
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
        <p>Hi ${toName || "there"},</p>
        <p>${intro}</p>
        <p style="margin-top: 16px;">
          <a href="${ctaUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">${ctaLabel}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p>Best,<br/>The Proximity Team<br/><a href="${SITE_URL}" style="color: #dc2626;">useproximity.org</a></p>
        <p style="color: #9ca3af; font-size: 12px;">You're receiving this because a review was submitted for a property associated with this email on Proximity.</p>
      </div>
    `,
  });
}

async function sendContactMismatchAlert({ listingAddress, listingId, ownerEmail, submittedEmail, reviewerName }) {
  if (!emailConfigured()) {
    console.warn("[reviewReferral] Email env not set — skipping mismatch alert.");
    return;
  }
  const listingUrl = `${SITE_URL}/browse?listing=${listingId}`;
  await sendMailSafe(_mailer, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: TEAM_EMAIL,
    subject: "⚠️ Review landlord-email mismatch on Proximity",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
        <p>A new review was submitted for an existing listing, but the landlord contact email entered by the reviewer does <strong>not</strong> match the listing owner's email.</p>
        <p><strong>Property:</strong> ${listingAddress || "—"} (<a href="${listingUrl}">view listing</a>)</p>
        <p><strong>Listing owner email:</strong> ${ownerEmail}</p>
        <p><strong>Email entered in review:</strong> ${submittedEmail}</p>
        <p><strong>Submitted by:</strong> ${reviewerName || "—"}</p>
        <p style="color:#6b7280;font-size:13px;">Confirm which landlord is correct for this property.</p>
      </div>
    `,
  });
}

// Returns how many reviews the signed-in account has used vs. the cap, so the form can
// warn before the student fills it out.
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const used = await countUserReviews(session.user.id);
    return NextResponse.json({ count: used, limit: REVIEW_LIMIT, atLimit: used >= REVIEW_LIMIT });
  } catch (e) {
    console.error("GET /api/reviewReferral failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      referrerId,
      school,
      rating,
      communicationRating,
      locationRating,
      valueRating,
      comment,
      unitNumber,
      unitDesignator,
      address,
      latitude,
      longitude,
      landlordName,
      landlordEmail,
      landlordPhone,
      noLandlordContact,
      anonymous,
      source,
      reviewer,
    } = body;

    // ── Validate referrer (the ambassador) ──────────────────────────────────
    // Optional: absent for reviews left from the public /review page. When present it must
    // resolve to a live account, so a bad referral link still fails loudly.
    if (referrerId) {
      const { data: referrer } = await supabase
        .from("users")
        .select("id")
        .eq("id", referrerId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!referrer) {
        return NextResponse.json({ error: "Invalid referral link" }, { status: 400 });
      }
    }

    // ── Validate school ─────────────────────────────────────────────────────
    if (!isKnownSchool(school)) {
      return NextResponse.json(
        { error: "Select the school you go / went to." },
        { status: 400 }
      );
    }

    // ── Validate ratings (all four required, half-star) ─────────────────────
    for (const [label, val] of [
      ["overall rating", rating],
      ["communication rating", communicationRating],
      ["value rating", valueRating],
      ["location rating", locationRating],
    ]) {
      if (!isHalfStar(val)) {
        return NextResponse.json(
          { error: `Please set a ${label} (½–5 stars).` },
          { status: 400 }
        );
      }
    }

    // ── Validate written review ─────────────────────────────────────────────
    if (!comment || comment.trim().length < 10) {
      return NextResponse.json(
        { error: "Please write at least 10 characters." },
        { status: 400 }
      );
    }

    // ── Validate landlord/company name + contact ────────────────────────────
    if (!landlordName || landlordName.trim().length < 2) {
      return NextResponse.json(
        { error: "Please enter the landlord or company name." },
        { status: 400 }
      );
    }
    const hasEmail = landlordEmail && EMAIL_RE.test(String(landlordEmail).trim());
    const hasPhone = landlordPhone && String(landlordPhone).trim().length >= 7;
    if (!noLandlordContact && !hasEmail && !hasPhone) {
      if (landlordEmail && !hasEmail) {
        return NextResponse.json({ error: "Enter a valid landlord email." }, { status: 400 });
      }
      return NextResponse.json(
        { error: "Add a landlord email or phone, or check that you don't have it." },
        { status: 400 }
      );
    }

    /*
     * ── Resolve the reviewer ────────────────────────────────────────────────
     * Either a session, or the contact block a signed-out reviewer filled in at
     * the bottom of the form. In BOTH cases the school is proved by an email
     * domain and never taken on trust, which is the property that makes the
     * school tag on a review worth anything.
     */
    const session = await auth();
    const signedOutReviewer = !session?.user?.id && reviewer ? reviewer : null;

    let reviewerUserId = null;
    let reviewerEmail = null;
    let reviewerDisplayName = null;
    let emailSchool = null;
    let setupToken = null;
    // Signed-out reviewer whose email already belongs to a real account.
    let existingAccount = false;

    if (session?.user?.id) {
      emailSchool = schoolForEmail(session.user.email);
      if (!emailSchool) {
        return NextResponse.json(
          { error: "Only students at a school we serve can leave reviews." },
          { status: 403 }
        );
      }
      if (!schoolMatchesEmail(school, session.user.email)) {
        return NextResponse.json(
          { error: `Your account email belongs to ${emailSchool.shortName}. Select that school.` },
          { status: 403 }
        );
      }
      reviewerUserId = session.user.id;
      reviewerEmail = session.user.email;
      reviewerDisplayName = session.user.name || null;
    } else if (signedOutReviewer) {
      const email = String(signedOutReviewer.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
      }
      emailSchool = schoolForEmail(email);
      if (!emailSchool) {
        return NextResponse.json(
          { error: "Use your school email address so we can verify your review." },
          { status: 403 }
        );
      }
      // The client derives `school` from this same address; re-derive rather than believe it.
      if (school && !schoolMatchesEmail(school, email)) {
        return NextResponse.json(
          { error: `That email belongs to ${emailSchool.shortName}. Select that school.` },
          { status: 403 }
        );
      }
      if (!normalizeClassYear(signedOutReviewer.classYear)) {
        return NextResponse.json({ error: "Select your class year." }, { status: 400 });
      }
      /*
       * The signed-in path costs a verified school login and is capped per
       * account. This path has neither, so a soft per-client limit is the only
       * thing between one person and a hundred reviews.
       */
      if (anonReviewRateLimited(anonReviewRateKey(req, email))) {
        return NextResponse.json(
          { error: "That's a lot of reviews at once. Please try again later." },
          { status: 429 }
        );
      }

      const account = await ensureReviewerAccount({
        firstName: signedOutReviewer.firstName,
        lastName: signedOutReviewer.lastName,
        email,
        classYear: signedOutReviewer.classYear,
        source: normalizeReviewSource(source),
      });
      if (account.error) {
        return NextResponse.json({ error: account.error }, { status: 400 });
      }
      reviewerUserId = account.userId;
      reviewerEmail = email;
      reviewerDisplayName = account.displayName;
      setupToken = account.setupToken;
      existingAccount = !!account.existingAccount;
    } else {
      return NextResponse.json(
        { error: "Add your name and school email, or sign in, to leave a review." },
        { status: 401 }
      );
    }

    // Record the reviewer's school on their account. This is the only place the school is
    // persisted — a review's school comes from joining listing_reviews → users → schools.
    const schoolId = await resolveSchoolId(emailSchool.shortName);
    if (schoolId) {
      const { error: schoolErr } = await supabase
        .from("users")
        .update({ school_id: schoolId })
        .eq("id", reviewerUserId);
      if (schoolErr) {
        // Non-fatal: the review itself still stands.
        console.error("[reviewReferral] school_id update failed:", schoolErr.message);
      }
    }

    // ── Enforce per-account review cap ──────────────────────────────────────
    if ((await countUserReviews(reviewerUserId)) >= REVIEW_LIMIT) {
      return NextResponse.json(
        { error: `You've reached the maximum of ${REVIEW_LIMIT} reviews.` },
        { status: 403 }
      );
    }

    // ── Resolve the listing: exact address match, else create a stub ────────
    const addressText = String(address || "").trim();
    if (!addressText || latitude == null || longitude == null) {
      return NextResponse.json(
        { error: "Search and select your property address." },
        { status: 400 }
      );
    }
    const landlordEmailNorm = hasEmail ? String(landlordEmail).trim().toLowerCase() : null;

    let resolvedListingId = await findExactAddressListingId({
      address: addressText,
      lat: latitude,
      lng: longitude,
    });
    let isNewProperty = false;

    if (!resolvedListingId) {
      const [homeTypeId, proximityId, walkTimeRows, driveTimeRows] = await Promise.all([
        resolveOtherHomeTypeId(),
        resolveProximityLandlordId(),
        buildWalkTimeRows(latitude, longitude),
        buildDriveTimeRows(latitude, longitude),
      ]);
      const { data: stubId, error: stubErr } = await supabase.rpc("rpc_create_listing", {
        p_user_id: proximityId,
        p_listing_data: {
          address: addressText,
          latitude,
          longitude,
          description: "Added from a student review.",
          lease_type: "standard",
          home_type_id: homeTypeId,
          furnished: false,
          sublease_friendly: false,
          twenty_one_plus: false,
          unavailable: true,
          deleted_at: null,
        },
        p_amenities: {},
        p_utilities: {},
        p_walk_times: walkTimeRows,
        p_units: [],
        p_lease_availability: null,
      });
      if (stubErr) {
        console.error("reviewReferral: stub listing create failed:", stubErr.message);
        return NextResponse.json({ error: "Could not save that property." }, { status: 500 });
      }
      resolvedListingId = stubId;
      isNewProperty = true;

      // Tag the stub with the reviewer's school. Written here rather than passed into
      // rpc_create_listing because that RPC inserts an explicit column list that omits
      // school_id (same reason drive times are upserted below).
      if (schoolId) {
        const { error: tagErr } = await supabase
          .from("listings")
          .update({ school_id: schoolId })
          .eq("id", stubId);
        if (tagErr) {
          console.error("[reviewReferral] listing school tag failed:", tagErr.message);
        }
      }

      // Drive times: best-effort upsert after stub create (mirrors addListing; not in RPC).
      if (driveTimeRows.length) {
        try {
          const { error: driveErr } = await supabase
            .from("listing_drive_times")
            .upsert(
              driveTimeRows.map((r) => ({ ...r, listing_id: stubId })),
              { onConflict: "listing_id,location_id" }
            );
          if (driveErr) {
            console.error("[reviewReferral] drive times insert failed:", driveErr.message);
          }
        } catch (dtErr) {
          console.error("[reviewReferral] drive times insert failed:", dtErr?.message);
        }
      }

      // Give the new stub a default Street View photo (best-effort; never blocks the review).
      try {
        await fetchAndStoreStreetView({
          supabase,
          listingId: resolvedListingId,
          address: addressText,
          lat: latitude,
          lng: longitude,
        });
      } catch (svErr) {
        console.error("reviewReferral: Street View attach failed:", svErr?.message);
      }
    }

    // ── Insert the review (auto-published) ──────────────────────────────────
    const { data: review, error } = await insertAsUser(supabase, {
      userId: reviewerUserId,
      table: "listing_reviews",
      data: {
        user_id: reviewerUserId,
        listing_id: resolvedListingId,
        rating,
        comment: comment.trim(),
        legitimacy: true,
        communication_rating: communicationRating,
        location_rating: locationRating,
        value_rating: valueRating,
        anonymous: !!anonymous,
        // When anonymous, don't even store the display name — identity lives only
        // in user_id (for moderation), never surfaced in public/landlord views.
        name: anonymous ? null : reviewerDisplayName || null,
        // 'Whole' covers the entire property and carries no number (DB CHECK).
        unit_designator: unitDesignator || null,
        unit_number:
          unitDesignator === "Whole" ? null : unitNumber?.trim() || null,
        source: normalizeReviewSource(source),
        landlord_name: landlordName.trim(),
        landlord_email: landlordEmailNorm,
        landlord_phone: hasPhone ? String(landlordPhone).trim() : null,
        no_landlord_contact: !!noLandlordContact,
        referrer_id: referrerId,
      },
    });

    if (error) {
      console.error("reviewReferral: insert failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    // ── Notify the landlord + flag email mismatches (best-effort) ───────────
    try {
      const proximityId = await resolveProximityLandlordId();
      const { data: listingRow } = await supabase
        .from("listings")
        .select("address, lease_type")
        .eq("id", resolvedListingId)
        .maybeSingle();
      const owner = isNewProperty ? null : await getRealOwner(resolvedListingId, proximityId);
      const isSubleaseListing = String(listingRow?.lease_type || "").toLowerCase() === "sublease";

      // Decide recipient + message. Entered-email-first: a landlord email typed into the
      // review always wins (even if it belongs to a student). Only when none was entered do
      // we fall back to the listing owner — and never to a sublease manager: skip the
      // fallback when the listing is a sublease or the owner is a student.
      let recipient = null;
      if (landlordEmailNorm) {
        const { data: u } = await supabase
          .from("users")
          .select("id, name")
          .eq("email", landlordEmailNorm)
          .is("deleted_at", null)
          .maybeSingle();
        const scenario = u ? (isNewProperty ? "claim_new" : "alert_old") : "create_account";
        recipient = { to: landlordEmailNorm, toName: u?.name || landlordName.trim(), scenario };
      } else if (owner && !isSubleaseListing && owner.role !== "student") {
        recipient = { to: owner.email, toName: owner.name || landlordName.trim(), scenario: "alert_old" };
      }
      if (recipient?.to) {
        await sendLandlordReviewEmail({
          to: recipient.to,
          toName: recipient.toName,
          listingAddress: listingRow?.address,
          listingId: resolvedListingId,
          scenario: recipient.scenario,
        });
      }

      // Existing listing + a provided landlord email that doesn't match the owner.
      if (owner && landlordEmailNorm && owner.email.toLowerCase() !== landlordEmailNorm) {
        await sendContactMismatchAlert({
          listingAddress: listingRow?.address,
          listingId: resolvedListingId,
          ownerEmail: owner.email,
          submittedEmail: landlordEmailNorm,
          reviewerName: reviewerDisplayName || reviewerEmail,
        });
      }
    } catch (mailErr) {
      console.error("[reviewReferral] notification failed:", mailErr?.message);
    }

    /*
     * "Your review is live", to whoever wrote it. Unlike the welcome email
     * below this goes to EVERY reviewer, signed in or not: before this, a
     * signed-in student got no acknowledgement of their own review at all.
     *
     * Best-effort, like every other send here. A dead mail server must never
     * turn a posted review into an error.
     */
    if (reviewerEmail) {
      try {
        const { data: reviewed } = await supabase
          .from("listings")
          .select("title, address")
          .eq("id", resolvedListingId)
          .maybeSingle();
        await sendReviewLiveEmail({
          email: reviewerEmail,
          name: reviewerDisplayName,
          baseUrl: getBaseUrl(req),
          placeName: listingPlaceName(reviewed || { address: addressText }),
        });
      } catch (mailErr) {
        console.error("[reviewReferral] review-live email failed:", mailErr?.message);
      }
    }

    /*
     * Welcome + finish-your-profile, for an account this submission just
     * created. Best-effort: a failed email must never fail a posted review,
     * they still get the profile step inline on the page.
     */
    if (setupToken && reviewerEmail) {
      try {
        const { data: reviewedListing } = await supabase
          .from("listings")
          .select("address")
          .eq("id", resolvedListingId)
          .maybeSingle();
        await sendReviewWelcomeEmail({
          email: reviewerEmail,
          name: reviewerDisplayName,
          token: setupToken,
          baseUrl: getBaseUrl(req),
          place: reviewedListing?.address || addressText,
        });
      } catch (mailErr) {
        console.error("[reviewReferral] welcome email failed:", mailErr?.message);
      }
    }

    return NextResponse.json({
      success: true,
      review,
      setupToken,
      existingAccount,
      // What the profile step should open pre-filled with, so the student never
      // retypes what they just told us.
      prefill: setupToken
        ? {
            firstName: String(signedOutReviewer.firstName || "").trim(),
            lastName: String(signedOutReviewer.lastName || "").trim(),
            email: reviewerEmail,
            role: "student",
            graduationYear: normalizeClassYear(signedOutReviewer.classYear),
            graduationMonth: 5,
            gender: "",
            referralSource: "",
          }
        : null,
    });
  } catch (e) {
    console.error("POST /api/reviewReferral failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
