import { NextResponse } from "next/server";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";
import Listing from "@/models/Listing";

export async function GET() {
  try {
    const defaultUserId = "68877696221d6bb66c4c7c7d";
    await connectMongo();

    const defaultStudent = await User.findById(defaultUserId).lean();
    if (!defaultStudent) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const studentListings = await Listing.find({
      owner: defaultStudent._id,
    }).lean();

    // Convert non-serializable fields
    const safeStudent = {
      ...defaultStudent,
      _id: defaultStudent._id.toString(),
    };

    const safeListings = studentListings.map((listing) => ({
      ...listing,
      _id: listing._id.toString(),
      owner: listing.owner?.toString() || null,
      createdAt: listing.createdAt?.toISOString() || null,
      updatedAt: listing.updatedAt?.toISOString() || null,
    }));

    return NextResponse.json({
      student: safeStudent,
      listings: safeListings,
    });
  } catch (error) {
    console.error("Error fetching student dashboard data:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
