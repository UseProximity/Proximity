/*
 * Tell the team at once when a chat email goes wrong (Wyatt, 2026-10-23).
 *
 * Nothing between a landlord and a student may disappear without someone
 * hearing about it. These are the failures that would otherwise only reach
 * the server log:
 *   - a message alert or reply reminder that could not be sent at all
 *   - one that SES reports as bounced, rejected, marked as spam or unrenderable
 *   - an emailed reply that was received but not posted to its conversation
 *
 * Each sends one short internal email to the check-in recipients
 * (resolveCheckinRecipients), through SES with Gmail as the fallback, so it
 * still goes out when the failure being reported is one of the two. The daily
 * check-in repeats everything still unresolved, so a lost alert email here is
 * caught there too. Off production
 * sendMailSafe redirects or suppresses it like every other send.
 *
 * Never throws: a failure to report must not break the send it reports on.
 */
import { sendTeamEmail } from "@/lib/email";
import { esc, resolveCheckinRecipients, wrapHtml } from "@/lib/chat/checkin";

/**
 * @param {{ subject: string, intro: string, facts: Array<[string, unknown]>, action?: string }} input
 */
export async function alertTeam({ subject, intro, facts = [], action = null }) {
  try {
    const rows = facts
      .filter(([, v]) => v != null && v !== "")
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 10px 4px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0;color:#111">${esc(v)}</td></tr>`
      )
      .join("");
    const html = wrapHtml(`
      <h2 style="color:#E82027;font-size:18px;margin:0 0 6px">${esc(subject)}</h2>
      <p style="color:#111;font-size:14px;margin:0 0 10px">${esc(intro)}</p>
      <table style="font-size:13px;border-collapse:collapse">${rows}</table>
      ${action ? `<p style="color:#111;font-size:14px;margin:14px 0 0"><strong>What to do:</strong> ${esc(action)}</p>` : ""}
    `);
    await sendTeamEmail({
      to: resolveCheckinRecipients(),
      subject: `Chat email problem: ${subject}`,
      html,
    });
  } catch (err) {
    console.error("alertTeam failed:", err);
  }
}
