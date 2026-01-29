import { NextResponse } from "next/server";
import User from "@/models/User";
import Listing from "@/models/Listing";
import connectMongo from "@/libs/mongoose";
import { auth } from "@/auth";

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
    // Make sure the owner exists
    if (!ownerId) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    console.log("Authentication successful.");

    await connectMongo();

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
