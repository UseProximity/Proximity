/*
 * GET /api/streetview/preview?address=&lat=&lng=
 *
 * Returns { available, url } for the add-listing form's live Street View preview, oriented
 * toward the building (see src/lib/streetview.js). `url` is the image itself as a data: URL.
 * The Static API URL carries GOOGLE_MAPS_SERVER_KEY, an unrestricted billing credential, so it
 * is fetched here and never sent to the browser. The image is NOT persisted here; it's only
 * stored in R2 on listing creation, when /api/addListing fetches it server-side.
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

  if (!shot.available || !shot.url) return NextResponse.json({ available: false, url: null });

  try {
    const img = await fetch(shot.url, { signal: AbortSignal.timeout(10_000) });
    const type = (img.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!img.ok || !type.startsWith("image/")) {
      return NextResponse.json({ available: false, url: null });
    }
    const bytes = Buffer.from(await img.arrayBuffer());
    return NextResponse.json({
      available: true,
      url: `data:${type};base64,${bytes.toString("base64")}`,
    });
  } catch (err) {
    console.error("[streetview/preview] image fetch failed:", err?.message);
    return NextResponse.json({ available: false, url: null });
  }
}
