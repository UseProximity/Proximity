// app/api/upload/route.js
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/libs/r2";
import Listing from "@/models/Listing";
import connectMongo from "@/libs/mongoose";
import { auth } from "@/auth";
import mongoose from "mongoose";

// Mirrors getModel() in app/api/admin/[table]/route.js exactly.
async function getListingModel(db) {
  if (!db || db === "default") {
    await connectMongo();
    return Listing;
  }

  const uri = db === "dev" ? process.env.MONGO_URI_DEV : process.env.MONGO_URI_PROD;
  if (!uri) {
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

export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const listingId = formData.get("listingId");
    const db = formData.get("db") || "dev";
    const bucket = db === "prod"
      ? (process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME)
      : process.env.R2_BUCKET_NAME;
    let files = formData.getAll("files");

    if (!listingId) {
      return Response.json({ error: "Missing listingId" }, { status: 400 });
    }
    if (!mongoose.Types.ObjectId.isValid(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }

    if (!files || files.length === 0) {
      const singleFile = formData.get("file");
      files = singleFile ? [singleFile] : [];
    }

    if (!files || files.length === 0) {
      return Response.json({ error: "No files" }, { status: 400 });
    }

    const ListingModel = await getListingModel(db);
    const listing = await ListingModel.findById(listingId);
    if (!listing) {
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    // Only the listing owner or a super user may upload
    const isOwner = listing.owner && String(listing.owner) === String(session.user.id);
    if (!isOwner) {
      if (session.user.role !== "super") {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const uploads = await Promise.all(
      files.map(async (file) => {
        if (!file || typeof file.arrayBuffer !== "function") {
          return null;
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const safeName = (file.name || "upload").replace(/\s+/g, "-");
        const key = `${listingId}/${crypto.randomUUID()}-${safeName}`;

        await r2.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: file.type,
          })
        );

        const publicBase = db === "prod"
          ? (process.env.R2_PUBLIC_BASE_URL_prod || process.env.R2_PUBLIC_BASE_URL)
          : process.env.R2_PUBLIC_BASE_URL;
        return `${publicBase}/${key}`;
      })
    );

    const urls = uploads.filter(Boolean);

    if (urls.length === 0) {
      return Response.json({ error: "No valid files" }, { status: 400 });
    }

    const updatedImages = listing.images.concat(urls);
    await ListingModel.findByIdAndUpdate(listingId, { $set: { images: updatedImages } }, { strict: false });

    return Response.json({ urls, url: urls[0] });
  } catch (error) {
    console.error("Upload error:", error);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}

// POST /api/upload — returns presigned PUT URLs for direct browser-to-R2 upload
// Body: { listingId, db, files: [{ name, type }] }
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { listingId, db, files } = await req.json();

    if (!listingId || !mongoose.Types.ObjectId.isValid(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }
    if (!Array.isArray(files) || files.length === 0) {
      return Response.json({ error: "No files provided" }, { status: 400 });
    }

    const ListingModel = await getListingModel(db);
    const listing = await ListingModel.findById(listingId);
    if (!listing) {
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    const isOwner = listing.owner && String(listing.owner) === String(session.user.id);
    if (!isOwner && session.user.role !== "super") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const bucket = db === "prod"
      ? (process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME)
      : process.env.R2_BUCKET_NAME;

    const publicBase = db === "prod"
      ? (process.env.R2_PUBLIC_BASE_URL_prod || process.env.R2_PUBLIC_BASE_URL)
      : process.env.R2_PUBLIC_BASE_URL;

    const presigned = await Promise.all(
      files.map(async ({ name, type }) => {
        const safeName = (name || "upload").replace(/\s+/g, "-");
        const key = `${listingId}/${crypto.randomUUID()}-${safeName}`;
        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: type,
        });
        const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 });
        const publicUrl = `${publicBase}/${key}`;
        return { uploadUrl, publicUrl, key };
      })
    );

    return Response.json({ presigned });
  } catch (error) {
    console.error("Presign error:", error);
    return Response.json({ error: "Failed to generate upload URLs" }, { status: 500 });
  }
}

// PUT /api/upload — records confirmed uploaded URLs to the listing
// Body: { listingId, db, urls: [string] }
export async function PUT(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { listingId, db, urls } = await req.json();

    if (!listingId || !mongoose.Types.ObjectId.isValid(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }
    if (!Array.isArray(urls) || urls.length === 0) {
      return Response.json({ error: "No URLs provided" }, { status: 400 });
    }

    const ListingModel = await getListingModel(db);
    const listing = await ListingModel.findById(listingId);
    if (!listing) {
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    const isOwner = listing.owner && String(listing.owner) === String(session.user.id);
    if (!isOwner && session.user.role !== "super") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const updatedImages = listing.images.concat(urls);
    await ListingModel.findByIdAndUpdate(listingId, { $set: { images: updatedImages } }, { strict: false });

    return Response.json({ urls });
  } catch (error) {
    console.error("Confirm upload error:", error);
    return Response.json({ error: "Failed to save image URLs" }, { status: 500 });
  }
}
