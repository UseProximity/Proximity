import { NextResponse } from "next/server";
import User from "@/models/User";
import Listing from "@/models/Listing";
import connectMongo from "@/libs/mongoose";
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
    }

    // Calculate real walking times to campus + all WashU places + shuttle stops via Mapbox
    let placeWalkMinutes = {};
    let shuttleWalkMinutes = null;
    try {
      ({ placeWalkMinutes, shuttleWalkMinutes } = await fetchAllWalkTimes(resolvedLat, resolvedLng));
    } catch (err) {
      console.error("[walkTimes] Failed to fetch walk times:", err?.message);
    }

    // Create New Listing
    const autoTitle = address.split(",")[0].trim();
    const newListing = await Listing.create({
      title: autoTitle,
      address,
      longitude: resolvedLng,
      latitude: resolvedLat,
      description,
      unitTypes,
      leaseType: leaseType || "standard",
      images: images || [],
      owner: ownerId || undefined,
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
