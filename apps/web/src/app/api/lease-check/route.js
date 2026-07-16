/*
 * Lease Check API.
 *   POST — validate file metadata, create the lease_checks row, return presigned R2 PUT
 *          URLs so the browser uploads directly (Vercel caps request bodies at ~4.5MB;
 *          a scanned lease is 5-20MB, so the file never touches this function on upload).
 *   PUT  — fetch the uploaded objects from R2, run the Claude analysis, persist the
 *          results, and DELETE the objects in a finally block. The lease file itself is
 *          never stored: no address, rent, or landlord name is persisted either — only
 *          matched_listing_id points at public data.
 *   GET  — the signed-in user's past checks.
 */
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/lib/r2";
import supabase from "@/lib/supabase";
import { auth } from "@/auth";
import { isProdData } from "@/lib/appEnv";
import { analyzeLease, Anthropic, LEASE_MODEL } from "@/lib/leaseCheck/analyzeLease";
import { buildPropertyContext } from "@/lib/leaseCheck/propertyContext";
import { leaseCheckRateLimited } from "@/lib/leaseCheck/rateLimit";

// Analysis of a scanned lease takes 60-120s. Requires Fluid compute (300s cap on the
// current plan) — the legacy serverless mode would kill this at 60s.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);
// image/heic is accepted at presign so iPhone photos can be selected, but the client
// always canvas-converts images to JPEG before upload — Anthropic doesn't take HEIC.
const ANALYZABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_TOTAL_BYTES = 32 * 1024 * 1024; // Anthropic's request cap
const MAX_FILES = 25;
const MAX_PDF_PAGES = 100; // soft cost/latency cap, not an API limit

function getBucket() {
  // Mirrors upload/route.js: production site -> prod bucket; staging & local -> dev.
  return isProdData()
    ? process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME
    : process.env.R2_BUCKET_NAME;
}

function mediaTypeForKey(key) {
  const ext = key.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return null;
}

// Approximate PDF page count — counts page objects in the raw bytes. Good enough for
// the soft cap and the stored page_count; never used for anything correctness-critical.
function countPdfPages(buffer) {
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : null;
}

// POST /api/lease-check — body { files: [{ name, type, size }] }
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (leaseCheckRateLimited(session.user.id)) {
      return Response.json(
        { error: "That's a lot of leases. Try again in an hour." },
        { status: 429 }
      );
    }

    const { files } = await req.json();
    if (!Array.isArray(files) || files.length === 0) {
      return Response.json({ error: "No files provided" }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return Response.json({ error: `Max ${MAX_FILES} files` }, { status: 400 });
    }
    for (const f of files) {
      if (!f || typeof f.name !== "string" || !ALLOWED_TYPES.has(f.type)) {
        return Response.json({ error: "PDF or photos only" }, { status: 400 });
      }
      if (!Number.isFinite(f.size) || f.size <= 0) {
        return Response.json({ error: "Invalid file size" }, { status: 400 });
      }
    }
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return Response.json({ error: "Files exceed 32MB total" }, { status: 400 });
    }

    const hasPdf = files.some((f) => f.type === "application/pdf");
    const hasImage = files.some((f) => f.type !== "application/pdf");
    const fileType = hasPdf && hasImage ? "mixed" : hasPdf ? "pdf" : "images";

    const { data: row, error: insertError } = await supabase
      .from("lease_checks")
      .insert({
        user_id: session.user.id,
        file_name:
          files.length === 1
            ? files[0].name.slice(0, 200)
            : `${files.length} photos`,
        file_type: fileType,
      })
      .select("id")
      .single();
    if (insertError || !row) {
      console.error("[lease-check] insert failed:", insertError);
      return Response.json({ error: "Couldn't start the check" }, { status: 500 });
    }

    const bucket = getBucket();
    const presigned = await Promise.all(
      files.map(async ({ name, type }) => {
        const safeName = (name || "upload").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
        const key = `lease-checks/tmp/${row.id}/${crypto.randomUUID()}-${safeName}`;
        const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: type });
        const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 });
        return { uploadUrl, key };
      })
    );

    return Response.json({ leaseCheckId: row.id, presigned });
  } catch (error) {
    console.error("[lease-check] presign error:", error);
    return Response.json({ error: "Couldn't start the check" }, { status: 500 });
  }
}

// PUT /api/lease-check — body { leaseCheckId, keys }
export async function PUT(req) {
  const startedAt = Date.now();
  let bucket = null;
  let keys = [];
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const leaseCheckId = body?.leaseCheckId;
    keys = Array.isArray(body?.keys) ? body.keys : [];

    if (!leaseCheckId || keys.length === 0 || keys.length > MAX_FILES) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    // Never trust the client's leaseCheckId — the row must belong to this user.
    const { data: check } = await supabase
      .from("lease_checks")
      .select("id, summary")
      .eq("id", leaseCheckId)
      .eq("user_id", session.user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!check) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (check.summary != null) {
      return Response.json({ error: "Already analyzed" }, { status: 409 });
    }

    const prefix = `lease-checks/tmp/${leaseCheckId}/`;
    for (const key of keys) {
      if (typeof key !== "string" || !key.startsWith(prefix) || key.includes("..")) {
        return Response.json({ error: "Invalid key" }, { status: 400 });
      }
    }

    bucket = getBucket();

    // Fetch every uploaded object; delete them all in finally (error path included).
    const documents = [];
    let totalBytes = 0;
    let pageCount = 0;
    for (const key of keys) {
      const object = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = Buffer.from(await object.Body.transformToByteArray());
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return Response.json({ error: "Files exceed 32MB total" }, { status: 413 });
      }

      const mediaType = mediaTypeForKey(key);
      if (!mediaType || (mediaType !== "application/pdf" && !ANALYZABLE_IMAGE_TYPES.has(mediaType))) {
        return Response.json(
          { error: "That format didn't survive the trip. Try a PDF or JPEG." },
          { status: 415 }
        );
      }

      if (mediaType === "application/pdf") {
        const pages = countPdfPages(bytes);
        pageCount += pages ?? 0;
        if (pages != null && pageCount > MAX_PDF_PAGES) {
          return Response.json(
            { error: `That's a big lease. Keep it under ${MAX_PDF_PAGES} pages.` },
            { status: 413 }
          );
        }
        documents.push({ kind: "pdf", mediaType, data: bytes.toString("base64") });
      } else {
        pageCount += 1;
        documents.push({ kind: "image", mediaType, data: bytes.toString("base64") });
      }
    }

    const analysis = await analyzeLease({ leaseCheckId, documents });

    if (!analysis) {
      return Response.json(
        { error: "We couldn't read that one. Try a clearer scan or photos." },
        { status: 422 }
      );
    }

    // "Empty success" honesty check: no flags AND unreadable pages means we didn't
    // actually read the lease — say so instead of rendering a reassuring blank.
    if (analysis.flags.length === 0 && analysis.unreadablePages.length > 0) {
      return Response.json(
        { error: "We couldn't read enough of that lease to check it. Try clearer photos or a PDF." },
        { status: 422 }
      );
    }

    const context = await buildPropertyContext(analysis);

    // Persist results only. Deliberately NOT stored: the file, the address (a student's
    // home address), rent, landlord name — used within this request and discarded.
    const { error: updateError } = await supabase
      .from("lease_checks")
      .update({
        flags: analysis.flags,
        summary: analysis.summary,
        page_count: pageCount || null,
        unreadable_pages: analysis.unreadablePages,
        model: LEASE_MODEL,
        matched_listing_id: context.listing?.id ?? null,
        match_confidence: context.matchConfidence,
      })
      .eq("id", leaseCheckId)
      .eq("user_id", session.user.id);
    if (updateError) {
      console.error("[lease-check] persist failed:", updateError);
    }

    return Response.json({
      leaseCheckId,
      summary: analysis.summary,
      flags: analysis.flags,
      unreadablePages: analysis.unreadablePages,
      overallConfidence: analysis.overallConfidence,
      // In-request only, echoed to the uploader for the correction affordances — never stored.
      address: analysis.address,
      landlordName: analysis.landlordName,
      property: context,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "We're swamped. Try again in a minute." }, { status: 503 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[lease-check] Anthropic error:", err.status, err.message);
      return Response.json({ error: "Couldn't read that one. Try again?" }, { status: 502 });
    }
    console.error("[lease-check] analyze error:", err);
    return Response.json({ error: "Something broke. Try again." }, { status: 500 });
  } finally {
    // The lease never outlives the request — delete every object, error path included.
    // (Backstop: an R2 lifecycle rule expires lease-checks/tmp/ after 1 day.)
    if (bucket && keys.length > 0) {
      await Promise.allSettled(
        keys
          .filter((k) => typeof k === "string" && k.startsWith("lease-checks/tmp/"))
          .map((key) => r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })))
      );
    }
  }
}

// GET /api/lease-check — the user's past completed checks
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("lease_checks")
      .select("id, file_name, summary, flags, unreadable_pages, created_at")
      .eq("user_id", session.user.id)
      .is("deleted_at", null)
      .not("summary", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw error;

    return Response.json({
      checks: (data || []).map((row) => ({
        id: row.id,
        fileName: row.file_name,
        summary: row.summary,
        flags: row.flags,
        unreadablePages: row.unreadable_pages || [],
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("[lease-check] history error:", error);
    return Response.json({ error: "Couldn't load past checks" }, { status: 500 });
  }
}
