/*
 * Ask a landlord, once per sender, whether someone else may reply by email on
 * their behalf (Wyatt, 2026-10-24). Called by lib/chat/inboundEmail.js when it
 * holds a reply; the decision itself is made in lib/chat/replySenderApproval.js.
 */
import supabase from "@/lib/supabase";
import { chatListingLabel, getBaseUrl, sendReplySenderApprovalEmail } from "@/lib/email";
import { mintChatAccessToken } from "@/lib/chat/accessToken";

const first = (name) => String(name ?? "").trim().split(/\s+/)[0] || "";

/**
 * Email the landlord about a held reply, unless they were already asked about
 * this sender and have not decided yet. Records approval_requested_at on the
 * held row. Never throws.
 */
export async function requestSenderApproval({ logId, landlordId, threadId, fromEmail, senderName, preview }) {
  try {
    const { count } = await supabase
      .from("chat_inbound_emails")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", landlordId)
      .eq("from_email", fromEmail)
      .eq("status", "held")
      .not("approval_requested_at", "is", null)
      .neq("id", logId);
    if (count > 0) return "already_asked";

    const [{ data: landlord }, { data: thread }] = await Promise.all([
      supabase.from("users").select("email, name, deleted_at").eq("id", landlordId).maybeSingle(),
      supabase
        .from("chat_threads")
        .select("subject, interested_user_id, student:users!interested_user_id(name), listing:listings!listing_id(title, address)")
        .eq("id", threadId)
        .maybeSingle(),
    ]);
    if (!landlord?.email || landlord.deleted_at) return "no_landlord";

    const token = await mintChatAccessToken({ userId: landlordId, threadId });
    const baseUrl = getBaseUrl();
    const threadUrl = token
      ? `${baseUrl}/chat-link?token=${encodeURIComponent(token)}&t=${encodeURIComponent(threadId)}`
      : `${baseUrl}/messages?thread=${threadId}`;

    await sendReplySenderApprovalEmail({
      to: landlord.email,
      landlordFirst: first(landlord.name),
      senderName,
      senderEmail: fromEmail,
      studentFirst: first(thread?.student?.name),
      listingLabel: chatListingLabel({
        listingTitle: thread?.listing?.title,
        listingAddress: thread?.listing?.address,
        subject: thread?.subject,
      }),
      preview: String(preview ?? "").slice(0, 600),
      threadUrl,
    });
    await supabase.from("chat_inbound_emails").update({ approval_requested_at: new Date().toISOString() }).eq("id", logId);
    return "asked";
  } catch (err) {
    console.error("requestSenderApproval failed:", err);
    return "failed";
  }
}
