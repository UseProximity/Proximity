// app/api/upload/route.js
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/libs/r2";
import Listing from "@/models/Listing";
import connectMongo from "@/libs/mongoose";

export async function PATCH(req) {
  try {
    const formData = await req.formData();
    const listingId = formData.get("listingId");
    let files = formData.getAll("files");

    if (!listingId) {
      return Response.json({ error: "Missing listingId" }, { status: 400 });
    }

    if (!files || files.length === 0) {
      const singleFile = formData.get("file");
      files = singleFile ? [singleFile] : [];
    }

    if (!files || files.length === 0) {
      return Response.json({ error: "No files" }, { status: 400 });
    }

    const uploads = await Promise.all(
      files.map(async (file) => {
        if (!file || typeof file.arrayBuffer !== "function") {
          return null;
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const safeName = (file.name || "upload").replace(/\s+/g, "-");
        const key = `${listingId}/${crypto.randomUUID()}-${safeName}`; // url path on r2 cloudflare

        await r2.send(
          new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: file.type,
          })
        );

        return `${process.env.R2_PUBLIC_BASE_URL}/${key}`;
      })
    );

    const urls = uploads.filter(Boolean);

    if (urls.length === 0) {
      return Response.json({ error: "No valid files" }, { status: 400 });
    }

    // update the listing with the new image URLs
    await connectMongo();
    const listing = await Listing.findById(listingId);

    if (!listing) {
      return Response.json({ error: "Listing not found" }, { status: 404 });
    }

    listing.images = listing.images.concat(urls);
    await listing.save();

    return Response.json({ urls, url: urls[0] });
  } catch (error) {
    console.error("Upload error:", error);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
