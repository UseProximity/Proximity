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
 *                         left alone. They are dropped without a marker
 *                         (2026-10-29): the other side never sees "[contact
 *                         details removed]"; Proxy tells the sender instead
 *                         (CONTACT_NOTE).
 *   screenStudentText     the same, for what a student asks to be passed on.
 */

// What Proxy tells whoever tried to pass contact details along (Wyatt, 2026-10-29).
export const CONTACT_NOTE = {
  student: "Just so you know, I can't pass contact details along. If you'd like to get in touch with the landlord, book a tour with the Tour button and I'll connect you.",
  landlord: "I left out the contact details, since I can't pass those along. If the student is interested in the listing, you'll be put in touch once they book a tour. Until then, any other questions go through me.",
};

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

const REMOVED = "\u0000";
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
  // Drop the gaps, then the words left dangling in front of them ("call me at").
  out = out
    .replace(/[ \t]*\u0000(?:[\s,;:/|-]*\u0000)*/g, "\u0000")
    .replace(/(?:\b(?:or|and)\s+)?\b(?:call|text|email|e-mail|reach|contact|message|dm|find|follow|visit|see|check out|go to)(?:\s+(?:me|us|them))?(?:\s+(?:at|on|via))?\s*:?\s*\u0000/gi, "\u0000")
    .replace(/\s*\(\s*\u0000\s*\)/g, "")
    .replace(/\s*\u0000\s*([.,;:!?])?/g, (m, p) => (p && p !== "," ? p : " "))
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/([.,;:!?]){2,}/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[,;:\s]+$/g, "")
    .trim();
  const words = out.split(/\s+/).filter(Boolean);
  return { text: out, removed, onlyContact: removed > 0 && words.length < 3, original };
}

export function screenStudentText(text) {
  return screenLandlordText(text);
}
