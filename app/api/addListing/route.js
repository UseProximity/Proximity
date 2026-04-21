import { NextResponse } from "next/server";
import supabase from "@/libs/supabase";
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

const AMENITY_MAP = {
  "ac_heating": "air_conditioning",
  "ac/heating": "air_conditioning",
  "air_conditioning": "air_conditioning",
  "air conditioning": "air_conditioning",
  "dishwasher": "dishwasher",
  "gym": "gym",
  "laundry": "laundry",
  "in_unit_laundry": "laundry",
  "in-unit laundry": "laundry",
  "mailroom": "mailroom",
  "microwave": "microwave",
  "oven": "oven",
  "parking": "parking",
  "private_parking": "parking",
  "private parking": "parking",
  "pets_allowed": "pets_allowed",
  "pets allowed": "pets_allowed",
  "pet friendly": "pets_allowed",
  "pet_friendly": "pets_allowed",
  "pool": "pool",
  "refrigerator": "refrigerator",
  "rooftop": "rooftop",
  "storage": "storage",
  "extra_storage": "storage",
  "extra storage": "storage",
  "bike storage": "storage",
  "bike_storage": "storage",
  "stove": "stove",
  "study_room": "study_room",
  "study room": "study_room",
};

const UTILITY_MAP = {
  "electric": "electric",
  "electricity": "electric",
  "gas": "gas",
  "heat": "heat",
  "heating": "heat",
  "water": "water",
  "internet": "internet",
  "wifi": "internet",
  "wi-fi": "internet",
  "trash": "trash",
  "cable": "cable",
  "sewer": "sewer",
  "cooling": "cooling",
};

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
        .eq("label", homeType)
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

    // Normalize lease_availability
    const leaseAvailabilityVal = (() => {
      const val = leaseAvailability ?? lease_availability ?? null;
      if (Array.isArray(val)) return val[0] ?? null;
      return val;
    })();

    // Insert listing row into Supabase (no dropped columns)
    const { data: newListing, error: listingError } = await supabase
      .from("listings")
      .insert({
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
      })
      .select("id, address")
      .single();

    if (listingError) {
      console.error("Error creating listing:", listingError.message);
      return NextResponse.json({ error: listingError.message }, { status: 500 });
    }

    const listingId = newListing.id;

    // Insert into listing_landlords
    if (ownerId) {
      await supabase.from("listing_landlords").insert({
        listing_id: listingId,
        user_id: ownerId,
        is_primary: true,
      });
    }

    // Insert listing_amenities row
    const amenityRow = { listing_id: listingId };
    for (const name of (amenities ?? [])) {
      const col = AMENITY_MAP[name.toLowerCase()];
      if (col) amenityRow[col] = true;
    }
    await supabase.from("listing_amenities").insert(amenityRow);

    // Insert listing_utilities row
    const utilityRow = { listing_id: listingId };
    for (const name of (utilitiesIncluded ?? [])) {
      const col = UTILITY_MAP[name.toLowerCase()];
      if (col) utilityRow[col] = true;
    }
    await supabase.from("listing_utilities").insert(utilityRow);

    // Insert listing_walk_times rows
    try {
      const { data: locations } = await supabase
        .from("locations")
        .select("id, name");

      const walkTimeRows = [];

      if (locations && locations.length > 0) {
        // Map placeWalkMinutes keys to location rows (case-insensitive)
        for (const [key, minutes] of Object.entries(placeWalkMinutes ?? {})) {
          const loc = locations.find(
            (l) => l.name.toLowerCase() === key.toLowerCase()
          );
          if (loc && minutes != null) {
            walkTimeRows.push({ listing_id: listingId, location_id: loc.id, minutes });
          }
        }

        // Map shuttleWalkMinutes to the shuttle_nearest location
        if (shuttleWalkMinutes != null) {
          const shuttleLoc = locations.find(
            (l) => l.name.toLowerCase() === "shuttle_nearest"
          );
          if (shuttleLoc) {
            walkTimeRows.push({
              listing_id: listingId,
              location_id: shuttleLoc.id,
              minutes: shuttleWalkMinutes,
            });
          }
        }
      }

      if (walkTimeRows.length > 0) {
        await supabase.from("listing_walk_times").insert(walkTimeRows);
      }
    } catch (wtErr) {
      console.error("[addListing] Failed to insert walk times:", wtErr?.message);
    }

    // Insert listing_units (without rent and lease_availability)
    const unitRows = unitTypes.map((unit) => ({
      listing_id: listingId,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      area: unit.area ?? null,
    }));

    const { data: insertedUnits, error: unitsError } = await supabase
      .from("listing_units")
      .insert(unitRows)
      .select("id, bedrooms, bathrooms");

    if (unitsError) {
      console.error("Error creating listing units:", unitsError.message);
      return NextResponse.json({ error: unitsError.message }, { status: 500 });
    }

    // Insert unit_leases for units that have rent
    const leaseRows = [];
    for (let i = 0; i < unitTypes.length; i++) {
      const unit = unitTypes[i];
      if (unit.rent != null && insertedUnits[i]) {
        leaseRows.push({
          unit_id: insertedUnits[i].id,
          rent: unit.rent,
          is_active: true,
          available_from: unit.leaseAvailability ?? leaseAvailabilityVal ?? null,
        });
      }
    }
    if (leaseRows.length > 0) {
      await supabase.from("unit_leases").insert(leaseRows);
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
            await sendNewListingEmail(landlordUser.email, landlordUser.name, newListing.address, listingId);
          }
        }
      } catch (emailErr) {
        console.error("[addListing] Failed to send landlord notification:", emailErr?.message);
      }
    }

    return NextResponse.json(
      { message: "Listing created successfully", listing: newListing },
      { status: 201 }
    );
  } catch (e) {
    console.error("Error:", e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
