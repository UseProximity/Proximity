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
 *      If that trailing block is the whole reply (a student answering "what's
 *      your number?" with just the number), it is the message, so it stays
 *      (Wyatt, 2026-10-24). So does a block that is only phone numbers, or
 *      that follows "My number is:".
 *      A sign-off with a name under it ("Thanks,\nAddison") is kept, and
 *      everything below the name goes, whoever's name it is (Wyatt, 2026-11-18).
 *      A short name or company block left over a removed signature goes too,
 *      since a leasing office's signer is often not the account holder.
 *   3. A dangling sign-off left at the end ("Best,", "Regards,"). A sign-off that
 *      is a sentence ("Thanks!") stays, because it is part of the message.
 *
 * Gmail's plain-text copy writes bold as *asterisks*, so they are ignored when
 * deciding whether a line belongs to a signature.
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
const LABELLED_CONTACT = /^\s*(p|ph|phone|t|tel|text|sms|call|m|mobile|cell|c|o|office|f|fax|e|email|w|web)\s*[:.|]\s*\S/i;
const EMAIL_LINE = /^\s*\S+@\S+\.\S+\s*$/;
const URL_LINE = /^\s*(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?\s*$/i;
// "ClockTowerCompany.com - Apply Here": a website with a short button label.
const URL_WITH_LABEL = /^\s*(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?\s*[-|:]\s*[\w '&]{1,25}$/i;
const ADDRESS_LINE = /^\s*\d+\s+[\w .'-]+\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|way|pkwy|parkway)\b\.?(,.*)?\s*$/i;
const CITY_STATE_ZIP = /^\s*[a-z .'-]+,\s*[a-z]{2}\s+\d{5}(-\d{4})?\s*$/i;
const TITLE_LINE = /^\s*(leasing|property|community|assistant|regional|general)?\s*(manager|agent|consultant|coordinator|director|owner|landlord|office|specialist|associate|team)\b[\w ,&|-]*$/i;
const SEPARATOR_LINE = /^\s*[|_\-=*~]{2,}\s*$/;
const SOCIAL_LINK = /^\s*(linkedin|twitter|x|instagram|facebook|website|web|site|portfolio|github|blog|calendly|book a (tour|time|call))\b/i;
// Any short label Outlook wrote as a link, "Portfolio<https://...>".
const LINKED_LABEL = /^\s*[\w .&'-]{1,30}<https?:\/\/[^>\s]+>\s*$/i;
// "Wyatt Ogle (He/Him)", "Angela Clayton, CPM"
const PRONOUNS = /^\s*\((he|she|they|ze|xe)\/\w+\)\s*$/i;
const CREDENTIALS = /^\s*,?\s*[A-Z]{2,5}(,\s*[A-Z]{2,5})*\s*$/;

// "Wyatt Ogle", "Mary-Kate O'Neil": two or three capitalised words, nothing else.
const PERSON_NAME = /^[A-Z][a-zA-Z'.-]+(?: [A-Z][a-zA-Z'.-]+){1,2}$/;
// The name under a sign-off: "Addison" alone counts there.
const SIGNER_NAME = /^[A-Z][a-zA-Z'.-]+(?: [A-Z][a-zA-Z'.-]+){0,2}$/;
// "Addison Witte", "Clock Tower Company": up to four capitalised words.
const NAME_OR_COMPANY = /^[A-Z][a-zA-Z'.&-]*(?: [A-Z&][a-zA-Z'.&-]*){0,3}$/;

// Gmail's plain-text bold: "*Clock Tower Company*", or a "*" left at the end
// of a wrapped link line.
function unbold(line) {
  return String(line ?? "").trim().replace(/^\*+|\*+$/g, "").trim();
}

// Outlook writes links in plain text as "LinkedIn<https://...>".
function withoutInlineUrls(line) {
  return line.replace(/<[^>\s]+>/g, "").replace(/\[removed\]/g, "x@x.co");
}

function isContactPiece(piece) {
  if (LINKED_LABEL.test(piece)) return true;
  const t = withoutInlineUrls(piece).trim();
  if (!t) return true;
  return (
    PHONE_LINE.test(t) ||
    LABELLED_CONTACT.test(t) ||
    EMAIL_LINE.test(t) ||
    URL_LINE.test(t) ||
    URL_WITH_LABEL.test(t) ||
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
  const t = unbold(line);
  if (!t) return true;
  // "P.S. Bring a photo ID" is message, not a "P." phone label.
  if (/^P\.?\s?S\b/i.test(t)) return false;
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

// "Cell: 314-555-0123" as well as the bare number.
function isPhoneOnly(line) {
  return PHONE_LINE.test(unbold(line).replace(/^\s*(p|ph|phone|t|tel|text|sms|call|m|mobile|cell|c)\s*[:.|]\s*/i, ""));
}

/*
 * "Thanks,\nAddison" with a signature under it: the index of the name line, so
 * the reply ends there. Only when what follows the name looks like a
 * signature (or nothing follows), so a P.S. or more message is never cut.
 */
function signedNameIndex(lines, names) {
  for (let i = lines.length - 2; i >= 0; i--) {
    if (!SIGN_OFF.test(lines[i]) || !SIGNER_NAME.test(unbold(lines[i + 1]))) continue;
    const tail = lines.slice(i + 2).filter((l) => l.trim());
    if (tail.length === 0) return i + 1;
    if (tail.length > 12 || tail.some((l) => /^\s*\*?P\.?\s?S\b/i.test(l) || l.length > 120)) return -1;
    return tail.some((l) => isSignatureLine(l, names)) ? i + 1 : -1;
  }
  return -1;
}

/*
 * A trailing "signature" that is really the answer to "what's your number?":
 * nothing in it but phone numbers (a real signature also carries a name, title
 * or email), or it follows a line ending in a colon ("My number is:"). Kept so
 * the number reaches moderation, which posts it with a guidelines notice rather
 * than it vanishing as a signature (Wyatt, 2026-10-24).
 */
function isAnsweredNumber(kept, removed) {
  const filled = removed.filter((l) => l.trim());
  if (!filled.some(isPhoneOnly)) return false;
  if (filled.every(isPhoneOnly)) return true;
  const lead = kept.filter((l) => l.trim()).at(-1) ?? "";
  return /:\s*$/.test(lead);
}

/** Rough text from an HTML-only email: quotes dropped, blocks become lines. */
export function htmlToPlainText(html) {
  return String(html ?? "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    // Gmail, Apple Mail, Outlook and Yahoo quote containers.
    .replace(/<div[^>]+class="?[^">]*gmail_quote[\s\S]*$/i, "")
    .replace(/<blockquote[\s\S]*$/i, "")
    .replace(/<div[^>]+id="?(divRplyFwdMsg|appendonsend)[\s\S]*$/i, "")
    // iPhone Mail writes <br id="lineBreakAtBeginningOfSignature"> and opens
    // the "Sent from my iPhone" block with a <div>, so tags with attributes and
    // opening block tags both have to break the line.
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|li|tr|h[1-6])\b[^>]*>/gi, "\n")
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
  const signed = signedNameIndex(lines, names);
  if (signed !== -1) {
    lines = lines.slice(0, signed + 1);
    lines[signed] = unbold(lines[signed]);
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const beforeSignature = lines;
  lines = lines.slice();
  while (lines.length > 0 && isSignatureLine(lines[lines.length - 1], names)) lines.pop();
  // A bare "First Last" left standing over a signature that went is its name
  // line, even when the display name differs from the account (2026-11-01).
  // So is a "First Last" / "Company Name" block of up to three such lines, as
  // long as a blank line sets it apart from the message or Gmail bolded it
  // (2026-11-18).
  const removedSome = beforeSignature.slice(lines.length).some((l) => l.trim());
  if (removedSome) {
    let top = lines.length;
    while (top > 0 && lines.length - top < 3 && NAME_OR_COMPANY.test(unbold(lines[top - 1]))) top--;
    const block = lines.slice(top);
    // Bolded whole lines ("*Clock Tower Company*") are a signature's own
    // styling, so they go even with no blank line above.
    const bolded = block.length > 0 && block.every((l) => /^\s*\*[^*]+\*\s*$/.test(l));
    const spaced = block.length > 0 && top > 0 && !lines[top - 1].trim() && block.some((l) => PERSON_NAME.test(unbold(l)));
    if (bolded || spaced) {
      lines = lines.slice(0, top);
    }
  }
  if (!lines.some((l) => l.trim()) || isAnsweredNumber(lines, beforeSignature.slice(lines.length))) {
    lines = beforeSignature;
  }

  // 3. a sign-off with nothing after it
  while (lines.length > 0 && (SIGN_OFF.test(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) {
    lines.pop();
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
