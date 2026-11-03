export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";

/*
 * Every chat thread, summarised for the admin Conversations view: who is
 * talking, about which listing, how many messages, when the last one landed,
 * and how many moderation flags and blocked attempts the thread has. The
 * messages themselves come from /api/admin/chat/threads/[threadId].
 *
 * Deleted threads are included and marked, since an admin reviewing a report
 * needs to see what was said even after a user removed the conversation.
 *
 * ?kind=direct (the default) is person to person: a student and a landlord,
 * including the chats a tour opened ("From a tour"). ?kind=agent is a student
 * or signed-out visitor talking with Proxy (Wyatt, 2026-11-01).
 *
 * Honours the dashboard's dev/prod switch via the x-db-target header, like the
 * other admin reads.
 *
 * @auth admin
 */

const PAGE = 1000;

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

// PostgREST caps a response at 1000 rows whatever the range, so anything that
// can grow past that is walked in pages.
async function fetchAll(query) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseClient(getDbTarget(req));
  const kind = new URL(req.url).searchParams.get("kind") === "agent" ? "agent" : "direct";

  try {
    const { data: proxyType } = await supabase.from("thread_types").select("id").eq("name", "proxy").maybeSingle();
    let query = supabase
      .from("chat_threads")
      .select("id, subject, listing_id, landlord_id, interested_user_id, visitor_id, notify_email, unrestricted, created_at, updated_at, deleted_at")
      .order("updated_at", { ascending: false });
    if (proxyType?.id) {
      // A thread with no type predates thread types and is person to person.
      query = kind === "agent"
        ? query.eq("thread_type_id", proxyType.id)
        : query.or(`thread_type_id.is.null,thread_type_id.neq.${proxyType.id}`);
    } else if (kind === "agent") {
      return Response.json([]);
    }
    const threads = await fetchAll(query);
    if (threads.length === 0) return Response.json([]);

    const threadIds = threads.map((t) => t.id);
    const userIds = [...new Set(threads.flatMap((t) => [t.landlord_id, t.interested_user_id]).filter(Boolean))];
    const listingIds = [...new Set(threads.map((t) => t.listing_id).filter(Boolean))];

    const [users, listings, messages, events] = await Promise.all([
      fetchAll(supabase.from("users").select("id, name, email, roles!role_id(name)").in("id", userIds)),
      fetchAll(supabase.from("listings").select("id, title, address").in("id", listingIds)),
      fetchAll(
        supabase
          .from("chat_messages")
          .select("thread_id, sender_id, created_at, deleted_at")
          .in("thread_id", threadIds)
          .order("created_at", { ascending: true })
      ),
      fetchAll(
        supabase
          .from("chat_moderation_events")
          .select("thread_id, action, message_id, reviewed_at")
          .in("thread_id", threadIds)
      ),
    ]);

    const userById = new Map(users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email, role: u.roles?.name ?? null }]));
    const listingById = new Map(listings.map((l) => [l.id, l]));

    const stats = new Map();
    for (const id of threadIds) {
      stats.set(id, { messages: 0, deleted: 0, lastMessageAt: null, lastSenderId: null, flagged: 0, blocked: 0, unreviewed: 0 });
    }
    for (const m of messages) {
      const s = stats.get(m.thread_id);
      if (!s) continue;
      s.messages += 1;
      if (m.deleted_at) s.deleted += 1;
      s.lastMessageAt = m.created_at;
      s.lastSenderId = m.sender_id;
    }
    for (const e of events) {
      const s = stats.get(e.thread_id);
      if (!s) continue;
      if (e.message_id) s.flagged += 1;
      else s.blocked += 1;
      if (!e.reviewed_at) s.unreviewed += 1;
    }

    const out = threads.map((t) => ({
      id: t.id,
      subject: t.subject,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      deletedAt: t.deleted_at,
      listing: listingById.get(t.listing_id) ?? null,
      landlord: userById.get(t.landlord_id) ?? null,
      student: userById.get(t.interested_user_id) ?? null,
      // A signed-out visitor talking with Proxy: their cookie id and, once
      // confirmed, the email Proxy writes to.
      visitor: t.interested_user_id || !t.visitor_id ? null : { id: t.visitor_id, email: t.notify_email ?? null },
      kind,
      fromTour: kind === "direct" && t.unrestricted === true,
      ...stats.get(t.id),
    }));

    out.sort((a, b) => new Date(b.lastMessageAt ?? b.updatedAt ?? 0) - new Date(a.lastMessageAt ?? a.updatedAt ?? 0));
    return Response.json(out);
  } catch (err) {
    console.error("GET /api/admin/chat/threads failed:", err);
    return Response.json({ error: "Could not load conversations" }, { status: 500 });
  }
}
