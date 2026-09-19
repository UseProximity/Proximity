/*
 * GET /api/chat/access-token — peek a magic-link token without consuming it.
 * The /chat-link interstitial uses this to decide same-user vs chooser vs open,
 * without letting Outlook Safe Links burn the single-use row on prefetch.
 */
import { NextResponse } from "next/server";
import { peekChatAccessToken } from "@/lib/chat/accessToken";

export async function GET(req) {
  try {
    const token = new URL(req.url).searchParams.get("token");
    const peeked = await peekChatAccessToken(token);
    if (!peeked) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
    }
    return NextResponse.json({
      userId: peeked.userId,
      threadId: peeked.threadId,
      email: peeked.email,
      name: peeked.name,
    });
  } catch (error) {
    console.error("GET /api/chat/access-token failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
