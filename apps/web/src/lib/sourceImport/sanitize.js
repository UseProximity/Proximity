/*
 * Make an imported description publishable under the content rules.
 *
 * A landlord's own site is full of what Proximity listings may not carry:
 * leasing-office phone numbers, email addresses, "call us today", a leasing
 * agent's name, links. The dashboard refuses to save a description with any
 * of these (checkListingDescription), so a draft that arrived with them
 * could not be published until the landlord found and deleted each one by
 * hand. This strips them on the way in:
 *
 *   1. emails, phone numbers, URLs and social handles are removed outright;
 *   2. then, while the content check still objects, the sentence that
 *      contains the objectionable match (a person's name, "contact us") is
 *      dropped, so what remains is what the check accepts.
 */
import { checkListingDescription, findNames, findPromo } from "@/lib/contentRules";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const OBFUSCATED_EMAIL_RE = /[a-z0-9._%+-]+\s*(?:\(at\)|\[at\]|\sat\s)\s*[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]*)?(?:\(\d{3}\)|\b\d{3})[\s.-]*\d{3}[\s.-]*\d{4}\b/g;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)]+|\b[a-z0-9-]+\.(?:com|org|net|co|io|us)(?:\/[^\s)]*)?/gi;
const HANDLE_RE = /(?:^|[\s(])@[a-z0-9._]{2,30}\b/gi;
const MAX_PASSES = 8;

const tidy = (s) =>
  s
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/* Split into sentences, keeping paragraph breaks as their own tokens. */
function sentences(text) {
  return text.split(/(\n\n+)/).flatMap((chunk) => (/^\n\n+$/.test(chunk) ? [chunk] : chunk.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? []));
}

function dropSentencesContaining(text, needle) {
  const n = needle.toLowerCase();
  const kept = sentences(text).filter((s) => !s.toLowerCase().includes(n));
  return tidy(kept.join(""));
}

/*
 * Returns { text, removed: [what was taken out] }. `text` is null when
 * nothing publishable was left.
 */
export function sanitizeDescription(raw) {
  if (!raw || typeof raw !== "string") return { text: null, removed: [] };
  const removed = [];
  let text = raw;
  // Links first: "visit our website at www.lofts.com" otherwise reads as an
  // obfuscated email ("website at www.lofts.com") and takes words with it.
  for (const [re, label] of [
    [URL_RE, "link"],
    [EMAIL_RE, "email"],
    [OBFUSCATED_EMAIL_RE, "email"],
    [PHONE_RE, "phone number"],
    [HANDLE_RE, "social handle"],
  ]) {
    text = text.replace(re, (m) => {
      removed.push(`${label}: ${m.trim()}`);
      return " ";
    });
  }
  text = tidy(text);

  for (let pass = 0; pass < MAX_PASSES && text; pass++) {
    const problem = checkListingDescription(text);
    if (!problem) break;
    const names = findNames(text, { strict: true });
    const promo = findPromo(text);
    const needle = names[0] ?? promo?.match;
    if (!needle) break;
    removed.push(names[0] ? `name: ${names[0]}` : `${promo.label}: ${promo.match}`);
    const next = dropSentencesContaining(text, needle);
    if (next === text) {
      // The match straddled a sentence boundary; cut the words themselves.
      text = tidy(text.replace(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " "));
    } else text = next;
  }
  if (text && checkListingDescription(text)) {
    // Still refused after every pass: better no description than one the
    // landlord cannot save.
    removed.push("description: could not be made to pass the content rules");
    text = "";
  }
  return { text: text || null, removed };
}
