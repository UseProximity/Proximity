/*
 * A student who already talks with this listing's landlord in Messages is
 * pointed at that conversation from the Proxy chat (Wyatt, 2026-11-02), so
 * they don't start a second line to the same landlord through Proxy.
 *
 * Picks the student's most recent direct conversation with any owner of the
 * listing: one about this listing first, else one about another of that
 * landlord's listings. Left out: deleted conversations, conversations with no
 * messages, chats a tour opened (the tour note already links those), and
 * anyone the student blocked or who blocked them. Nothing at all when a tour
 * already opened a chat about this listing. Never throws.
 */
import supabase from "@/lib/supabase";

let _directType = null;
async function directTypeId() {
  if (_directType) return _directType;
  const { data } = await supabase.from("thread_types").select("id").eq("name", "direct").maybeSingle();
  _directType = data?.id ?? null;
  return _directType;
}

export async function existingChatFor({ listingId, userId }) {
  try {
    if (!listingId || !userId) return null;
    const [typeId, { data: owners }] = await Promise.all([
      directTypeId(),
      supabase.from("listing_landlords").select("user_id").eq("listing_id", listingId),
    ]);
    const ownerIds = (owners ?? []).map((o) => o.user_id).filter((id) => id && id !== userId);
    if (!typeId || !ownerIds.length) return null;

    const { data: threads } = await supabase.from("chat_threads")
      .select("id, listing_id, landlord_id, updated_at, listings!listing_id(title, address)")
      .eq("thread_type_id", typeId).eq("interested_user_id", userId).in("landlord_id", ownerIds)
      .is("deleted_at", null).order("updated_at", { ascending: false }).limit(20);
    if (!threads?.length) return null;

    const ids = threads.map((t) => t.id);
    const [{ data: tours }, { data: blocks }, { data: withMessages }] = await Promise.all([
      supabase.from("tour_requests").select("thread_id").in("thread_id", ids),
      supabase.from("user_blocks").select("blocker_id, blocked_id")
        .or(`and(blocker_id.eq.${userId},blocked_id.in.(${ownerIds.join(",")})),and(blocked_id.eq.${userId},blocker_id.in.(${ownerIds.join(",")}))`),
      supabase.from("chat_messages").select("thread_id").in("thread_id", ids).is("deleted_at", null).limit(500),
    ]);
    const tourChats = new Set((tours ?? []).map((t) => t.thread_id));
    const blocked = new Set((blocks ?? []).flatMap((b) => [b.blocker_id, b.blocked_id]));
    const live = new Set((withMessages ?? []).map((m) => m.thread_id));

    // A tour already opened a chat about this listing: its note links there.
    if (threads.some((t) => t.listing_id === listingId && tourChats.has(t.id))) return null;
    const usable = threads.filter((t) => live.has(t.id) && !tourChats.has(t.id) && !blocked.has(t.landlord_id));
    const pick = usable.find((t) => t.listing_id === listingId) ?? usable[0];
    if (!pick) return null;

    const { data: landlord } = await supabase.from("users").select("name, company_name").eq("id", pick.landlord_id).maybeSingle();
    return {
      threadId: pick.id,
      landlordName: landlord?.company_name || landlord?.name || "the landlord",
      sameListing: pick.listing_id === listingId,
      listingLabel: pick.listings?.title || pick.listings?.address || null,
      href: `/?messages=1&thread=${pick.id}`,
    };
  } catch (err) {
    console.error("[proxy] existing chat lookup failed:", err?.message ?? err);
    return null;
  }
}
