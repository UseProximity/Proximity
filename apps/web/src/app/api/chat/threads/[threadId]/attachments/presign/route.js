/*
 * POST /api/chat/threads/[threadId]/attachments/presign
 * Validate file metadata, assert the caller is a participant, return short-lived
 * R2 PUT URLs. Files never pass through Vercel (body size limit).
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { r2 } from "@/lib/r2";
import supabase from "@/lib/supabase";
import { isProdData } from "@/lib/appEnv";
import {
  CHAT_ATTACHMENT_ALLOWED_TYPES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
  sanitizeChatAttachmentFileName,
} from "@/lib/chat/attachments";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getBucket() {
  return isProdData()
    ? process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME
    : process.env.R2_BUCKET_NAME;
}

export async function POST(req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { threadId } = await params;
    if (!UUID_RE.test(threadId ?? "")) {
      return NextResponse.json({ error: "threadId must be a valid UUID" }, { status: 400 });
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const files = payload?.files;
    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
    if (files.length > CHAT_ATTACHMENT_MAX_FILES) {
      return NextResponse.json(
        { error: `Max ${CHAT_ATTACHMENT_MAX_FILES} files` },
        { status: 400 }
      );
    }

    for (const f of files) {
      if (!f || typeof f.name !== "string" || !CHAT_ATTACHMENT_ALLOWED_TYPES.has(f.type)) {
        return NextResponse.json(
          { error: "Images (JPEG, PNG, WebP, GIF) and PDFs only" },
          { status: 400 }
        );
      }
      if (!Number.isFinite(f.size) || f.size <= 0) {
        return NextResponse.json({ error: "Invalid file size" }, { status: 400 });
      }
      if (f.size > CHAT_ATTACHMENT_MAX_BYTES) {
        return NextResponse.json(
          { error: "Each file must be 20MB or smaller" },
          { status: 400 }
        );
      }
    }

    const { data: participant, error: partError } = await supabase
      .from("chat_participants")
      .select("user_id")
      .eq("thread_id", threadId)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (partError) {
      console.error("POST attachments/presign participant check failed:", partError);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
    if (!participant) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: thread, error: threadError } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("id", threadId)
      .is("deleted_at", null)
      .maybeSingle();

    if (threadError) {
      console.error("POST attachments/presign thread check failed:", threadError);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
    if (!thread) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const bucket = getBucket();
    if (!bucket) {
      console.error("POST attachments/presign: R2 bucket env missing");
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    const presigned = await Promise.all(
      files.map(async ({ name, type, size }) => {
        const safeName = sanitizeChatAttachmentFileName(name);
        const key = `chat-attachments/${threadId}/${crypto.randomUUID()}-${safeName}`;
        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: type,
        });
        const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 });
        return {
          uploadUrl,
          key,
          fileName: (name || "upload").slice(0, 200),
          contentType: type,
          sizeBytes: size,
        };
      })
    );

    return NextResponse.json({ presigned });
  } catch (error) {
    console.error("POST /api/chat/threads/[threadId]/attachments/presign failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
