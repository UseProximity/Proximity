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
      images,
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
      minRent,
      maxRent,
      minBedrooms,
      maxBedrooms,
      minBathrooms,
      maxBathrooms,
      minArea,
      maxArea,
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

    // Insert listing row into Supabase
    const { data: newListing, error: listingError } = await supabase
      .from("listings")
      .insert({
        landlord_id: ownerId ? [ownerId] : [],
        title: title?.trim() || null,
        address,
        longitude: resolvedLng,
        latitude: resolvedLat,
        description,
        lease_type: leaseType || "standard",
        images: images || [],
        place_walk_minutes: placeWalkMinutes,
        shuttle_walk_minutes: shuttleWalkMinutes,
        // Extra fields
        lease_structure: leaseStructure ?? null,
        home_type: homeType ?? "apartment",
        amenities: amenities ?? [],
        utilities_included: utilitiesIncluded ?? [],
        sublease_friendly: subleaseFriendly ?? false,
        twenty_one_plus: twenty_one_plus ?? false,
        furnished: furnished ?? false,
        move_in_date: moveInDate ?? null,
        contact_email: contactEmail ?? null,
        contact_phone: contactPhone ?? null,
        contact_name: contactName ?? null,
        lease_availability: (() => {
          const val = leaseAvailability ?? lease_availability ?? null;
          if (Array.isArray(val)) return val;
          if (val) return [val];
          return [];
        })(),
      })
      .select()
      .single();

    if (listingError) {
      console.error("Error creating listing:", listingError.message);
      return NextResponse.json({ error: listingError.message }, { status: 500 });
    }

    // Notify landlord(s) of their new listing
    if (Array.isArray(newListing.landlord_id) && newListing.landlord_id.length > 0) {
      try {
        const { data: landlordUsers } = await supabase
          .from("users")
          .select("email, name")
          .in("id", newListing.landlord_id);
        for (const landlordUser of (landlordUsers ?? [])) {
          if (landlordUser?.email) {
            await sendNewListingEmail(landlordUser.email, landlordUser.name, newListing.address, newListing.id);
          }
        }
      } catch (emailErr) {
        console.error("[addListing] Failed to send landlord notification:", emailErr?.message);
      }
    }

    // Insert each unit type row into listing_units
    if (unitTypes.length > 0) {
      const unitRows = unitTypes.map((unit) => ({
        listing_id: newListing.id,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        rent: unit.rent ?? null,
        area: unit.area ?? null,
        lease_availability: unit.leaseAvailability ?? leaseAvailability ?? null,
      }));

      const { error: unitsError } = await supabase
        .from("listing_units")
        .insert(unitRows);

      if (unitsError) {
        console.error("Error creating listing units:", unitsError.message);
        return NextResponse.json({ error: unitsError.message }, { status: 500 });
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
