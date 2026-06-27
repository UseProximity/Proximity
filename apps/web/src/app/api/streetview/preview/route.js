/*
 * GET /api/streetview/preview?address=&lat=&lng=
 *
 * Returns { available, url } for the add-listing form's live Street View preview. `url` is a
 * live Google Static API image URL oriented toward the building (see src/lib/streetview.js).
 * The image is NOT persisted here — it's only stored in R2 on listing creation, when
 * /api/addListing fetches it server-side.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStreetViewShot } from "@/lib/streetview";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  const shot = await getStreetViewShot({
    address,
    lat: lat != null ? Number(lat) : null,
    lng: lng != null ? Number(lng) : null,
  });

  return NextResponse.json({ available: shot.available, url: shot.url ?? null });
}
