export const dynamic = "force-dynamic";

import { STALE_CLAIM_MS } from "@/lib/chat/inboundEmail";
import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";
import { domainApprovable } from "@/lib/chat/replySenders";

/*
 * One thread in full for the admin Conversations view: every message (deleted
 * ones included, marked), who sent it and how (app or email reply), its
 * attachments by name, and every moderation event in the thread. Events with
 * a message id are flags on a message that was posted; events without one are
 * attempts that were blocked before anything was posted, kept so an admin can
 * see what someone tried to send.
 *
 * Also every emailed reply addressed to this conversation that was not posted
 * (held for the landlord's approval, refused, failed), and the landlord's
 * list of who may reply for them by email (Wyatt, 2026-10-24). Decisions on
 * those are made through /api/admin/chat/reply-senders.
 *
 * Read only. Nothing here marks events reviewed or edits messages.
 *
 * @auth admin
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE = 1000;

// PostgREST caps a response at 1000 rows whatever the range, so the messages
// are walked in pages. Same shape as a single query's result.
async function fetchAllRows(query) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: rows, error: null };
  }
}

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

export async function GET(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { threadId } = await params;
  if (!UUID.test(threadId ?? "")) {
    return Response.json({ error: "Invalid thread id" }, { status: 400 });
  }

  const supabase = getSupabaseClient(getDbTarget(req));

  try {
    const [{ data: thread, error: threadError }, { data: participants }, { data: messages, error: msgError }, { data: attachments }, { data: events, error: evError }] =
      await Promise.all([
        supabase
          .from("chat_threads")
          .select("id, subject, listing_id, landlord_id, interested_user_id, created_at, updated_at, deleted_at, listing:listings!listing_id(id, title, address)")
          .eq("id", threadId)
          .maybeSingle(),
        supabase
          .from("chat_participants")
          .select("user_id, joined_at, last_read_at, last_notified_at, email_mode, user:users!user_id(id, name, email, roles!role_id(name))")
          .eq("thread_id", threadId),
        fetchAllRows(
          supabase
            .from("chat_messages")
            .select("id, sender_id, body, message_type, metadata, created_at, deleted_at")
            .eq("thread_id", threadId)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
        ),
        supabase
          .from("chat_attachments")
          .select("message_id, file_name, content_type, size_bytes")
          .eq("thread_id", threadId),
        supabase
          .from("chat_moderation_events")
          .select("id, user_id, message_id, action, reasons, body_excerpt, created_at, reviewed_at")
          .eq("thread_id", threadId)
          .order("created_at", { ascending: true }),
      ]);

    if (threadError) throw threadError;
    if (!thread) return Response.json({ error: "Not found" }, { status: 404 });

    const [{ data: inbound, error: inError }, { data: senders, error: sendersError }] = await Promise.all([
      supabase
        .from("chat_inbound_emails")
        .select("id, from_email, sender_name, status, reason, body_preview, created_at, approval_requested_at, chat_message_id")
        .eq("thread_id", threadId)
        .neq("status", "posted")
        .order("created_at", { ascending: true }),
      thread.landlord_id
        ? supabase
            .from("landlord_reply_senders")
            .select("id, pattern, decision, decided_via, updated_at")
            .eq("landlord_id", thread.landlord_id)
            .order("updated_at", { ascending: false })
        : { data: [], error: null },
    ]);
    if (inError) throw inError;
    if (sendersError) throw sendersError;
    if (msgError) throw msgError;
    if (evError) throw evError;

    const people = new Map(
      (participants ?? []).map((p) => [
        p.user_id,
        {
          id: p.user_id,
          name: p.user?.name ?? null,
          email: p.user?.email ?? null,
          role: p.user?.roles?.name ?? null,
          side: p.user_id === thread.landlord_id ? "landlord" : p.user_id === thread.interested_user_id ? "student" : "other",
          joinedAt: p.joined_at,
          lastReadAt: p.last_read_at,
          lastNotifiedAt: p.last_notified_at,
          emailMode: p.email_mode === true,
        },
      ])
    );

    // A sender who left the thread has no participant row; name them from users.
    const missing = [...new Set((messages ?? []).map((m) => m.sender_id))].filter((id) => id && !people.has(id));
    if (missing.length > 0) {
      const { data: extra } = await supabase.from("users").select("id, name, email, roles!role_id(name)").in("id", missing);
      for (const u of extra ?? []) {
        people.set(u.id, { id: u.id, name: u.name, email: u.email, role: u.roles?.name ?? null, side: "other" });
      }
    }

    const attachmentsByMessage = new Map();
    for (const a of attachments ?? []) {
      if (!attachmentsByMessage.has(a.message_id)) attachmentsByMessage.set(a.message_id, []);
      attachmentsByMessage.get(a.message_id).push({ fileName: a.file_name, contentType: a.content_type, sizeBytes: a.size_bytes });
    }

    const eventsByMessage = new Map();
    const blockedAttempts = [];
    for (const e of events ?? []) {
      const item = {
        id: e.id,
        userId: e.user_id,
        action: e.action,
        reasons: Array.isArray(e.reasons) ? e.reasons : [],
        excerpt: e.body_excerpt,
        createdAt: e.created_at,
        reviewedAt: e.reviewed_at,
      };
      if (e.message_id) {
        if (!eventsByMessage.has(e.message_id)) eventsByMessage.set(e.message_id, []);
        eventsByMessage.get(e.message_id).push(item);
      } else {
        blockedAttempts.push(item);
      }
    }

    return Response.json({
      thread: {
        id: thread.id,
        subject: thread.subject,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
        deletedAt: thread.deleted_at,
        listing: thread.listing ?? null,
        landlordId: thread.landlord_id,
        studentId: thread.interested_user_id,
      },
      people: [...people.values()],
      messages: (messages ?? []).map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        body: m.body,
        type: m.message_type,
        via: m.metadata?.via === "email" ? "email" : "app",
        emailFrom: m.metadata?.email_from ?? null,
        createdAt: m.created_at,
        deletedAt: m.deleted_at,
        attachments: attachmentsByMessage.get(m.id) ?? [],
        flags: eventsByMessage.get(m.id) ?? [],
      })),
      blockedAttempts,
      refusedReplies: (inbound ?? [])
        // A reply still being processed is normal; one stuck in 'processing'
        // past the stale window belongs to a run that died, and is shown so it
        // can be re-run.
        .filter((r) => r.status !== "processing" || (!r.chat_message_id && Date.now() - Date.parse(r.created_at) > STALE_CLAIM_MS))
        .map((r) => ({
        id: r.id,
        fromEmail: r.from_email,
        senderName: r.sender_name,
        status: r.status,
        reason: r.reason,
        preview: r.body_preview,
        receivedAt: r.created_at,
        landlordAskedAt: r.approval_requested_at,
        canApproveDomain: domainApprovable(r.from_email),
      })),
      replySenders: (senders ?? []).map((r) => ({
        id: r.id,
        pattern: r.pattern,
        decision: r.decision,
        decidedVia: r.decided_via,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/chat/threads/[threadId] failed:", err);
    return Response.json({ error: "Could not load the conversation" }, { status: 500 });
  }
}
