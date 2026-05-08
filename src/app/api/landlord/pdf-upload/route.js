import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/lib/r2";
import { auth } from "@/auth";

function getR2Config() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    bucket: isProd
      ? (process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME)
      : process.env.R2_BUCKET_NAME,
    publicBase: isProd
      ? (process.env.R2_PUBLIC_BASE_URL_prod || process.env.R2_PUBLIC_BASE_URL)
      : process.env.R2_PUBLIC_BASE_URL,
  };
}

// POST /api/landlord/pdf-upload
// Accepts multipart FormData with a single `file` (PDF).
// Does not require a listingId — used for lease template uploads before a listing exists.
// Returns { url: string }
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file.arrayBuffer !== "function")
      return Response.json({ error: "No file provided" }, { status: 400 });

    if (!file.type?.includes("pdf"))
      return Response.json({ error: "Only PDF files are accepted" }, { status: 400 });

    const maxBytes = 20 * 1024 * 1024; // 20 MB
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > maxBytes)
      return Response.json({ error: "PDF must be under 20 MB" }, { status: 400 });

    const { bucket, publicBase } = getR2Config();
    const safeName = (file.name || "lease.pdf").replace(/\s+/g, "-");
    const key = `lease-templates/raw/${session.user.id}/${crypto.randomUUID()}-${safeName}`;

    await r2.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(bytes),
      ContentType: "application/pdf",
    }));

    return Response.json({ url: `${publicBase}/${key}` });
  } catch (err) {
    console.error("[pdf-upload]", err.message);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
