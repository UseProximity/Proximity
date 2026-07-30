import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

// A non-participant must not learn whether the thread exists, so this maps to 403.
const NOT_PARTICIPANT_ERROR = "not a participant in this conversation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/chat/threads/[threadId]/read — mark a thread read for the current user
export async function POST(_req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { threadId } = await params;
    if (!UUID_RE.test(threadId ?? "")) {
      return NextResponse.json({ error: "threadId must be a valid UUID" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("rpc_mark_thread_read", {
      p_user_id: session.user.id,
      p_thread_id: threadId,
    });

    if (error) {
      console.error("POST /api/chat/threads/[threadId]/read failed:", error);
      if (error.message === NOT_PARTICIPANT_ERROR) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("POST /api/chat/threads/[threadId]/read failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
