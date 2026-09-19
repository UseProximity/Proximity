import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { notifyNewChatMessage } from "@/lib/chat/notifyEmail";
import {
  CHAT_ATTACHMENT_ALLOWED_TYPES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
} from "@/lib/chat/attachments";

// Surfaced to the client as-is; everything else becomes a generic 500.
const SAFE_SEND_MESSAGE_ERRORS = new Set([
  "message body is required",
  "message body exceeds the 5000 character limit",
  "attachments are required",
  "too many attachments (max 5)",
  "invalid attachment metadata",
  "invalid attachment key",
  "unsupported attachment type",
  "attachment exceeds size limit",
  "invalid attachment size",
  "file name too long",
]);

// A non-participant must not learn whether the thread exists, so this maps to 403.
const NOT_PARTICIPANT_ERROR = "not a participant in this conversation";
const THREAD_NOT_FOUND_ERROR = "conversation not found";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapChatRpcError(error) {
  if (error.message === NOT_PARTICIPANT_ERROR) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (error.message === THREAD_NOT_FOUND_ERROR) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (SAFE_SEND_MESSAGE_ERRORS.has(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

function normalizeAttachments(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > CHAT_ATTACHMENT_MAX_FILES) {
    return { error: `Max ${CHAT_ATTACHMENT_MAX_FILES} files` };
  }
  const attachments = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { error: "Invalid attachment metadata" };
    }
    const key = typeof item.key === "string" ? item.key.trim() : "";
    const fileName =
      typeof item.fileName === "string"
        ? item.fileName.trim()
        : typeof item.name === "string"
          ? item.name.trim()
          : "";
    const contentType =
      typeof item.contentType === "string"
        ? item.contentType.trim()
        : typeof item.type === "string"
          ? item.type.trim()
          : "";
    const sizeBytes = Number(item.sizeBytes ?? item.size);
    if (!key || !fileName || !contentType) {
      return { error: "Invalid attachment metadata" };
    }
    if (!CHAT_ATTACHMENT_ALLOWED_TYPES.has(contentType)) {
      return { error: "Images (JPEG, PNG, WebP, GIF) and PDFs only" };
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > CHAT_ATTACHMENT_MAX_BYTES) {
      return { error: "Each file must be 20MB or smaller" };
    }
    attachments.push({
      key,
      fileName: fileName.slice(0, 200),
      contentType,
      sizeBytes: Math.floor(sizeBytes),
    });
  }
  return { attachments };
}

// GET /api/chat/threads/[threadId]/messages — paginated history for a participant
export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { threadId } = await params;
    if (!UUID_RE.test(threadId ?? "")) {
      return NextResponse.json({ error: "threadId must be a valid UUID" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const rpcArgs = { p_user_id: session.user.id, p_thread_id: threadId };

    const limitParam = searchParams.get("limit");
    if (limitParam !== null) {
      const limit = Number(limitParam);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return NextResponse.json(
          { error: "limit must be an integer between 1 and 100" },
          { status: 400 }
        );
      }
      rpcArgs.p_limit = limit;
    }

    const beforeParam = searchParams.get("before");
    if (beforeParam !== null) {
      if (Number.isNaN(Date.parse(beforeParam))) {
        return NextResponse.json(
          { error: "before must be a valid ISO timestamp" },
          { status: 400 }
        );
      }
      rpcArgs.p_before = beforeParam;
    }

    const { data, error } = await supabase.rpc("rpc_get_chat_messages", rpcArgs);

    if (error) {
      console.error("GET /api/chat/threads/[threadId]/messages failed:", error);
      return mapChatRpcError(error);
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("GET /api/chat/threads/[threadId]/messages failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/chat/threads/[threadId]/messages — reply (text and/or attachments)
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

    const rawBody = payload?.body;
    const bodyText = typeof rawBody === "string" ? rawBody.trim() : "";
    const normalized = normalizeAttachments(payload?.attachments);

    if (normalized?.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const hasAttachments = Array.isArray(normalized?.attachments);

    if (!hasAttachments) {
      if (!bodyText) {
        return NextResponse.json({ error: "Message body required" }, { status: 400 });
      }
      if (bodyText.length > 5000) {
        return NextResponse.json(
          { error: "Message body exceeds the 5000 character limit" },
          { status: 400 }
        );
      }

      const { data, error } = await supabase.rpc("rpc_send_chat_message", {
        p_user_id: session.user.id,
        p_thread_id: threadId,
        p_body: bodyText,
      });

      if (error) {
        console.error("POST /api/chat/threads/[threadId]/messages failed:", error);
        return mapChatRpcError(error);
      }

      const baseUrl = getBaseUrl(req);
      after(() =>
        notifyNewChatMessage({
          threadId,
          senderId: session.user.id,
          baseUrl,
        })
      );

      return NextResponse.json(data);
    }

    if (bodyText.length > 5000) {
      return NextResponse.json(
        { error: "Message body exceeds the 5000 character limit" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("rpc_send_chat_attachment_message", {
      p_user_id: session.user.id,
      p_thread_id: threadId,
      p_body: bodyText || null,
      p_attachments: normalized.attachments,
    });

    if (error) {
      console.error("POST /api/chat/threads/[threadId]/messages (attachment) failed:", error);
      return mapChatRpcError(error);
    }

    const baseUrl = getBaseUrl(req);
    after(() =>
      notifyNewChatMessage({
        threadId,
        senderId: session.user.id,
        baseUrl,
      })
    );

    return NextResponse.json(data);
  } catch (error) {
    console.error("POST /api/chat/threads/[threadId]/messages failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
