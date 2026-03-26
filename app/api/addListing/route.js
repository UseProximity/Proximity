import { NextResponse } from "next/server";
import User from "@/models/User";
import Listing from "@/models/Listing";
import connectMongo from "@/libs/mongoose";
import { auth } from "@/auth";
import { WASHU_PLACES, CAMPUS, SHUTTLE_STOPS } from "@/utils/washuPlaces";

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchWalkMinutes(lat, lng, destLat, destLng) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const origin = `${lng},${lat}`;
  const dest = `${destLng},${destLat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${origin};${dest}?access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  const seconds = data.routes?.[0]?.duration ?? null;
  return seconds != null ? Math.round(seconds / 60) : null;
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

async function fetchAllWalkTimes(latitude, longitude) {
  try {
    const campusWalkMinutes = await fetchWalkMinutes(
      latitude,
      longitude,
      CAMPUS.lat,
      CAMPUS.lng
    );

    const placeResults = await Promise.all(
      WASHU_PLACES.map(async (place) => {
        const minutes = await fetchWalkMinutes(
          latitude,
          longitude,
          place.lat,
          place.lng
        );
        return [place.name, minutes];
      })
    );
    const placeWalkMinutes = Object.fromEntries(
      placeResults.filter(([, m]) => m != null)
    );

    // Only check the 5 nearest stops to avoid rate limiting
    const nearest5 = [...SHUTTLE_STOPS]
      .sort(
        (a, b) =>
          haversineKm(latitude, longitude, a.lat, a.lng) -
          haversineKm(latitude, longitude, b.lat, b.lng)
      )
      .slice(0, 5);
    const shuttleTimes = await Promise.all(
      nearest5.map((s) => fetchWalkMinutes(latitude, longitude, s.lat, s.lng))
    );
    const validShuttle = shuttleTimes.filter((m) => m != null);
    const shuttleWalkMinutes =
      validShuttle.length > 0 ? Math.min(...validShuttle) : null;

    return { campusWalkMinutes, placeWalkMinutes, shuttleWalkMinutes };
  } catch (err) {
    console.error("[walkTimes] Failed to fetch walk times:", err?.message);
    return {
      campusWalkMinutes: null,
      placeWalkMinutes: {},
      shuttleWalkMinutes: null,
    };
  }
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
    } = body;

    console.log("Unit Types Received:", unitTypes);

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

    console.log("All required fields are valid.");

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

    console.log("Authentication successful.");

    await connectMongo();

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
      console.log(`Geocoded "${address}" → ${resolvedLat}, ${resolvedLng}`);
    }

    // Calculate real walking times to campus + all WashU places + shuttle stops via Mapbox
    const { campusWalkMinutes, placeWalkMinutes, shuttleWalkMinutes } =
      await fetchAllWalkTimes(resolvedLat, resolvedLng);

    // Create New Listing
    const newListing = await Listing.create({
      address,
      longitude: resolvedLng,
      latitude: resolvedLat,
      description,
      unitTypes,
      leaseType: leaseType || "standard",
      images: images || [],
      owner: ownerId || undefined,
      campusWalkMinutes,
      placeWalkMinutes,
      shuttleWalkMinutes,
      // Extra fields
      leaseAvailability: leaseAvailability ?? null,
      leaseStructure: leaseStructure ?? null,
      homeType: homeType ?? "apartment",
      amenities: amenities ?? [],
      utilitiesIncluded: utilitiesIncluded ?? false,
      subleaseFriendly: subleaseFriendly ?? false,
      furnished: furnished ?? false,
      moveInDate: moveInDate ?? null,
      contactEmail: contactEmail ?? null,
      contactPhone: contactPhone ?? null,
      contactName: contactName ?? null,
      minRent: minRent ?? null,
      maxRent: maxRent ?? null,
      minBedrooms: minBedrooms ?? null,
      maxBedrooms: maxBedrooms ?? null,
      minBathrooms: minBathrooms ?? null,
      maxBathrooms: maxBathrooms ?? null,
      minArea: minArea ?? null,
      maxArea: maxArea ?? null,
    });

    console.log("New listing created with ID:", newListing._id);

    if (ownerId) {
      const user = await User.findById(ownerId);
      user.listings.push(newListing._id);
      await user.save();
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
