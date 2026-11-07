/*
 * Kept apart from lib/email.js (which needs the mail transports) so the admin
 * mass email preview can show the exact footer in the browser. lib/email.js
 * re-exports it, so existing imports keep working.
 */

/*
 * The footer every outbound email carries.
 *
 * CAN-SPAM requires commercial email to give a valid physical postal address and
 * a working way to stop receiving it. Transactional mail (a password reset, a
 * verification link, an inquiry we are delivering on someone's behalf) is exempt
 * from the opt-out requirement, but carries the address anyway so that every
 * message we send says plainly who sent it.
 *
 * The opt-out is a reply rather than a one-click link, which the statute allows
 * as an internet-based mechanism. That makes it a promise about a mailbox rather
 * than about code: the commercial senders set replyTo to OPT_OUT_INBOX, and
 * whoever works that inbox has to action an unsubscribe within 10 business days
 * for this to stay true. Swapping in a real link later means a stored opt-out
 * list and a suppression check in sendMailSafe, not a change here.
 *
 * POSTAL_ADDRESS intentionally repeats what the legal documents say in
 * src/content/legal/. If the company address ever changes, both move together.
 */
export const POSTAL_ADDRESS =
  "Proximity LLC, 117 South Lexington Street, Ste 100, Harrisonville, MO 64701";
export const OPT_OUT_INBOX = "info@useproximity.org";

/*
 * `reason` is the one line telling someone why this landed in their inbox. On a
 * commercial send it is what identifies the message, so it is required there and
 * the call sites all pass one.
 */
export function emailFooter({ reason, commercial = false } = {}) {
  const optOut = commercial
    ? `<p style="color:#999;font-size:12px;line-height:1.5;margin:0 0 6px">
         Don&#39;t want these? Reply to this email with &quot;unsubscribe&quot; and we
         will stop sending them.
       </p>`
    : "";

  return `
      <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb">
        ${reason ? `<p style="color:#999;font-size:12px;line-height:1.5;margin:0 0 6px">${reason}</p>` : ""}
        ${optOut}
        <p style="color:#999;font-size:12px;line-height:1.5;margin:0">${POSTAL_ADDRESS}</p>
      </div>`;
}
