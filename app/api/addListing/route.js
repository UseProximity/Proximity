import { NextResponse } from "next/server";
import User from "@/models/User";
import Listing from "@/models/Listing";
import connectMongo from "@/libs/mongoose";
import { auth } from "@/auth";
import { WASHU_PLACES, CAMPUS, SHUTTLE_STOPS } from "@/utils/washuPlaces";

async function fetchWalkMinutes(lat, lng, destLat, destLng) {
  const token  = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const origin = `${lng},${lat}`;
  const dest   = `${destLng},${destLat}`;
  const url    = `https://api.mapbox.com/directions/v5/mapbox/walking/${origin};${dest}?access_token=${token}`;
  const res    = await fetch(url);
  const data   = await res.json();
  const seconds = data.routes?.[0]?.duration ?? null;
  return seconds != null ? Math.round(seconds / 60) : null;
}

async function fetchAllWalkTimes(latitude, longitude) {
  try {
    const campusWalkMinutes = await fetchWalkMinutes(latitude, longitude, CAMPUS.lat, CAMPUS.lng);

    const placeResults = await Promise.all(
      WASHU_PLACES.map(async (place) => {
        const minutes = await fetchWalkMinutes(latitude, longitude, place.lat, place.lng);
        return [place.name, minutes];
      })
    );
    const placeWalkMinutes = Object.fromEntries(placeResults.filter(([, m]) => m != null));

    const shuttleTimes = await Promise.all(
      SHUTTLE_STOPS.map((s) => fetchWalkMinutes(latitude, longitude, s.lat, s.lng))
    );
    const validShuttle = shuttleTimes.filter((m) => m != null);
    const shuttleWalkMinutes = validShuttle.length > 0 ? Math.min(...validShuttle) : null;

    return { campusWalkMinutes, placeWalkMinutes, shuttleWalkMinutes };
  } catch (err) {
    console.error("[walkTimes] Failed to fetch walk times:", err?.message);
    return { campusWalkMinutes: null, placeWalkMinutes: {}, shuttleWalkMinutes: null };
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
    } = body;

    console.log("Unit Types Received:", unitTypes);

    // Validate required fields
    if (
      !address?.trim() ||
      longitude === undefined ||
      latitude === undefined ||
      !description?.trim() ||
      !leaseType ||
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

    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ownerId = session?.user?.id;
    if (!ownerId) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    console.log("Authentication successful.");

    await connectMongo();

    // Calculate real walking times to campus + all WashU places + shuttle stops via Mapbox
    const { campusWalkMinutes, placeWalkMinutes, shuttleWalkMinutes } = await fetchAllWalkTimes(latitude, longitude);

    // Create New Listing
    const newListing = await Listing.create({
      address,
      longitude,
      latitude,
      description,
      unitTypes,
      leaseType,
      images: images || [],
      owner: ownerId,
      campusWalkMinutes,
      placeWalkMinutes,
      shuttleWalkMinutes,
    });

    console.log("New listing created with ID:", newListing._id);

    const user = await User.findById(ownerId);
    user.listings.push(newListing._id);
    await user.save();

    return NextResponse.json(
      { message: "Listing created successfully", listing: newListing },
      { status: 201 }
    );
  } catch (e) {
    console.error("Error:", e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
