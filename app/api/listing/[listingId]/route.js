import { NextResponse } from "next/server";
import connectMongo from "@/libs/mongoose";
import Listing from "@/models/Listing";

export async function GET(req, { params }) {
  try {
    await connectMongo();

    const { listingId } = params;

    if (!listingId) {
      return NextResponse.json(
        { error: "Missing listing ID" },
        { status: 400 }
      );
    }

    const listing = await Listing.findById(listingId)
      .populate("owner")
      .populate({
        path: "reviews",
        populate: {
          path: "reviewer",
          select: "name image", // only fetch these 2 fields for speed
        },
      })
      .lean();

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // Convert non-serializable fields
    const safeListing = {
      ...listing,
      _id: listing._id.toString(),
      owner: listing.owner
        ? {
            ...listing.owner,
            _id: listing.owner._id.toString(),
          }
        : null,
      createdAt: listing.createdAt?.toISOString() || null,
    };

    return NextResponse.json(safeListing);
  } catch (error) {
    console.error("Error fetching listing:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
