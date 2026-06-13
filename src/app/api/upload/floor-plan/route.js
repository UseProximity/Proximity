// POST /api/upload/floor-plan — uploads a single floor-plan image/PDF to R2 and
// returns its public URL. Unlike /api/upload, this is NOT tied to a listing (so it
// works in the "Add Listing" flow before a listing exists) and does NOT insert into
// listing_images — the URL is stored inline on listing_units.floor_plan_image_url.
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/lib/r2";
import { auth } from "@/auth";

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

const ALLOWED = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "application/pdf",
]);

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!["landlord", "super"].includes(session.user.role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const db = formData.get("db") || null;

    if (!file || typeof file.arrayBuffer !== "function") {
      return Response.json({ error: "No file" }, { status: 400 });
    }
    if (file.type && !ALLOWED.has(file.type)) {
      return Response.json({ error: "Unsupported file type" }, { status: 400 });
    }

    const bucket = getBucket(db);
    const publicBase = getPublicBase(db);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const safeName = (file.name || "floor-plan").replace(/\s+/g, "-");
    const key = `floor-plans/${crypto.randomUUID()}-${safeName}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: file.type || "application/octet-stream",
      })
    );

    return Response.json({ url: `${publicBase}/${key}` });
  } catch (error) {
    console.error("Floor-plan upload error:", error);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
