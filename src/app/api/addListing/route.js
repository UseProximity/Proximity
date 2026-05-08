import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { auth } from "@/auth";
import { fetchAllWalkTimes } from "@/utils/walkTimes";
import nodemailer from "nodemailer";

const _emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

async function sendNewListingEmail(toEmail, toName, address, listingId) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("[sendNewListingEmail] Email env vars not set — skipping in dev mode.");
    return;
  }
  const listingUrl = `https://useproximity.org/browse?listing=${listingId}`;
  await _emailTransporter.sendMail({
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "You have a new listing on Proximity!",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
        <p>Hi ${toName || "there"},</p>
        <p>Congratulations! A new listing has been added to your Proximity account.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p><strong>Address:</strong> ${address}</p>
        <p style="margin-top: 16px;">
          <a href="${listingUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">View Your Listing</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p>Best,<br/>The Proximity Team<br/><a href="https://useproximity.org" style="color: #dc2626;">useproximity.org</a></p>
        <p style="color: #9ca3af; font-size: 12px;">You're receiving this because a listing was assigned to your account on Proximity.</p>
      </div>
    `,
  });
}

async function geocodeAddress(address) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=1&country=US`;
  const res = await fetch(url);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.center;
  return { latitude: lat, longitude: lng };
}

// Valid boolean column names on listing_amenities / listing_utilities.
// Clients send these names directly; unknown values are ignored.
const AMENITY_COLS = new Set([
  "air_conditioning", "dishwasher", "gym", "laundry", "mailroom",
  "microwave", "oven", "parking", "pets_allowed", "pool",
  "refrigerator", "rooftop", "storage", "stove", "study_room",
]);

const UTILITY_COLS = new Set([
  "electric", "gas", "heat", "water", "internet",
  "trash", "cable", "sewer", "cooling",
]);

export async function POST(req) {
  try {
    const body = await req.json();

    const {
      address,
      longitude,
      latitude,
      description,
      unitTypes,
      leaseType,
      // Extra fields
      leaseAvailability,
      lease_availability,
      leaseStructure,
      homeType,
      amenities,
      utilitiesIncluded,
      subleaseFriendly,
      twenty_one_plus,
      furnished,
      moveInDate,
      contactEmail,
      contactPhone,
      contactName,
      title,
    } = body;

    // Validate required fields
    if (
      !address?.trim() ||
      !description?.trim() ||
      !Array.isArray(unitTypes) ||
      unitTypes.length === 0
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const invalidUnit = unitTypes.some(
      (unit) => unit.bedrooms === undefined || unit.bathrooms === undefined
    );

    if (invalidUnit) {
      return NextResponse.json({ error: "Invalid unit type" }, { status: 400 });
    }

    // Allow import script to bypass auth using a shared secret
    const importSecret = process.env.IMPORT_SECRET;
    const providedSecret = req.headers.get("x-import-secret");
    const isImportRequest = importSecret && providedSecret === importSecret;

    let ownerId = null;

    if (!isImportRequest) {
      const session = await auth();
      if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const userRole = session?.user?.role;
      if (!["student", "landlord", "super"].includes(userRole)) {
        return NextResponse.json(
          { error: "Only students, landlords, and super admins can create listings." },
          { status: 403 }
        );
      }
      ownerId = session?.user?.id;
      if (!ownerId) {
        return NextResponse.json({ error: "Owner not found" }, { status: 404 });
      }
    }

    // Geocode address if lat/lng not provided
    let resolvedLat = latitude;
    let resolvedLng = longitude;
    if (resolvedLat === undefined || resolvedLng === undefined) {
      const coords = await geocodeAddress(address);
      if (!coords) {
        return NextResponse.json(
          { error: "Could not geocode address" },
          { status: 400 }
        );
      }
      resolvedLat = coords.latitude;
      resolvedLng = coords.longitude;
    }

    // Calculate real walking times to campus + all WashU places + shuttle stops via Mapbox
    let placeWalkMinutes = {};
    let shuttleWalkMinutes = null;
    try {
      ({ placeWalkMinutes, shuttleWalkMinutes } = await fetchAllWalkTimes(resolvedLat, resolvedLng));
    } catch (err) {
      console.error("[walkTimes] Failed to fetch walk times:", err?.message);
    }

    // Look up home_type_id from home_types table
    let homeTypeId = null;
    if (homeType) {
      const { data: homeTypeRow } = await supabase
        .from("home_types")
        .select("id")
        .ilike("label", homeType)
        .maybeSingle();
      homeTypeId = homeTypeRow?.id ?? null;
    }
    // Fall back to 'Other' if not found
    if (!homeTypeId) {
      const { data: otherRow } = await supabase
        .from("home_types")
        .select("id")
        .eq("label", "Other")
        .maybeSingle();
      homeTypeId = otherRow?.id ?? null;
    }

    // Normalize lease_availability — only pass through if it looks like a real date (YYYY-MM-DD).
    // The form also sends category labels like "semester" which cannot be cast to date.
    const leaseAvailabilityVal = (() => {
      const val = leaseAvailability ?? lease_availability ?? null;
      const raw = Array.isArray(val) ? (val[0] ?? null) : val;
      return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    })();

    // Build amenity and utility boolean maps
    const amenityObj = Object.fromEntries([...AMENITY_COLS].map((c) => [c, false]));
    for (const name of (amenities ?? [])) {
      if (typeof name === "string" && AMENITY_COLS.has(name)) amenityObj[name] = true;
    }

    const utilityObj = Object.fromEntries([...UTILITY_COLS].map((c) => [c, false]));
    for (const name of (utilitiesIncluded ?? [])) {
      if (typeof name === "string" && UTILITY_COLS.has(name)) utilityObj[name] = true;
    }

    // Resolve walk-time location IDs (read-only; insert happens inside rpc_create_listing)
    const walkTimeRows = [];
    try {
      const { data: locations } = await supabase.from("locations").select("id, name");
      if (locations?.length) {
        for (const [key, minutes] of Object.entries(placeWalkMinutes ?? {})) {
          const loc = locations.find((l) => l.name.toLowerCase() === key.toLowerCase());
          if (loc && minutes != null) walkTimeRows.push({ location_id: loc.id, minutes });
        }
        if (shuttleWalkMinutes != null) {
          const shuttleLoc = locations.find((l) => l.name.toLowerCase() === "shuttle_nearest");
          if (shuttleLoc) walkTimeRows.push({ location_id: shuttleLoc.id, minutes: shuttleWalkMinutes });
        }
      }
    } catch (wtErr) {
      console.error("[addListing] Failed to resolve walk times:", wtErr?.message);
    }

    // Build leases array — accept new `leases` payload or convert legacy `unitTypes`.
    const leaseData = (body.leases ?? unitTypes).map((unit) => ({
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      area: unit.area ?? null,
      pricing_basis: unit.pricing_basis ?? "per_unit",
      rent: unit.rent ?? null,
      beds_in_lease: unit.beds_in_lease ?? null,
      lease_term_months: unit.lease_term_months ?? 12,
      available_from: unit.available_from ?? unit.leaseAvailability ?? leaseAvailabilityVal ?? null,
      sublease: unit.sublease ?? false,
      summer_only: unit.summer_only ?? false,
      semester_only: unit.semester_only ?? false,
      unit_group_label: unit.unit_group_label ?? null,
    }));

    const { data: listingId, error: listingError } = await supabase.rpc("rpc_create_listing_v2", {
      p_user_id: ownerId,
      p_listing_data: {
        title: title?.trim() || null,
        address,
        longitude: resolvedLng,
        latitude: resolvedLat,
        description,
        lease_type: leaseType || "standard",
        home_type_id: homeTypeId,
        lease_structure: leaseStructure ?? null,
        sublease_friendly: subleaseFriendly ?? false,
        twenty_one_plus: twenty_one_plus ?? false,
        furnished: furnished ?? false,
        move_in_date: moveInDate ?? null,
        contact_email: contactEmail ?? null,
        contact_phone: contactPhone ?? null,
        contact_name: contactName ?? null,
        unavailable: false,
        deleted_at: null,
      },
      p_amenities: amenityObj,
      p_utilities: utilityObj,
      p_walk_times: walkTimeRows,
      p_leases: leaseData,
      p_pet_policy: body.petPolicy ?? null,
    });

    if (listingError) {
      console.error("Error creating listing:", listingError.message);
      return NextResponse.json({ error: listingError.message }, { status: 500 });
    }

    // Notify landlord of their new listing
    if (ownerId) {
      try {
        const { data: landlordUsers } = await supabase
          .from("users")
          .select("email, name")
          .eq("id", ownerId);
        for (const landlordUser of (landlordUsers ?? [])) {
          if (landlordUser?.email) {
            await sendNewListingEmail(landlordUser.email, landlordUser.name, address, listingId);
          }
        }
      } catch (emailErr) {
        console.error("[addListing] Failed to send landlord notification:", emailErr?.message);
      }
    }

    return NextResponse.json(
      { message: "Listing created successfully", listing: { id: listingId, address } },
      { status: 201 }
    );
  } catch (e) {
    console.error("Error:", e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
