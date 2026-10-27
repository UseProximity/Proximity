/*
 * Text hygiene for Proxy.
 *
 *   sanitizeStudentText   what a student typed, before it reaches the model
 *                         or the database: markup stripped, whitespace
 *                         collapsed, length capped. Instructions hidden in the
 *                         text are not removed here (they are plain words);
 *                         the prompt tells the model the message is data.
 *   screenLandlordText    what a landlord wrote, before Proxy relays it:
 *                         phone numbers, email addresses, links and social
 *                         handles are removed, whatever host they point at
 *                         (Wyatt, 2026-10-26: contact details reach a student
 *                         only through a confirmed tour). The leasing office
 *                         address is a fact, not contact information, and is
 *                         left alone.
 */

export const STUDENT_MAX = 2000;
export const LANDLORD_MAX = 4000;

export function sanitizeStudentText(text) {
  return String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, STUDENT_MAX);
}

const REMOVED = "[contact details removed]";
const EMAIL = /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[a-z0-9.-]+\s*(?:\.|\(dot\)|\[dot\])\s*[a-z]{2,}/gi;
// Seven or more digits with the usual separators: a phone number in any format.
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|us|app|info|biz|edu)(?:\/[^\s<>"')]*)?/gi;
const HANDLE = /(?:^|[\s(])@[a-z0-9_.]{2,}/gi;
const PLATFORM_LINE = /\b(?:text|call|whatsapp|telegram|signal|snap(?:chat)?|instagram|ig|facebook|fb|venmo|zelle|cash ?app|paypal)\b[^.!?\n]*\b(?:me|us|at|on)\b[^.!?\n]*/gi;

export function screenLandlordText(text) {
  const original = String(text ?? "").replace(/<[^>]*>/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, LANDLORD_MAX);
  let out = original;
  let removed = 0;
  const strip = (re) => {
    out = out.replace(re, (m, ...rest) => {
      removed++;
      // Keep the leading space or bracket a handle match swallowed.
      const lead = typeof rest[0] === "string" && /^[\s(]$/.test(m[0]) ? m[0] : "";
      return `${lead}${REMOVED}`;
    });
  };
  strip(EMAIL);
  strip(URL);
  strip(BARE_DOMAIN);
  strip(PHONE);
  strip(HANDLE);
  strip(PLATFORM_LINE);
  out = out.replace(new RegExp(`(?:\\[contact details removed\\][\\s,;:]*){2,}`, "g"), `${REMOVED} `).replace(/\s{2,}/g, " ").trim();
  const words = out.replace(/\[contact details removed\]/g, "").trim().split(/\s+/).filter(Boolean);
  return { text: out, removed, onlyContact: removed > 0 && words.length < 3, original };
}
