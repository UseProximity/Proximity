import { NextResponse } from "next/server";
import User from "@/models/User";
import Listing from "@/models/Listing";
import connectMongo from "@/libs/mongoose";

export async function POST(req) {
  try {
    await connectMongo();

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
      ownerId,
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
      !leaseType ||
      !ownerId
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Make sure the owner exists
    const owner = await User.findById(ownerId);
    if (!owner) {
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
      owner: owner._id,
    });

    return NextResponse.json(
      { message: "Listing created successfully", listing: newListing },
      { status: 201 }
    );
  } catch (e) {
    console.error("Error:", e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
