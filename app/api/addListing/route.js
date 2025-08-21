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
      rent,
      area,
      bedrooms,
      bathrooms,
      leaseType,
      images,
    } = body;

    // Validate required fields
    if (
      !address ||
      longitude === undefined ||
      latitude === undefined ||
      !description ||
      !rent ||
      !area ||
      bedrooms === undefined ||
      bathrooms === undefined ||
      !leaseType
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ownerId = session?.user?.id;

    await connectMongo();

    // Make sure the owner exists
    if (!ownerId) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    // Create New Listing
    const newListing = await Listing.create({
      address,
      longitude,
      latitude,
      description,
      rent,
      area,
      bedrooms,
      bathrooms,
      leaseType,
      images: images || [],
      owner: ownerId,
    });

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
