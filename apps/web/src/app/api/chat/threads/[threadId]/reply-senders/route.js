/*
 * Replies held in this conversation because they came from someone other than
 * the landlord, and the landlord's decision on who may reply for them by email
 * (Wyatt, 2026-10-24). See lib/chat/replySenderApproval.js.
 *
 *   GET   { held: [...], senders: [...] }  held replies in this conversation
 *         and the landlord's whole approved/declined list. Empty for the
 *         student side: only the landlord decides who speaks for them.
 *   POST  { heldId, decision: "approve" | "decline", scope: "address" | "domain" }
 *         decides on the sender of one held reply. Approving delivers every
 *         reply held from them; the response lists what happened to each.
 *
 * Only the thread's landlord may decide, and only about a reply held in this
 * conversation, so the request can never name an arbitrary address.
 *
 * @auth user
 */
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { decideSender, heldReplies } from "@/lib/chat/replySenderApproval";
import { listReplySenders } from "@/lib/chat/replySenders";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The thread, when the caller is its landlord. */
async function landlordThread(req, params) {
  const authUser = await getRequestUser(req);
  if (!authUser?.id) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { threadId } = await params;
  if (!UUID_RE.test(threadId ?? "")) {
    return { response: NextResponse.json({ error: "threadId must be a valid UUID" }, { status: 400 }) };
  }
  const { data: thread, error } = await supabase
    .from("chat_threads")
    .select("id, landlord_id, interested_user_id, deleted_at")
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw error;
  // A non-participant must not learn whether the thread exists.
  if (!thread || thread.deleted_at || (thread.landlord_id !== authUser.id && thread.interested_user_id !== authUser.id)) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { authUser, thread, isLandlord: thread.landlord_id === authUser.id };
}

export async function GET(req, { params }) {
  try {
    const { response, authUser, thread, isLandlord } = await landlordThread(req, params);
    if (response) return response;
    if (!isLandlord) return NextResponse.json({ held: [], senders: [] });

    const [held, senders] = await Promise.all([
      heldReplies(supabase, { landlordId: authUser.id, threadId: thread.id }),
      listReplySenders(supabase, authUser.id),
    ]);
    return NextResponse.json({ held, senders });
  } catch (error) {
    console.error("GET /api/chat/threads/[threadId]/reply-senders failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const { response, authUser, thread, isLandlord } = await landlordThread(req, params);
    if (response) return response;
    if (!isLandlord) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { heldId, decision, scope = "address" } = payload ?? {};
    if (!UUID_RE.test(String(heldId ?? ""))) {
      return NextResponse.json({ error: "heldId must be a valid UUID" }, { status: 400 });
    }
    if (decision !== "approve" && decision !== "decline") {
      return NextResponse.json({ error: "decision must be approve or decline" }, { status: 400 });
    }
    if (scope !== "address" && scope !== "domain") {
      return NextResponse.json({ error: "scope must be address or domain" }, { status: 400 });
    }

    const { data: held, error } = await supabase
      .from("chat_inbound_emails")
      .select("id, from_email")
      .eq("id", heldId)
      .eq("user_id", authUser.id)
      .eq("thread_id", thread.id)
      .eq("status", "held")
      .maybeSingle();
    if (error) throw error;
    if (!held) return NextResponse.json({ error: "That reply is no longer waiting" }, { status: 404 });

    const out = await decideSender({
      landlordId: authUser.id,
      email: held.from_email,
      scope,
      decision,
      decidedBy: authUser.id,
      via: "landlord",
    });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
    return NextResponse.json(out);
  } catch (error) {
    console.error("POST /api/chat/threads/[threadId]/reply-senders failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
