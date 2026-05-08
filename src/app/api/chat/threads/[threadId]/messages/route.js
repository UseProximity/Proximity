import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

async function requireParticipant(threadId, userId) {
  const { data } = await supabase
    .from("chat_participants")
    .select("thread_id")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

// GET /api/chat/threads/[threadId]/messages
// Returns all messages in the thread. Updates last_read_at for the caller.
export async function GET(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { threadId } = await params;

  if (!await requireParticipant(threadId, session.user.id))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, body, sender_id, created_at")
    .eq("thread_id", threadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mark as read (fire-and-forget)
  supabase
    .from("chat_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("user_id", session.user.id)
    .then(() => {});

  return NextResponse.json(data ?? []);
}

// POST /api/chat/threads/[threadId]/messages
// Sends a message and bumps listing_active_conversations.last_activity_at.
// Body: { body: string }
export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { threadId } = await params;

  if (!await requireParticipant(threadId, session.user.id))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { body: messageBody } = await req.json();
  if (!messageBody?.trim())
    return NextResponse.json({ error: "body required" }, { status: 400 });

  const { data: message, error } = await supabase
    .from("chat_messages")
    .insert({ thread_id: threadId, sender_id: session.user.id, body: messageBody.trim() })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Bump activity on any open active conversation linked to this thread (fire-and-forget)
  supabase
    .from("listing_active_conversations")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("chat_thread_id", threadId)
    .is("closed_at", null)
    .then(() => {});

  return NextResponse.json(message, { status: 201 });
}
