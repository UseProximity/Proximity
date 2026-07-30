import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

const SAFE_START_CHAT_ERRORS = new Set([
  "listing not found",
  "listing has no landlord to contact",
  "listing landlord is no longer an active user",
  "cannot start a chat about your own listing",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/chat/threads — inbox for the logged-in user
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("rpc_list_chat_threads", {
      p_user_id: session.user.id,
    });

    if (error) {
      console.error("GET /api/chat/threads failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error("GET /api/chat/threads failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/chat/threads — start or reuse a listing chat
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { listingId, body } = payload ?? {};
    if (typeof listingId !== "string" || !listingId.trim()) {
      return NextResponse.json({ error: "listingId required" }, { status: 400 });
    }
    if (!UUID_RE.test(listingId.trim())) {
      return NextResponse.json({ error: "listingId must be a valid UUID" }, { status: 400 });
    }
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

    const { data, error } = await supabase.rpc("rpc_start_or_get_listing_chat", {
      p_user_id: session.user.id,
      p_listing_id: listingId.trim(),
      p_body: trimmedBody,
    });

    if (error) {
      console.error("POST /api/chat/threads failed:", error);
      if (SAFE_START_CHAT_ERRORS.has(error.message)) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("POST /api/chat/threads failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
