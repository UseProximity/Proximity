/*
 * Tell the sender of an emailed reply what Proximity took out of it (Wyatt,
 * 2026-11-23): one email for application links, contact details, payment and
 * login requests, abuse and removed attachments, instead of one per case.
 * Shared by the chat reply relay (lib/chat/inboundEmail.js) and tour replies
 * (lib/agents/replyEmail.js). Never throws: a note is worth less than the
 * reply it is about.
 */
import supabase from "@/lib/supabase";
import { getBaseUrl, sendReplyNoteEmail } from "@/lib/email";
import { applicationLinkRefusal } from "@/lib/chat/sendGuards";

export async function emailReplyNote({
  to,
  audience,
  senderId,
  otherId = null,
  listingId = null,
  threadId = null,
  delivered,
  reasons = [],
  attachmentsRemoved = false,
  applicationLink = false,
  unrestricted = false,
}) {
  try {
    const baseUrl = getBaseUrl();
    let link = null;
    if (applicationLink) {
      const refusal = await applicationLinkRefusal(senderId, listingId);
      link = { message: refusal.message, actionLabel: refusal.actionLabel, url: `${baseUrl}${refusal.settingsUrl}` };
    }
    const { data: other } = otherId
      ? await supabase.from("users").select("name").eq("id", otherId).maybeSingle()
      : { data: null };
    await sendReplyNoteEmail({
      to,
      audience,
      otherFirst: String(other?.name ?? "").trim().split(/\s+/)[0],
      delivered,
      reasons,
      attachmentsRemoved,
      applicationLink: link,
      unrestricted,
      conversationUrl: threadId ? `${baseUrl}/messages?thread=${encodeURIComponent(threadId)}` : `${baseUrl}/messages`,
    });
  } catch (err) {
    console.error("reply note failed:", err);
  }
}
