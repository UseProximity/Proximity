// app/api/admin/listing-images/route.js
import { DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/libs/r2";
import { getSupabaseClient } from "@/libs/supabase";
import { auth } from "@/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

function isProdBucket(db) {
  if (db === "prod") return true;
  if (!db && process.env.NODE_ENV === "production") return true;
  return false;
}

function getBucket(db) {
  return isProdBucket(db)
    ? (process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME)
    : process.env.R2_BUCKET_NAME;
}

function getPublicBaseUrl(db) {
  return isProdBucket(db)
    ? (process.env.R2_PUBLIC_BASE_URL_prod || process.env.R2_PUBLIC_BASE_URL)
    : process.env.R2_PUBLIC_BASE_URL;
}

function getKeyFromUrl(url, db) {
  const base = getPublicBaseUrl(db);
  if (!base || !url) return null;
  const prefix = base.endsWith("/") ? base : base + "/";
  if (!url.startsWith(prefix)) return null;
  const encodedKey = url.slice(prefix.length);
  try {
    return decodeURIComponent(encodedKey);
  } catch {
    return encodedKey;
  }
}

function buildPublicUrl(key, db) {
  const base = getPublicBaseUrl(db).replace(/\/$/, "");
  return `${base}/${key}`;
}

export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "super") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { listingId, db } = body;
    const headerTarget = req.headers.get("x-db-target");
    const dbTarget = (db === "prod" || db === "dev") ? db : (headerTarget === "prod" || headerTarget === "dev") ? headerTarget : undefined;
    const supabase = getSupabaseClient(dbTarget);
    console.log("[listing-images PATCH] listingId:", listingId, "db:", db, "bodyKeys:", Object.keys(body));

    if (!listingId) {
      return Response.json({ error: "Missing listingId" }, { status: 400 });
    }
    if (!isValidId(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }

    const { data: listing, error: fetchError } = await supabase
      .from("listings")
      .select("id")
      .eq("id", listingId)
      .single();

    if (fetchError || !listing) {
      console.log("[listing-images PATCH] listing not found:", listingId);
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    // Rename — checked before reorder so { images:[], oldUrl, newFilename } can't wipe images
    if (body.oldUrl && body.newFilename) {
      const oldKey = getKeyFromUrl(body.oldUrl, db);
      console.log("[listing-images PATCH] rename oldKey:", oldKey);
      if (!oldKey) {
        return Response.json({ error: "Invalid image URL" }, { status: 400 });
      }
      const dir = oldKey.split("/").slice(0, -1).join("/");
      const safeName = body.newFilename.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
      const newKey = dir ? `${dir}/${crypto.randomUUID()}-${safeName}` : `${crypto.randomUUID()}-${safeName}`;
      const bucket = getBucket(db);
      const encodedOldKey = oldKey.split("/").map(encodeURIComponent).join("/");

      await r2.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${encodedOldKey}`,
          Key: newKey,
        })
      );
      await r2.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: oldKey,
        })
      );

      const newUrl = buildPublicUrl(newKey, db);
      // Update the listing_images row with the old URL to use the new URL
      await supabase
        .from("listing_images")
        .update({ url: newUrl })
        .eq("listing_id", listingId)
        .eq("url", body.oldUrl);
      console.log("[listing-images PATCH] rename done:", newUrl);
      return Response.json({ newUrl });
    }

    // Reorder — body.images is an array of URLs in new order
    if (Array.isArray(body.images)) {
      console.log("[listing-images PATCH] reorder count:", body.images.length);
      const updates = body.images.map((url, i) =>
        supabase
          .from("listing_images")
          .update({ sort_order: i })
          .eq("listing_id", listingId)
          .eq("url", url)
      );
      await Promise.all(updates);
      return Response.json({ images: body.images });
    }

    return Response.json({ error: "Invalid request body" }, { status: 400 });
  } catch (error) {
    console.error("[listing-images PATCH] error:", error);
    return Response.json({ error: "Request failed" }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "super") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { listingId, imageUrl, db } = body;
    const headerTarget = req.headers.get("x-db-target");
    const dbTarget = (db === "prod" || db === "dev") ? db : (headerTarget === "prod" || headerTarget === "dev") ? headerTarget : undefined;
    const supabase = getSupabaseClient(dbTarget);
    console.log("[listing-images DELETE] listingId:", listingId, "db:", db);

    if (!listingId || !imageUrl) {
      return Response.json({ error: "Missing listingId or imageUrl" }, { status: 400 });
    }
    if (!isValidId(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }

    const { data: listing, error: fetchError } = await supabase
      .from("listings")
      .select("id")
      .eq("id", listingId)
      .single();

    if (fetchError || !listing) {
      console.log("[listing-images DELETE] listing not found:", listingId);
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    const key = getKeyFromUrl(imageUrl, db);
    console.log("[listing-images DELETE] R2 key:", key);
    if (key) {
      try {
        await r2.send(
          new DeleteObjectCommand({
            Bucket: getBucket(db),
            Key: key,
          })
        );
        console.log("[listing-images DELETE] R2 delete ok");
      } catch (r2Err) {
        console.error("[listing-images DELETE] R2 delete error (non-fatal):", r2Err.message);
      }
    } else {
      console.log("[listing-images DELETE] could not resolve R2 key, skipping R2 delete");
    }

    // Delete the row from listing_images
    await supabase
      .from("listing_images")
      .delete()
      .eq("listing_id", listingId)
      .eq("url", imageUrl);

    // Fetch remaining images ordered by sort_order
    const { data: remaining } = await supabase
      .from("listing_images")
      .select("url")
      .eq("listing_id", listingId)
      .order("sort_order");

    const remainingUrls = (remaining ?? []).map((r) => r.url);
    console.log("[listing-images DELETE] done, remaining:", remainingUrls.length);
    return Response.json({ images: remainingUrls });
  } catch (error) {
    console.error("[listing-images DELETE] error:", error);
    return Response.json({ error: "Request failed" }, { status: 500 });
  }
}
