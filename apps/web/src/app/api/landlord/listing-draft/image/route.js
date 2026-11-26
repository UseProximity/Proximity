export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchAssetResponse,
  readAssetCapped,
  DraftFetchError,
} from "@/lib/listingDraft/fetchSite";

/*
 * SSRF-guarded image proxy for the listing-draft import. The browser fetches
 * each photo Claude picked through here, turns it into a File, and stages it in
 * the normal photo uploader — so imported photos ride the existing
 * browser-to-R2 pipeline and the landlord can delete any of them pre-submit.
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/*
 * Raster types only, and the outgoing Content-Type is always one of these exact
 * strings, never the remote server's header. This response is served from our
 * own origin, so an image/svg+xml body opened as a page would run its scripts
 * as useproximity.org with the viewer's session. SVG is never accepted.
 */
const RASTER_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["landlord", "super"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  try {
    const res = await fetchAssetResponse(url);
    const declared = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const type = RASTER_TYPES.find((t) => t === declared || (t === "image/jpeg" && declared === "image/jpg"));
    if (!type) {
      res.body?.cancel?.().catch?.(() => {});
      return NextResponse.json({ error: "Not an image" }, { status: 415 });
    }
    // Stream with the cap applied as we read. Buffering the whole body first
    // and checking the length afterwards let an arbitrarily large remote image
    // through the memory it was supposed to protect.
    const buf = await readAssetCapped(res, MAX_IMAGE_BYTES);
    if (buf === null) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }
    return new Response(buf, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=300",
        // Belt and braces: opened directly, this downloads rather than renders,
        // and nothing in it could run even if a browser did render it. The
        // wizard reads it with fetch(), which none of these affect.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "attachment",
      },
    });
  } catch (err) {
    if (err instanceof DraftFetchError) {
      return NextResponse.json({ error: "Couldn't fetch that image" }, { status: 422 });
    }
    console.error("[listing-draft/image] error:", err?.message);
    return NextResponse.json({ error: "Couldn't fetch that image" }, { status: 500 });
  }
}
