import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

// GET /api/chat/threads
// Lists all threads the authenticated user participates in.
// Optional ?listing_id= to filter to a specific listing.
export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const listingId = searchParams.get("listing_id");

  // Find thread IDs the user participates in
  const { data: participantRows } = await supabase
    .from("chat_participants")
    .select("thread_id")
    .eq("user_id", session.user.id);

  const threadIds = (participantRows ?? []).map((r) => r.thread_id);
  if (threadIds.length === 0) return NextResponse.json([]);

  let query = supabase
    .from("chat_threads")
    .select(`
      id, subject, listing_id, created_at,
      thread_types(name),
      chat_participants(user_id, last_read_at),
      chat_messages(id, body, created_at, sender_id)
    `)
    .in("id", threadIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (listingId) query = query.eq("listing_id", listingId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/chat/threads
// Creates a new listing_inquiry thread and adds the creator as a participant.
// Body: { listing_id, subject? }
// If a thread already exists between this user and the listing's landlord, returns it.
export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { listing_id, subject } = await req.json();
  if (!listing_id) return NextResponse.json({ error: "listing_id required" }, { status: 400 });

  // Resolve listing_inquiry thread type id
  const { data: typeRow } = await supabase
    .from("thread_types")
    .select("id")
    .eq("name", "listing_inquiry")
    .maybeSingle();

  const { data: thread, error: threadErr } = await supabase
    .from("chat_threads")
    .insert({
      listing_id,
      thread_type_id: typeRow?.id ?? null,
      subject: subject ?? null,
    })
    .select()
    .single();

  if (threadErr) return NextResponse.json({ error: threadErr.message }, { status: 500 });

  // Add creator as participant
  await supabase.from("chat_participants").insert({
    thread_id: thread.id,
    user_id: session.user.id,
  });

  // Also add the listing's primary landlord as a participant
  const { data: landlordRow } = await supabase
    .from("listing_landlords")
    .select("user_id")
    .eq("listing_id", listing_id)
    .eq("is_primary", true)
    .maybeSingle();

  if (landlordRow?.user_id && landlordRow.user_id !== session.user.id) {
    await supabase.from("chat_participants").insert({
      thread_id: thread.id,
      user_id: landlordRow.user_id,
    });
  }

  // Create listing_active_conversations entry for the student
  if (session.user.role === "student" || session.user.role === "pending_landlord") {
    await supabase.from("listing_active_conversations").upsert({
      listing_id,
      student_user_id: session.user.id,
      chat_thread_id: thread.id,
      state: "inquired",
    }, { onConflict: "listing_id,student_user_id", ignoreDuplicates: true });
  }

  return NextResponse.json(thread, { status: 201 });
}
