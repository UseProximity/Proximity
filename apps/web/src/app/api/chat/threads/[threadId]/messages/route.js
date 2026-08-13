import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { notifyNewChatMessage } from "@/lib/chat/notifyEmail";

// Surfaced to the client as-is; everything else becomes a generic 500.
const SAFE_SEND_MESSAGE_ERRORS = new Set([
  "message body is required",
  "message body exceeds the 5000 character limit",
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

// POST /api/chat/threads/[threadId]/messages — reply in an existing thread
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

    const { body } = payload ?? {};
    if (typeof body !== "string" || !body.trim()) {
      return NextResponse.json({ error: "Message body required" }, { status: 400 });
    }

    const trimmedBody = body.trim();
    if (trimmedBody.length > 5000) {
      return NextResponse.json(
        { error: "Message body exceeds the 5000 character limit" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("rpc_send_chat_message", {
      p_user_id: session.user.id,
      p_thread_id: threadId,
      p_body: trimmedBody,
    });

    if (error) {
      console.error("POST /api/chat/threads/[threadId]/messages failed:", error);
      return mapChatRpcError(error);
    }

    // Read the request headers here: after() runs once the response is on its way.
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
