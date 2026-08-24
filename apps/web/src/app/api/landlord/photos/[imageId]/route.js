import { NextResponse } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { r2, getBucket, getPublicBaseUrl } from "@/lib/r2";
import { canDeletePhoto } from "@/lib/listings/ownership";

/*
 * Remove one photo.
 *
 * Landlords previously had no way to delete a photo at all — only the admin
 * route could, so a wrong upload stayed up until someone with super access
 * removed it. This is the landlord-facing counterpart, and it is scoped rather
 * than property-wide: whoever added a photo may take it down, and the property
 * owner may prune anything on their building. A landlord competing for the same
 * unit can never delete someone else's pictures (see canDeletePhoto).
 *
 * @auth user
 */

// Recover the R2 object key from a stored public URL, so the file goes with the
// row. Returns null when the URL isn't ours — then only the row is removed.
function keyFromUrl(url, db) {
  const base = getPublicBaseUrl(db);
  if (!base || !url) return null;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (!url.startsWith(prefix)) return null;
  const encoded = url.slice(prefix.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export async function DELETE(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { imageId } = await params;
  const db = new URL(req.url).searchParams.get("db") || null;

  const check = await canDeletePhoto(session.user.id, imageId);
  if (!check.ok) {
    if (check.reason === "not_found") {
      return NextResponse.json({ error: "That photo no longer exists." }, { status: 404 });
    }
    if (check.reason === "forbidden") {
      return NextResponse.json(
        { error: "You can only remove photos you added." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: "Could not remove that photo." }, { status: 500 });
  }

  /*
   * Storage first, then the row. A failed R2 delete is logged and not fatal —
   * an orphaned object costs a little storage, whereas leaving the row behind
   * would keep a deleted photo visible on the listing.
   */
  const key = keyFromUrl(check.image.url, db);
  if (key) {
    try {
      await r2.send(new DeleteObjectCommand({ Bucket: getBucket(db), Key: key }));
    } catch (err) {
      console.error("[landlord/photos] R2 delete failed (non-fatal):", err.message);
    }
  }

  const { error } = await supabase.from("listing_images").delete().eq("id", imageId);
  if (error) {
    console.error("[landlord/photos] Row delete failed:", error.message);
    return NextResponse.json({ error: "Could not remove that photo." }, { status: 500 });
  }

  return NextResponse.json({
    message: "Photo removed",
    listingId: check.image.listing_id,
    unitId: check.image.unit_id,
  });
}
