/*
 * Tell a landlord, by email, that the application link in their emailed reply
 * was cut out of what the student saw, and where it goes instead (Wyatt,
 * 2026-11-20). Shared by the chat reply relay (lib/chat/inboundEmail.js) and
 * tour replies (lib/agents/replyEmail.js). Never throws: a notice is worth less
 * than the reply it is about.
 */
import supabase from "@/lib/supabase";
import { getBaseUrl, sendApplicationLinkNoticeEmail } from "@/lib/email";
import { applicationLinkMessage, applicationLinkSettingsPath } from "@/lib/chat/applicationLinks";
import { landlordHasApplicationLink } from "@/lib/chat/sendGuards";

export async function emailApplicationLinkNotice({ to, landlordId, listingId, studentId = null, delivered }) {
  try {
    const hasLink = await landlordHasApplicationLink(landlordId, listingId);
    const { data: student } = studentId
      ? await supabase.from("users").select("name").eq("id", studentId).maybeSingle()
      : { data: null };
    await sendApplicationLinkNoticeEmail({
      to,
      otherFirst: String(student?.name ?? "").trim().split(/\s+/)[0],
      message: applicationLinkMessage({ hasLink }),
      settingsUrl: applicationLinkSettingsPath(listingId),
      hasLink,
      delivered,
      baseUrl: getBaseUrl(),
    });
  } catch (err) {
    console.error("application link notice failed:", err);
  }
}
