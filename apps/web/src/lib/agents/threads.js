/*
 * Proxy threads (PRD v3, milestone 2).
 *
 * A Proxy thread is a chat_threads row of type 'proxy': one per listing per
 * person, where the person is a signed-in student (interested_user_id) or a
 * signed-out visitor (visitor_id, the prx_vid cookie). No landlord is ever a
 * participant. Proxy's own messages come from the Proxy system user.
 *
 * The inbox RPC lists 'direct' threads only, so these never appear in anyone's
 * Messages page; the listing page opens them.
 *
 * Signing in claims a visitor's threads: each one is moved onto the account,
 * and where the account already has a Proxy thread for that listing the
 * visitor's messages are merged into it, in order (Wyatt, 2026-10-26).
 *
 * Server-only: uses the service-role client.
 */
import supabase from "@/lib/supabase";

export const PROXY_USER_ID = "00000000-0000-0000-0000-000000000010";

const fail = (where, error) => new Error(`${where}: ${error.message}`);

let _typeId = null;
export async function proxyThreadTypeId() {
  if (_typeId) return _typeId;
  const { data, error } = await supabase.from("thread_types").select("id").eq("name", "proxy").maybeSingle();
  if (error) throw fail("thread type", error);
  if (!data) throw new Error("the proxy thread type is missing: run migration 202610270002");
  _typeId = data.id;
  return _typeId;
}

const THREAD_COLS = "id, listing_id, interested_user_id, visitor_id, lease_id, subject, notify_email, proxy_state, created_at, updated_at, deleted_at";

export async function getThread(threadId) {
  const { data, error } = await supabase
    .from("chat_threads").select(THREAD_COLS).eq("id", threadId).is("deleted_at", null).maybeSingle();
  if (error) throw fail("thread", error);
  return data ?? null;
}

export async function findProxyThread({ listingId, userId = null, visitorId = null }) {
  const typeId = await proxyThreadTypeId();
  let q = supabase.from("chat_threads").select(THREAD_COLS)
    .eq("thread_type_id", typeId).eq("listing_id", listingId).is("deleted_at", null);
  if (userId) q = q.eq("interested_user_id", userId);
  else if (visitorId) q = q.eq("visitor_id", visitorId).is("interested_user_id", null);
  else return null;
  const { data, error } = await q.order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw fail("thread lookup", error);
  return data ?? null;
}

export async function getOrCreateProxyThread({ listingId, userId = null, visitorId = null, leaseId = null }) {
  const existing = await findProxyThread({ listingId, userId, visitorId });
  if (existing) {
    if (leaseId && existing.lease_id !== leaseId) {
      await supabase.from("chat_threads").update({ lease_id: leaseId }).eq("id", existing.id);
      existing.lease_id = leaseId;
    }
    return { thread: existing, created: false };
  }
  const typeId = await proxyThreadTypeId();
  const { data: listing } = await supabase.from("listings").select("title, address").eq("id", listingId).maybeSingle();
  const subject = listing?.title?.trim() || listing?.address?.trim() || "Listing questions";
  const { data: thread, error } = await supabase
    .from("chat_threads")
    .insert({
      thread_type_id: typeId, listing_id: listingId, interested_user_id: userId, visitor_id: userId ? null : visitorId,
      lease_id: leaseId, subject,
    })
    .select(THREAD_COLS).single();
  if (error) throw fail("thread create", error);
  const participants = [{ thread_id: thread.id, user_id: PROXY_USER_ID }];
  if (userId) participants.push({ thread_id: thread.id, user_id: userId });
  await supabase.from("chat_participants").upsert(participants, { onConflict: "thread_id,user_id", ignoreDuplicates: true });
  return { thread, created: true };
}

/* Who may read or write a Proxy thread: its student, or its visitor cookie. */
export function canAccessThread(thread, { userId = null, visitorId = null } = {}) {
  if (!thread) return false;
  if (thread.interested_user_id) return !!userId && thread.interested_user_id === userId;
  return !!visitorId && thread.visitor_id === visitorId;
}

export const MESSAGE_COLS = "id, thread_id, sender_id, body, message_type, metadata, created_at";

export async function listMessages(threadId, { limit = 200 } = {}) {
  const { data, error } = await supabase
    .from("chat_messages").select(MESSAGE_COLS).eq("thread_id", threadId).is("deleted_at", null)
    .order("created_at", { ascending: true }).limit(limit);
  if (error) throw fail("messages", error);
  return data ?? [];
}

export async function postMessage({ threadId, listingId, senderId = null, body, type = "text", metadata = {} }) {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ thread_id: threadId, listing_id: listingId, sender_id: senderId, body, message_type: type, metadata })
    .select(MESSAGE_COLS).single();
  if (error) throw fail("message write", error);
  return data;
}

export async function postProxyMessage({ threadId, listingId, body, type = "proxy_answer", metadata = {} }) {
  return postMessage({ threadId, listingId, senderId: PROXY_USER_ID, body, type, metadata });
}

export async function updateProxyState(threadId, patch) {
  const { data } = await supabase.from("chat_threads").select("proxy_state").eq("id", threadId).maybeSingle();
  const next = { ...(data?.proxy_state ?? {}), ...patch };
  await supabase.from("chat_threads").update({ proxy_state: next }).eq("id", threadId);
  return next;
}

export async function markRead(threadId, userId) {
  if (!userId) return;
  await supabase.from("chat_participants").update({ last_read_at: new Date().toISOString() })
    .eq("thread_id", threadId).eq("user_id", userId);
}

/*
 * The shape the browser gets. Proxy's messages carry their type and the facts
 * they drew on; a student's own messages are "mine".
 */
export function shapeMessage(m, { userId = null } = {}) {
  const fromProxy = m.sender_id === PROXY_USER_ID;
  return {
    id: m.id,
    body: m.body,
    type: m.message_type,
    fromProxy,
    isMine: !fromProxy && (userId ? m.sender_id === userId : m.sender_id === null),
    createdAt: m.created_at,
    factKeys: m.metadata?.factKeys ?? [],
    updatedAt: m.metadata?.updatedAt ?? null,
    questionIds: m.metadata?.questionIds ?? [],
    questionId: m.metadata?.questionId ?? null,
    clarifier: !!m.metadata?.clarifier,
  };
}

/*
 * The student's Proxy conversations, shaped like inbox rows so the Messages
 * overlay can list them on their own tab (Wyatt, 2026-10-27). One row per
 * listing; the other party is always Proxy.
 */
export async function listProxyInbox(userId) {
  if (!userId) return [];
  const typeId = await proxyThreadTypeId();
  const { data: threads, error } = await supabase.from("chat_threads")
    .select("id, listing_id, lease_id, updated_at, listings!listing_id(id, title, address, min_rent, max_rent, listing_images(url, sort_order))")
    .eq("thread_type_id", typeId).eq("interested_user_id", userId).is("deleted_at", null)
    .order("updated_at", { ascending: false }).limit(50);
  if (error) throw fail("proxy inbox", error);
  const out = [];
  for (const t of threads ?? []) {
    const [{ data: last }, { data: part }, { data: tour }] = await Promise.all([
      supabase.from("chat_messages").select("body, message_type, created_at, sender_id").eq("thread_id", t.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("chat_participants").select("last_read_at").eq("thread_id", t.id).eq("user_id", userId).maybeSingle(),
      supabase.from("tour_requests").select("status, confirmed_slot").eq("listing_id", t.listing_id).eq("student_id", userId).in("status", ["requested", "proposed", "confirmed"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!last) continue;
    let unread = 0;
    if (!part?.last_read_at || new Date(last.created_at) > new Date(part.last_read_at)) {
      let q = supabase.from("chat_messages").select("id", { count: "exact", head: true }).eq("thread_id", t.id).is("deleted_at", null).neq("sender_id", userId);
      if (part?.last_read_at) q = q.gt("created_at", part.last_read_at);
      unread = (await q).count ?? 0;
    }
    const images = (t.listings?.listing_images ?? []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    out.push({
      kind: "proxy", threadId: t.id, subject: null, updatedAt: t.updated_at,
      listingId: t.listing_id, leaseId: t.lease_id, listingTitle: t.listings?.title ?? null, listingAddress: t.listings?.address ?? null,
      listingImage: images[0]?.url ?? null, listingMinRent: t.listings?.min_rent ?? null, listingMaxRent: t.listings?.max_rent ?? null,
      listings: [], listingCount: 1, isInterestedUser: true,
      otherUserId: PROXY_USER_ID, otherUserName: "Proxy", otherUserImage: null, otherUserLastReadAt: null,
      lastMessageBody: last.body, lastMessageType: last.message_type, lastMessageAt: last.created_at, lastMessageMine: last.sender_id === userId,
      unreadCount: unread, hasUnread: unread > 0,
      tour: tour ? { status: tour.status, confirmedSlot: tour.confirmed_slot } : null,
    });
  }
  return out;
}

/*
 * Signing in: every Proxy thread on this visitor cookie moves onto the
 * account. Where the account already has one for the same listing, the
 * visitor's messages, question waiters and logs are moved into it and the
 * visitor thread is soft-deleted. Returns how many threads were claimed.
 */
export async function claimVisitorThreads({ visitorId, userId }) {
  if (!visitorId || !userId) return 0;
  const typeId = await proxyThreadTypeId();
  const { data: mine, error } = await supabase
    .from("chat_threads").select(THREAD_COLS).eq("thread_type_id", typeId)
    .eq("visitor_id", visitorId).is("interested_user_id", null).is("deleted_at", null);
  if (error) throw fail("claim lookup", error);
  let claimed = 0;
  for (const t of mine ?? []) {
    const existing = await findProxyThread({ listingId: t.listing_id, userId });
    if (existing && existing.id !== t.id) {
      await supabase.from("chat_messages").update({ thread_id: existing.id }).eq("thread_id", t.id);
      await supabase.from("listing_question_waiters").update({ thread_id: existing.id, user_id: userId }).eq("thread_id", t.id);
      await supabase.from("listing_agent_questions").update({ thread_id: existing.id, user_id: userId }).eq("thread_id", t.id);
      await supabase.from("chat_threads").update({ deleted_at: new Date().toISOString() }).eq("id", t.id);
      if (!existing.lease_id && t.lease_id) await supabase.from("chat_threads").update({ lease_id: t.lease_id }).eq("id", existing.id);
    } else {
      await supabase.from("chat_threads").update({ interested_user_id: userId, visitor_id: null }).eq("id", t.id);
      await supabase.from("chat_participants").upsert({ thread_id: t.id, user_id: userId }, { onConflict: "thread_id,user_id", ignoreDuplicates: true });
      await supabase.from("chat_messages").update({ sender_id: userId }).eq("thread_id", t.id).is("sender_id", null);
      await supabase.from("listing_question_waiters").update({ user_id: userId }).eq("thread_id", t.id);
      await supabase.from("listing_agent_questions").update({ user_id: userId }).eq("thread_id", t.id);
    }
    claimed++;
  }
  return claimed;
}
