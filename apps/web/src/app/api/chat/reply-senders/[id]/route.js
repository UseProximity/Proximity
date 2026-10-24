/*
 * DELETE /api/chat/reply-senders/[id]
 *
 * Removes one address or domain from the signed-in landlord's list of who may
 * reply by email for them (Wyatt, 2026-10-24). Removing an approval means that
 * sender's next reply is held and the landlord is asked again; removing a
 * "not them" does the same. Only the landlord's own entries can be removed.
 *
 * @auth user
 */
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { removeSender } from "@/lib/chat/replySenderApproval";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(req, { params }) {
  try {
    const authUser = await getRequestUser(req);
    if (!authUser?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!UUID_RE.test(id ?? "")) return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });

    const removed = await removeSender(supabase, { landlordId: authUser.id, id });
    if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/chat/reply-senders/[id] failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
