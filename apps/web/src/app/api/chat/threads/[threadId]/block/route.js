/*
 * POST /api/chat/threads/[threadId]/block
 *
 * Blocks the other person in this conversation for the signed-in caller. Reuses
 * user_blocks, the same generic relationship reviews read, so it also hides that
 * person's reviews from the caller. Enforcement lives in the chat routes (see
 * lib/chat/safety.js), not the database: the thread leaves the blocker's inbox,
 * and neither side can start or send into it. The blocked person keeps seeing the
 * thread, closed to sending, and is not told.
 *
 * The target comes from the thread, not the request. There is no unblock endpoint
 * yet: support removes the user_blocks row by hand. Blocking someone already
 * blocked is a no-op.
 *
 * @auth user
 */
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { resolveThreadCounterpart } from "@/lib/chat/safety";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req, { params }) {
  try {
    const authUser = await getRequestUser(req);
    if (!authUser?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { threadId } = await params;
    if (!UUID_RE.test(threadId ?? "")) {
      return NextResponse.json({ error: "threadId must be a valid UUID" }, { status: 400 });
    }

    const target = await resolveThreadCounterpart(threadId, authUser.id);
    if (!target.ok) {
      return NextResponse.json({ error: target.error }, { status: target.status });
    }

    const { error } = await supabase
      .from("user_blocks")
      .upsert(
        { blocker_id: authUser.id, blocked_id: target.otherUserId },
        { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true }
      );
    if (error) {
      console.error("POST /api/chat/threads/[threadId]/block failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/chat/threads/[threadId]/block failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
