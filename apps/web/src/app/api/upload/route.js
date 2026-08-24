// app/api/upload/route.js
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/lib/r2";
import supabase from "@/lib/supabase";
import { auth } from "@/auth";
import {
  canManagePropertyPhotos,
  canAddUnitPhotos,
} from "@/lib/listings/ownership";
import { insertBatchAsUser } from "@/lib/supabaseWithUser";
import { isProdData } from "@/lib/appEnv";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

// When db is explicitly "prod", or when no db is given and we're on the real production
// site, use the prod bucket. Staging & local fall through to the dev bucket.
function isProdBucket(db) {
  if (db === "prod") return true;
  if (!db && isProdData()) return true;
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
/*
 * Resolve which SCOPE an upload is for and whether the caller may write there.
 *
 * unitId absent  -> a photo of the property; only its owner may add one.
 * unitId present -> a photo of that unit; anyone offering it may add one, as
 *                   may the property owner.
 *
 * The unit is also checked to belong to the listing being written to, so a
 * request cannot file a photo onto a unit at someone else's address. (The
 * database enforces the same thing, but a 403 here beats a 500 from the
 * trigger.)
 */
async function resolveUploadScope(session, listingId, unitId) {
  if (session.user.role === "super") return { ok: true, unitId: unitId ?? null };

  if (!unitId) {
    return (await canManagePropertyPhotos(session.user.id, listingId))
      ? { ok: true, unitId: null }
      : {
          ok: false,
          status: 403,
          error:
            "Only the property owner can add photos of the property itself. Add them to your unit instead.",
        };
  }

  const check = await canAddUnitPhotos(session.user.id, unitId);
  if (!check.ok) {
    return check.reason === "not_found"
      ? { ok: false, status: 404, error: "That unit no longer exists." }
      : { ok: false, status: 403, error: "You don't have a listing on that unit." };
  }
  if (check.listingId !== listingId) {
    return { ok: false, status: 400, error: "That unit isn't at this property." };
  }
  return { ok: true, unitId };
}

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
    const unitId = formData.get("unitId") || null;
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
      .select("id, address")
      .eq("id", listingId)
      .single();

    if (fetchError || !listing) {
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    const scope = await resolveUploadScope(session, listingId, unitId);
    if (!scope.ok) {
      return Response.json({ error: scope.error }, { status: scope.status });
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

    /*
     * Ordering is per SCOPE: the property's photos order among themselves and
     * each unit's among its own. Appending to a listing-wide sequence would let
     * one unit's uploads push the property's cover photo out of position 0.
     */
    const orderQuery = supabase
      .from("listing_images")
      .select("sort_order")
      .eq("listing_id", listingId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const { data: existingImages } = await (scope.unitId
      ? orderQuery.eq("unit_id", scope.unitId)
      : orderQuery.is("unit_id", null));
    const maxOrder = existingImages?.[0]?.sort_order ?? -1;
    const imageRows = urls.map((url, i) => ({
      listing_id: listingId,
      unit_id: scope.unitId,
      // Who added it — the record that decides who may take it down again.
      owner_id: session.user.id,
      url,
      sort_order: maxOrder + 1 + i,
    }));
    await insertBatchAsUser(supabase, {
      userId: session.user.id,
      table: "listing_images",
      rows: imageRows,
    });

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

    const { listingId, unitId = null, db, files } = await req.json();

    if (!listingId || !isValidId(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }
    if (!Array.isArray(files) || files.length === 0) {
      return Response.json({ error: "No files provided" }, { status: 400 });
    }

    const { data: listing, error: fetchError } = await supabase
      .from("listings")
      .select("id, address")
      .eq("id", listingId)
      .single();

    if (fetchError || !listing) {
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    const scope = await resolveUploadScope(session, listingId, unitId);
    if (!scope.ok) {
      return Response.json({ error: scope.error }, { status: scope.status });
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

    const { listingId, unitId = null, db, urls } = await req.json();

    if (!listingId || !isValidId(listingId)) {
      return Response.json({ error: "Invalid listingId" }, { status: 400 });
    }
    if (!Array.isArray(urls) || urls.length === 0) {
      return Response.json({ error: "No URLs provided" }, { status: 400 });
    }

    const { data: listing, error: fetchError } = await supabase
      .from("listings")
      .select("id")
      .eq("id", listingId)
      .single();

    if (fetchError || !listing) {
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    const scope = await resolveUploadScope(session, listingId, unitId);
    if (!scope.ok) {
      return Response.json({ error: scope.error }, { status: scope.status });
    }

    /*
     * Ordering is per SCOPE: the property's photos order among themselves and
     * each unit's among its own. Appending to a listing-wide sequence would let
     * one unit's uploads push the property's cover photo out of position 0.
     */
    const orderQuery = supabase
      .from("listing_images")
      .select("sort_order")
      .eq("listing_id", listingId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const { data: existingImages } = await (scope.unitId
      ? orderQuery.eq("unit_id", scope.unitId)
      : orderQuery.is("unit_id", null));
    const maxOrder = existingImages?.[0]?.sort_order ?? -1;
    const imageRows = urls.map((url, i) => ({
      listing_id: listingId,
      unit_id: scope.unitId,
      // Who added it — the record that decides who may take it down again.
      owner_id: session.user.id,
      url,
      sort_order: maxOrder + 1 + i,
    }));
    await insertBatchAsUser(supabase, {
      userId: session.user.id,
      table: "listing_images",
      rows: imageRows,
    });

    return Response.json({ urls });
  } catch (error) {
    console.error("Confirm upload error:", error);
    return Response.json({ error: "Failed to save image URLs" }, { status: 500 });
  }
}
