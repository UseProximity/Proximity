/*
 * Outreach guard. External, user-visible side-effects (transactional email, Airtable sync,
 * Formspree forwarding) must only happen on the real production site — never on staging or
 * local, where the data is a prod snapshot containing real customer emails.
 *
 * sendMailSafe() wraps a Nodemailer transporter: on production it sends; otherwise it logs
 * what it *would* have sent and returns without contacting anyone. Use it everywhere instead
 * of calling transporter.sendMail() directly. For non-email outreach, gate the call site with
 * outreachEnabled().
 */
import { outreachEnabled } from "./appEnv";

export async function sendMailSafe(transporter, message) {
  if (!outreachEnabled()) {
    console.log(`[outreach disabled] suppressed email → to=${message?.to} subject=${message?.subject}`);
    return { suppressed: true };
  }
  return transporter.sendMail(message);
}

export { outreachEnabled };
