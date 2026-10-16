/*
 * Turn an emailed reply into what the person actually wrote, so it reads in the
 * conversation like a text message rather than an email (Wyatt, 2026-10-09).
 *
 * Removed, in order:
 *   1. Everything from the quoted original down: our own "Reply above this line"
 *      marker, "On <date>, <name> wrote:", Outlook's "From: / Sent:" header block,
 *      "-----Original Message-----", and any ">" quoted lines.
 *   2. The signature: everything after a "-- " delimiter, "Sent from my iPhone"
 *      style footers, and a trailing block of lines that are only the sender's
 *      name, company, job title, phone, email, website or street address.
 *   3. A dangling sign-off left at the end ("Best,", "Regards,"). A sign-off that
 *      is a sentence ("Thanks!") stays, because it is part of the message.
 *
 * Contact details anywhere else in the text are left for moderation to redact.
 * Pure string work with no imports, so it can be exercised directly.
 */

const QUOTE_MARKERS = [
  /^\s*Reply above this line to message\b/i,
  /^\s*-{2,}\s*Original Message\s*-{2,}/i,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}/i,
  /^\s*Begin forwarded message:/i,
  /^\s*_{10,}\s*$/,
];

// "On Tue, Oct 9, 2026 at 4:12 PM Angela Clayton <...> wrote:", which Gmail and
// Apple Mail can wrap over two or three lines.
const ON_WROTE = /^\s*On\s[^\n]{0,300}?(\n[^\n]{0,300}?){0,2}\bwrote:\s*$/im;

// Outlook: a "From:" line followed within a few lines by "Sent:" or "Date:".
function outlookHeaderIndex(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\*?From:\*?\s/i.test(lines[i])) continue;
    for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
      if (/^\s*\*?(Sent|Date):\*?\s/i.test(lines[j])) return i;
    }
  }
  return -1;
}

const MOBILE_FOOTERS = [
  /^\s*Sent from my \S.*$/i,
  /^\s*Sent from (Mail|Outlook|Yahoo Mail|Gmail)\b.*$/i,
  /^\s*Get Outlook for \S.*$/i,
  /^\s*Sent via .*$/i,
];

const SIGN_OFF = /^\s*(best( regards)?|regards|kind regards|warm regards|thanks|thank you|many thanks|cheers|sincerely|respectfully|all the best|talk soon)\s*,\s*$/i;

const PHONE_LINE = /^[\s()+\-.\d]*\d{3}[\s)\-.]*\d{3}[\s\-.]*\d{4}\s*(x\d+)?\s*$/i;
const LABELLED_CONTACT = /^\s*(p|ph|phone|t|tel|m|mobile|cell|c|o|office|f|fax|e|email|w|web)\s*[:.|]\s*\S/i;
const EMAIL_LINE = /^\s*\S+@\S+\.\S+\s*$/;
const URL_LINE = /^\s*(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?\s*$/i;
const ADDRESS_LINE = /^\s*\d+\s+[\w .'-]+\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|way|pkwy|parkway)\b\.?(,.*)?\s*$/i;
const CITY_STATE_ZIP = /^\s*[a-z .'-]+,\s*[a-z]{2}\s+\d{5}(-\d{4})?\s*$/i;
const TITLE_LINE = /^\s*(leasing|property|community|assistant|regional|general)?\s*(manager|agent|consultant|coordinator|director|owner|landlord|office|specialist|associate|team)\b[\w ,&|-]*$/i;
const SEPARATOR_LINE = /^\s*[|_\-=*~]{2,}\s*$/;
const SOCIAL_LINK = /^\s*(linkedin|twitter|x|instagram|facebook|website|web|site|calendly|book a (tour|time|call))\b/i;
// "Wyatt Ogle (He/Him)", "Angela Clayton, CPM"
const PRONOUNS = /^\s*\((he|she|they|ze|xe)\/\w+\)\s*$/i;
const CREDENTIALS = /^\s*,?\s*[A-Z]{2,5}(,\s*[A-Z]{2,5})*\s*$/;

// Outlook writes links in plain text as "LinkedIn<https://...>".
function withoutInlineUrls(line) {
  return line.replace(/<[^>\s]+>/g, "").replace(/\[removed\]/g, "x@x.co");
}

function isContactPiece(piece) {
  const t = withoutInlineUrls(piece).trim();
  if (!t) return true;
  return (
    PHONE_LINE.test(t) ||
    LABELLED_CONTACT.test(t) ||
    EMAIL_LINE.test(t) ||
    URL_LINE.test(t) ||
    SOCIAL_LINK.test(t) ||
    TITLE_LINE.test(t) ||
    /^x@x\.co$/.test(t)
  );
}

function normalize(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+$/gm, "");
}

function isSignatureLine(line, names) {
  const t = line.trim();
  if (!t) return true;
  // "(314) 555-1234 | angela@keeley.com | LinkedIn<https://...>" runs long.
  const pieces = t.split(/\s*[|•·]\s*/);
  if (t.length <= 160 && pieces.length > 1 && pieces.every(isContactPiece)) return true;
  if (t.length > 80) return false;
  const lower = t.toLowerCase().replace(/[.,]$/, "");
  for (const n of names) {
    if (!n || !lower.startsWith(n)) continue;
    const rest = t.slice(n.length);
    if (!rest.trim() || PRONOUNS.test(rest) || CREDENTIALS.test(rest) || /^\s*[|,•·-]/.test(rest)) return true;
  }
  return (
    isContactPiece(t) ||
    ADDRESS_LINE.test(t) ||
    CITY_STATE_ZIP.test(t) ||
    SEPARATOR_LINE.test(t)
  );
}

/** Rough text from an HTML-only email: quotes dropped, blocks become lines. */
export function htmlToPlainText(html) {
  return String(html ?? "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    // Gmail, Apple Mail, Outlook and Yahoo quote containers.
    .replace(/<div[^>]+class="?[^">]*gmail_quote[\s\S]*$/i, "")
    .replace(/<blockquote[\s\S]*$/i, "")
    .replace(/<div[^>]+id="?(divRplyFwdMsg|appendonsend)[\s\S]*$/i, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// "Ogle, Wyatt" as written by Outlook directories, plus "Wyatt Ogle".
function nameVariants(value) {
  const full = String(value ?? "").trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (!full) return [];
  const out = [full, full.split(/\s+/)[0]];
  const comma = full.match(/^([^,]+),\s*(.+)$/);
  if (comma) out.push(`${comma[2]} ${comma[1]}`, comma[2].split(/\s+/)[0]);
  return out;
}

/**
 * @param {{ text?: string, html?: string, senderName?: string, senderCompany?: string, fromName?: string }} input
 *   fromName is the display name on the email itself, which can differ from
 *   the account name (a leasing office mailbox, a personal signature).
 * @returns {string} the reply as the person wrote it, possibly empty
 */
export function extractReplyText({ text, html, senderName, senderCompany, fromName } = {}) {
  let body = normalize(text && String(text).trim() ? text : htmlToPlainText(html));

  // 1. cut at the quoted original
  const wrote = body.match(ON_WROTE);
  if (wrote) body = body.slice(0, wrote.index);

  let lines = body.split("\n");
  let cut = lines.findIndex((l) => QUOTE_MARKERS.some((re) => re.test(l)));
  const outlook = outlookHeaderIndex(lines);
  if (outlook !== -1 && (cut === -1 || outlook < cut)) cut = outlook;
  if (cut !== -1) lines = lines.slice(0, cut);
  lines = lines.filter((l) => !/^\s*>/.test(l));

  // 2. signature
  const delimiter = lines.findIndex((l) => /^--\s?$/.test(l));
  if (delimiter !== -1) lines = lines.slice(0, delimiter);
  lines = lines.filter((l) => !MOBILE_FOOTERS.some((re) => re.test(l)));

  // Longest first, so "wyatt ogle" is tried before "wyatt".
  const names = [senderName, senderCompany, fromName]
    .flatMap(nameVariants)
    .sort((a, b) => b.length - a.length);
  while (lines.length > 0 && isSignatureLine(lines[lines.length - 1], names)) lines.pop();

  // 3. a sign-off with nothing after it
  while (lines.length > 0 && (SIGN_OFF.test(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) {
    lines.pop();
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
