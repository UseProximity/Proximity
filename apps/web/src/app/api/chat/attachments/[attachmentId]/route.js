/*
 * GET /api/chat/attachments/[attachmentId]
 * Participant-gated stream of a chat attachment from R2.
 * ?download=1 forces Content-Disposition: attachment.
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { r2 } from "@/lib/r2";
import supabase from "@/lib/supabase";
import { isProdData } from "@/lib/appEnv";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_PARTICIPANT_ERROR = "not a participant in this conversation";
const ATTACHMENT_NOT_FOUND = "attachment not found";

function getBucket() {
  return isProdData()
    ? process.env.R2_BUCKET_NAME_PROD || process.env.R2_BUCKET_NAME
    : process.env.R2_BUCKET_NAME;
}

function contentDisposition(fileName, asDownload) {
  const safe = String(fileName || "file")
    .replace(/[\r\n"]/g, "_")
    .slice(0, 200);
  const type = asDownload ? "attachment" : "inline";
  return `${type}; filename="${safe}"`;
}

export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { attachmentId } = await params;
    if (!UUID_RE.test(attachmentId ?? "")) {
      return NextResponse.json(
        { error: "attachmentId must be a valid UUID" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("rpc_get_chat_attachment", {
      p_user_id: session.user.id,
      p_attachment_id: attachmentId,
    });

    if (error) {
      if (error.message === NOT_PARTICIPANT_ERROR) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (error.message === ATTACHMENT_NOT_FOUND) {
        return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
      }
      console.error("GET /api/chat/attachments/[id] rpc failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    const r2Key = data?.r2Key;
    if (!r2Key) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const bucket = getBucket();
    if (!bucket) {
      console.error("GET chat attachment: R2 bucket env missing");
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    const object = await r2.send(
      new GetObjectCommand({ Bucket: bucket, Key: r2Key })
    );

    const asDownload = new URL(req.url).searchParams.get("download") === "1";
    const contentType =
      data.contentType || object.ContentType || "application/octet-stream";

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set(
      "Content-Disposition",
      contentDisposition(data.fileName, asDownload)
    );
    headers.set("Cache-Control", "private, max-age=300");
    if (object.ContentLength != null) {
      headers.set("Content-Length", String(object.ContentLength));
    }

    // AWS SDK v3 Body supports transformToWebStream in Node 18+ / edge runtimes.
    const stream =
      typeof object.Body?.transformToWebStream === "function"
        ? object.Body.transformToWebStream()
        : object.Body;

    return new Response(stream, { status: 200, headers });
  } catch (error) {
    console.error("GET /api/chat/attachments/[attachmentId] failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
