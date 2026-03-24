import { NextResponse } from "next/server";
import User from "@/models/User";
import Listing from "@/models/Listing";
import connectMongo from "@/libs/mongoose";
import { auth } from "@/auth";
import { WASHU_PLACES, CAMPUS, SHUTTLE_STOPS } from "@/utils/washuPlaces";

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

    const shuttleTimes = await Promise.all(
      SHUTTLE_STOPS.map((s) =>
        fetchWalkMinutes(latitude, longitude, s.lat, s.lng)
      )
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

const toNumberOrUndefined = (value) => {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
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
      images,
      leaseStructure,
      leaseAvailability,
      moveInDate,
      homeType,
      amenities,
      furnished,
      utilitiesIncluded,
      subleaseFriendly,
      walkingDistanceToCampus,
      walkingDistanceToShuttle,
      minRent,
      maxRent,
      minBathrooms,
      maxBathrooms,
      minBedrooms,
      maxBedrooms,
      minArea,
      maxArea,
    } = body;

    const longitudeNum = Number(longitude);
    const latitudeNum = Number(latitude);

    console.log("Unit Types Received:", unitTypes);

    // Validate required fields
    if (
      !address?.trim() ||
      !Number.isFinite(longitudeNum) ||
      !Number.isFinite(latitudeNum) ||
      !description?.trim() ||
      !leaseStructure ||
      !Array.isArray(unitTypes) ||
      unitTypes.length === 0
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const invalidUnit = unitTypes.some(
      (unit) =>
        unit.bedrooms === undefined ||
        unit.bedrooms === null ||
        unit.bedrooms === "" ||
        unit.bathrooms === undefined ||
        unit.bathrooms === null ||
        unit.bathrooms === ""
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
    const { campusWalkMinutes, placeWalkMinutes, shuttleWalkMinutes } =
      await fetchAllWalkTimes(latitudeNum, longitudeNum);

    const normalizedUnitTypes = unitTypes.map((unit) => ({
      ...unit,
      rent: toNumberOrUndefined(unit.rent),
      area: toNumberOrUndefined(unit.area),
      bedrooms: toNumberOrUndefined(unit.bedrooms),
      bathrooms: toNumberOrUndefined(unit.bathrooms),
    }));

    const normalizedAmenities = Array.isArray(amenities) ? amenities : [];

    const calcRange = (values) => {
      if (!values.length) {
        return [undefined, undefined];
      }
      return [Math.min(...values), Math.max(...values)];
    };

    const rentValues = normalizedUnitTypes
      .map((unit) => unit.rent)
      .filter((value) => Number.isFinite(value));
    const areaValues = normalizedUnitTypes
      .map((unit) => unit.area)
      .filter((value) => Number.isFinite(value));
    const bedroomValues = normalizedUnitTypes
      .map((unit) => unit.bedrooms)
      .filter((value) => Number.isFinite(value));
    const bathroomValues = normalizedUnitTypes
      .map((unit) => unit.bathrooms)
      .filter((value) => Number.isFinite(value));

    const [minRentCalc, maxRentCalc] = calcRange(rentValues);
    const [minAreaCalc, maxAreaCalc] = calcRange(areaValues);
    const [minBedroomsCalc, maxBedroomsCalc] = calcRange(bedroomValues);
    const [minBathroomsCalc, maxBathroomsCalc] = calcRange(bathroomValues);

    const derivedCampusWalkMinutes =
      campusWalkMinutes ?? toNumberOrUndefined(walkingDistanceToCampus);
    const derivedShuttleWalkMinutes =
      shuttleWalkMinutes ?? toNumberOrUndefined(walkingDistanceToShuttle);

    // Create New Listing
    const newListing = await Listing.create({
      address: address.trim(),
      longitude: longitudeNum,
      latitude: latitudeNum,
      description: description.trim(),
      unitTypes: normalizedUnitTypes,
      leaseStructure,
      leaseAvailability: leaseAvailability || undefined,
      moveInDate: moveInDate || undefined,
      homeType: homeType || undefined,
      amenities: normalizedAmenities,
      furnished: furnished || undefined,
      utilitiesIncluded: !!utilitiesIncluded,
      subleaseFriendly: !!subleaseFriendly,
      walkingDistanceToCampus: derivedCampusWalkMinutes,
      walkingDistanceToShuttle: derivedShuttleWalkMinutes,
      minRent: minRentCalc ?? toNumberOrUndefined(minRent),
      maxRent: maxRentCalc ?? toNumberOrUndefined(maxRent),
      minBathrooms: minBathroomsCalc ?? toNumberOrUndefined(minBathrooms),
      maxBathrooms: maxBathroomsCalc ?? toNumberOrUndefined(maxBathrooms),
      minBedrooms: minBedroomsCalc ?? toNumberOrUndefined(minBedrooms),
      maxBedrooms: maxBedroomsCalc ?? toNumberOrUndefined(maxBedrooms),
      minArea: minAreaCalc ?? toNumberOrUndefined(minArea),
      maxArea: maxAreaCalc ?? toNumberOrUndefined(maxArea),
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
