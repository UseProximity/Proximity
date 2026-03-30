// app/api/admin/listing-images/route.js
import { DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/libs/r2";
import Listing from "@/models/Listing";
import connectMongo from "@/libs/mongoose";
import { auth } from "@/auth";
import mongoose from "mongoose";

// Mirrors getModel() in app/api/admin/[table]/route.js exactly.
// dev  → MONGO_URI_DEV  (via cached connection)
// prod → MONGO_URI_PROD (via cached connection)
// default/missing → connectMongo() (MONGO_URI)
async function getListingModel(db) {
  if (!db || db === "default") {
    await connectMongo();
    return Listing;
  }

  const uri = db === "dev" ? process.env.MONGO_URI_DEV : process.env.MONGO_URI_PROD;
  if (!uri) {
    // Fall back to default connection if the env var isn't set
    await connectMongo();
    return Listing;
  }

  const cacheKey = `_mongooseAdmin_${db}`;
  if (!global[cacheKey] || global[cacheKey].readyState === 0) {
    global[cacheKey] = mongoose.createConnection(uri, {
      bufferCommands: false,
      maxPoolSize: 5,
    });
    await global[cacheKey].asPromise();
  }
  const conn = global[cacheKey];
  return conn.models["Listing"] || conn.model("Listing", Listing.schema);
}

// Returns the R2 bucket name for the given db.
// Env vars: R2_BUCKET_NAME (dev), R2_BUCKET_NAME_PROD (prod)
function getBucket(db) {
  return db === "prod"
    ? (process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME)
    : process.env.R2_BUCKET_NAME;
}

// Returns the R2 public base URL for the given db.
// Env vars: R2_PUBLIC_BASE_URL (dev), R2_PUBLIC_BASE_URL_prod (prod)
function getPublicBaseUrl(db) {
  return db === "prod"
    ? (process.env.R2_PUBLIC_BASE_URL_prod || process.env.R2_PUBLIC_BASE_URL)
    : process.env.R2_PUBLIC_BASE_URL;
}

// Extract the R2 object key from a stored public URL using the db-appropriate base URL.
// sync-r2-images.mjs URL-encodes filenames per-segment, so decode the key.
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
    console.log("[listing-images PATCH] listingId:", listingId, "db:", db, "bodyKeys:", Object.keys(body));

    if (!listingId) {
      return Response.json({ error: "Missing listingId" }, { status: 400 });
    }
    if (!mongoose.Types.ObjectId.isValid(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }

    const ListingModel = await getListingModel(db);
    const listing = await ListingModel.findById(listingId);
    if (!listing) {
      console.log("[listing-images PATCH] listing not found in db:", db);
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
      const renamedImages = listing.images.map((u) => (u === body.oldUrl ? newUrl : u));
      await ListingModel.findByIdAndUpdate(listingId, { $set: { images: renamedImages } }, { strict: false });
      console.log("[listing-images PATCH] rename done:", newUrl);
      return Response.json({ newUrl });
    }

    // Reorder
    if (Array.isArray(body.images)) {
      console.log("[listing-images PATCH] reorder count:", body.images.length);
      await ListingModel.findByIdAndUpdate(listingId, { $set: { images: body.images } }, { strict: false });
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
    console.log("[listing-images DELETE] listingId:", listingId, "db:", db);

    if (!listingId || !imageUrl) {
      return Response.json({ error: "Missing listingId or imageUrl" }, { status: 400 });
    }
    if (!mongoose.Types.ObjectId.isValid(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }

    const ListingModel = await getListingModel(db);
    const listing = await ListingModel.findById(listingId);
    if (!listing) {
      console.log("[listing-images DELETE] listing not found in db:", db);
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

    const remainingImages = listing.images.filter((u) => u !== imageUrl);
    await ListingModel.findByIdAndUpdate(listingId, { $set: { images: remainingImages } }, { strict: false });
    console.log("[listing-images DELETE] done, remaining:", remainingImages.length);
    return Response.json({ images: remainingImages });
  } catch (error) {
    console.error("[listing-images DELETE] error:", error);
    return Response.json({ error: "Request failed" }, { status: 500 });
  }
}
