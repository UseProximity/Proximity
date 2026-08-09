export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchAssetResponse, DraftFetchError } from "@/lib/listingDraft/fetchSite";

/*
 * SSRF-guarded image proxy for the listing-draft import. The browser fetches
 * each photo Claude picked through here, turns it into a File, and stages it in
 * the normal photo uploader — so imported photos ride the existing
 * browser-to-R2 pipeline and the landlord can delete any of them pre-submit.
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      res.body?.cancel?.().catch?.(() => {});
      return NextResponse.json({ error: "Not an image" }, { status: 415 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }
    return new Response(buf, {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    if (err instanceof DraftFetchError) {
      return NextResponse.json({ error: "Couldn't fetch that image" }, { status: 422 });
    }
    console.error("[listing-draft/image] error:", err?.message);
    return NextResponse.json({ error: "Couldn't fetch that image" }, { status: 500 });
  }
}
