import { NextResponse } from "next/server";
import supabase from "@/libs/supabase";
import { auth } from "@/auth";
import { fetchAllWalkTimes } from "@/utils/walkTimes";

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
      leaseStructure,
      homeType,
      amenities,
      utilitiesIncluded,
      subleaseFriendly,
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
        landlord_id: ownerId || null,
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
        furnished: furnished ?? false,
        move_in_date: moveInDate ?? null,
        contact_email: contactEmail ?? null,
        contact_phone: contactPhone ?? null,
        contact_name: contactName ?? null,
      })
      .select()
      .single();

    if (listingError) {
      console.error("Error creating listing:", listingError.message);
      return NextResponse.json({ error: listingError.message }, { status: 500 });
    }

    // Insert each unit type row into listing_units
    if (unitTypes.length > 0) {
      const unitRows = unitTypes.map((unit) => ({
        listing_id: newListing.id,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        rent: unit.rent ?? null,
        area: unit.area ?? null,
        furnished: unit.furnished ?? furnished ?? false,
        utilities_included: unit.utilitiesIncluded ?? utilitiesIncluded ?? [],
        lease_availability: unit.leaseAvailability ?? leaseAvailability ?? null,
        lease_structure: unit.leaseStructure ?? leaseStructure ?? null,
        move_in_date: unit.moveInDate ?? moveInDate ?? null,
        sublease_friendly: unit.subleaseFriendly ?? subleaseFriendly ?? false,
        amenities: unit.amenities ?? amenities ?? [],
        unavailable: unit.unavailable ?? false,
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
