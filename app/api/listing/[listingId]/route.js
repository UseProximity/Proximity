import { NextResponse } from "next/server";
import { auth } from "@/auth";
import connectMongo from "@/libs/mongoose";
import Listing from "@/models/Listing";

export async function GET(req, { params }) {
  try {
    await connectMongo();

    const { listingId } = await params;

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
      placeWalkMinutes: listing.placeWalkMinutes instanceof Map
        ? Object.fromEntries(listing.placeWalkMinutes)
        : (listing.placeWalkMinutes ?? {}),
      shuttleWalkMinutes: listing.shuttleWalkMinutes ?? null,
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

export async function PATCH(req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectMongo();

    const { listingId } = await params;
    if (!listingId) {
      return NextResponse.json(
        { error: "Missing listing ID" },
        { status: 400 }
      );
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (String(listing.owner) !== String(session.user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { unavailable } = await req.json();
    if (typeof unavailable !== "boolean") {
      return NextResponse.json(
        { error: "Invalid value for unavailable" },
        { status: 400 }
      );
    }

    listing.unavailable = unavailable;
    await listing.save();

    return NextResponse.json({ success: true, unavailable: listing.unavailable });
  } catch (error) {
    console.error("Error updating listing:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
