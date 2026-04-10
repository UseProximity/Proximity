// app/api/upload/route.js
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/libs/r2";
import supabase from "@/libs/supabase";
import { auth } from "@/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

// When db is explicitly "prod", or when no db is given and we're in production, use the prod bucket.
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

function getPublicBase(db) {
  return isProdBucket(db)
    ? (process.env.R2_PUBLIC_BASE_URL_prod || process.env.R2_PUBLIC_BASE_URL)
    : process.env.R2_PUBLIC_BASE_URL;
}

// "1173 Moorlands Dr, St. Louis, MO 63117" → "1173-moorlands"
// Takes the first two whitespace-tokens from the street part (before first comma),
// lowercases them, strips non-alphanumeric chars, joins with a dash.
function addressToFolderSlug(address) {
  const street = (address || "").split(",")[0].trim();
  const tokens = street.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens
    .slice(0, 2)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .join("-");
}

export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const listingId = formData.get("listingId");
    const db = formData.get("db") || null;
    let files = formData.getAll("files");

    if (!listingId) {
      return Response.json({ error: "Missing listingId" }, { status: 400 });
    }
    if (!isValidId(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }

    if (!files || files.length === 0) {
      const singleFile = formData.get("file");
      files = singleFile ? [singleFile] : [];
    }

    if (!files || files.length === 0) {
      return Response.json({ error: "No files" }, { status: 400 });
    }

    const { data: listing, error: fetchError } = await supabase
      .from("listings")
      .select("id, landlord_id, address, images")
      .eq("id", listingId)
      .single();

    if (fetchError || !listing) {
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    const isOwner = (listing.landlord_id ?? []).includes(session.user.id);
    if (!isOwner && session.user.role !== "super") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const bucket = getBucket(db);
    const publicBase = getPublicBase(db);
    const folder = addressToFolderSlug(listing.address);

    const uploads = await Promise.all(
      files.map(async (file) => {
        if (!file || typeof file.arrayBuffer !== "function") return null;
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const safeName = (file.name || "upload").replace(/\s+/g, "-");
        const key = `${folder}/${crypto.randomUUID()}-${safeName}`;
        await r2.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: file.type,
          })
        );
        return `${publicBase}/${key}`;
      })
    );

    const urls = uploads.filter(Boolean);
    if (urls.length === 0) {
      return Response.json({ error: "No valid files" }, { status: 400 });
    }

    const updatedImages = (listing.images || []).concat(urls);
    await supabase.from("listings").update({ images: updatedImages }).eq("id", listingId);

    return Response.json({ urls, url: urls[0] });
  } catch (error) {
    console.error("Upload error:", error);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}

// POST /api/upload — returns presigned PUT URLs for direct browser-to-R2 upload
// Body: { listingId, db?, files: [{ name, type }] }
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { listingId, db, files } = await req.json();

    if (!listingId || !isValidId(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }
    if (!Array.isArray(files) || files.length === 0) {
      return Response.json({ error: "No files provided" }, { status: 400 });
    }

    const { data: listing, error: fetchError } = await supabase
      .from("listings")
      .select("id, landlord_id, address")
      .eq("id", listingId)
      .single();

    if (fetchError || !listing) {
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    const isOwner = (listing.landlord_id ?? []).includes(session.user.id);
    if (!isOwner && session.user.role !== "super") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const bucket = getBucket(db);
    const publicBase = getPublicBase(db);
    const folder = addressToFolderSlug(listing.address);

    const presigned = await Promise.all(
      files.map(async ({ name, type }) => {
        const safeName = (name || "upload").replace(/\s+/g, "-");
        const key = `${folder}/${crypto.randomUUID()}-${safeName}`;
        const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: type });
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
// Body: { listingId, db?, urls: [string] }
export async function PUT(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { listingId, db, urls } = await req.json();

    if (!listingId || !isValidId(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }
    if (!Array.isArray(urls) || urls.length === 0) {
      return Response.json({ error: "No URLs provided" }, { status: 400 });
    }

    const { data: listing, error: fetchError } = await supabase
      .from("listings")
      .select("id, landlord_id, images")
      .eq("id", listingId)
      .single();

    if (fetchError || !listing) {
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    const isOwner = (listing.landlord_id ?? []).includes(session.user.id);
    if (!isOwner && session.user.role !== "super") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const updatedImages = (listing.images || []).concat(urls);
    await supabase.from("listings").update({ images: updatedImages }).eq("id", listingId);

    return Response.json({ urls });
  } catch (error) {
    console.error("Confirm upload error:", error);
    return Response.json({ error: "Failed to save image URLs" }, { status: 500 });
  }
}
