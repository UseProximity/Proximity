import { NextResponse } from "next/server";
import { auth } from "@/auth";
import connectMongo from "@/libs/mongoose";
import Listing from "@/models/Listing";
import { fetchAllWalkTimes } from "@/utils/walkTimes";

export async function POST() {
  try {
    const session = await auth();
    if (!session || session.user.role !== "super") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await connectMongo();

    const listings = await Listing.find({
      latitude:  { $exists: true, $ne: null },
      longitude: { $exists: true, $ne: null },
    }).select("_id latitude longitude");

    let updated = 0;
    let failed  = 0;

    for (const listing of listings) {
      try {
        const { latitude: lat, longitude: lng } = listing;
        const { placeWalkMinutes, shuttleWalkMinutes } = await fetchAllWalkTimes(lat, lng);
        await Listing.findByIdAndUpdate(listing._id, { $set: { placeWalkMinutes, shuttleWalkMinutes } });
        updated++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ updated, failed, total: listings.length });
  } catch (e) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
