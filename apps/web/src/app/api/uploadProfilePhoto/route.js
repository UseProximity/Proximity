import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/lib/r2";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const safeName = (file.name || "photo").replace(/\s+/g, "-");
    const key = `profiles/${session.user.id}/${crypto.randomUUID()}-${safeName}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: file.type,
      })
    );

    const url = `${process.env.R2_PUBLIC_BASE_URL}/${key}`;

    const { error } = await supabase
      .from("users")
      .update({ image: url })
      .eq("id", session.user.id);

    if (error) {
      console.error("Profile photo update error:", error);
      return NextResponse.json({ error: "Failed to update profile image" }, { status: 500 });
    }

    return NextResponse.json({ url });
  } catch (err) {
    console.error("Profile photo upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
