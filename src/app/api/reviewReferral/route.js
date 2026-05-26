/*
 * Submission endpoint for the ambassador referral review flow (/refer/<userId>).
 *
 * Auth: the reviewer must be signed in with a WashU (@wustl.edu) account; the review is
 * attributed to that account. Reviews auto-publish (legitimacy=true). Max 2 per account.
 *
 * Listing resolution (no user choice): the reviewer-selected address is compared against
 * our catalog. On an EXACT street-address match the review is attached to that listing
 * (tie-break across same-address listings: prefer non-sublease, then a landlord-owned one).
 * With no match we auto-create a minimal listing "stub" owned by the shared Proximity
 * account, with real walk-times computed (same as the landlord add-listing flow).
 *
 * Emails (best-effort, never block the review):
 *   - The landlord is notified; messaging depends on whether they have an account and
 *     whether the property is new. info@useproximity.org is BCC'd on every notification.
 *   - For an existing listing, if the landlord email entered in the review differs from
 *     the listing owner's email, an alert is sent to info@useproximity.org.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { insertAsUser } from "@/lib/supabaseWithUser";
import { fetchAllWalkTimes } from "@/utils/walkTimes";
import nodemailer from "nodemailer";

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

// Normalize the street-address line (drop city/state/zip) for exact matching.
function normStreet(addr) {
  const line = String(addr || "").split(",")[0].trim().toLowerCase();
  return line.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
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

// Find an existing listing whose street address exactly matches the searched address.
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
    .select("is_primary, owner:users!user_id(id, name, email, is_system, deleted_at)")
    .eq("listing_id", listingId);
  const owners = (data || [])
    .map((o) => ({ is_primary: o.is_primary, ...(o.owner || {}) }))
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

  await _mailer.sendMail({
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
  await _mailer.sendMail({
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
      rating,
      communicationRating,
      locationRating,
      valueRating,
      comment,
      unitNumber,
      address,
      latitude,
      longitude,
      landlordName,
      landlordEmail,
      landlordPhone,
      noLandlordContact,
    } = body;

    // ── Validate referrer (the ambassador) ──────────────────────────────────
    if (!referrerId) {
      return NextResponse.json({ error: "Missing referral" }, { status: 400 });
    }
    const { data: referrer } = await supabase
      .from("users")
      .select("id")
      .eq("id", referrerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!referrer) {
      return NextResponse.json({ error: "Invalid referral link" }, { status: 400 });
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

    // ── Require a signed-in WashU account ───────────────────────────────────
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Please sign in to leave a review." }, { status: 401 });
    }
    if (!session.user.email?.toLowerCase().endsWith("@wustl.edu")) {
      return NextResponse.json(
        { error: "Only WashU students with a @wustl.edu email can leave reviews." },
        { status: 403 }
      );
    }
    const reviewerUserId = session.user.id;

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
      const [homeTypeId, proximityId, walkTimeRows] = await Promise.all([
        resolveOtherHomeTypeId(),
        resolveProximityLandlordId(),
        buildWalkTimeRows(latitude, longitude),
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
        name: session?.user?.name || null,
        unit_number: unitNumber?.trim() || null,
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
        .select("address")
        .eq("id", resolvedListingId)
        .maybeSingle();
      const owner = isNewProperty ? null : await getRealOwner(resolvedListingId, proximityId);

      // Decide recipient + message.
      let recipient = null;
      if (owner) {
        recipient = { to: owner.email, toName: owner.name || landlordName.trim(), scenario: "alert_old" };
      } else if (landlordEmailNorm) {
        const { data: u } = await supabase
          .from("users")
          .select("id, name")
          .eq("email", landlordEmailNorm)
          .is("deleted_at", null)
          .maybeSingle();
        const scenario = u ? (isNewProperty ? "claim_new" : "alert_old") : "create_account";
        recipient = { to: landlordEmailNorm, toName: u?.name || landlordName.trim(), scenario };
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
          reviewerName: session?.user?.name || session?.user?.email,
        });
      }
    } catch (mailErr) {
      console.error("[reviewReferral] notification failed:", mailErr?.message);
    }

    return NextResponse.json({ success: true, review });
  } catch (e) {
    console.error("POST /api/reviewReferral failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
