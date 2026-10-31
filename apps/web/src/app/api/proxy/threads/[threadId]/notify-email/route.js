/*
 * POST /api/proxy/threads/[threadId]/notify-email  { email }
 *
 * A signed-out visitor leaves an address to hear back when the landlord
 * answers. Stored on the thread only; never shown to the landlord. An empty
 * email clears it.
 *
 * @auth public
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { proxyActor } from "@/lib/agents/access";
import { getThread, canAccessThread } from "@/lib/agents/threads";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req, { params }) {
  try {
    const { threadId } = await params;
    const actor = await proxyActor(req);
    const thread = await getThread(threadId);
    if (!canAccessThread(thread, actor)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (actor.userId) return NextResponse.json({ error: "Your account email is used for updates." }, { status: 400 });
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 254);
    if (email && !EMAIL.test(email)) return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
    const { error } = await supabase.from("chat_threads").update({ notify_email: email || null }).eq("id", thread.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, hasNotifyEmail: !!email });
  } catch (err) {
    console.error("POST notify-email failed:", err);
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }
}
