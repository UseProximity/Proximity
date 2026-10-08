/*
 * Content screening for in-app chat.
 *
 * Deliberately NOT lib/contentRules. Those rules police text that lands on a
 * public page and forbid personal names, which would reject the composer's own
 * prefilled "Hi Max, I'm interested in this listing.". Chat is private
 * correspondence, so names are fine here and contact details are not, which is
 * close to the opposite rule.
 *
 * Two things are being prevented:
 *
 *   1. Deposit fraud. Someone who does not hold the property collects money
 *      through a rail that cannot be reversed, usually before any viewing.
 *   2. Taking the conversation off Proximity (Wyatt, 2026-10-03). Contact
 *      details are blocked rather than logged, in text and in attachments, so
 *      an inquiry cannot be moved to a channel the product cannot see.
 *
 * Harassment and violent threats are blocked for the obvious reason.
 *
 * Three outcomes:
 *   block  the send is refused and the sender is told why
 *   flag   the message is delivered, and recorded for an admin to look at
 *   allow  nothing to say about it
 *
 * The cost of (2) is accepted and real: a landlord sending a genuine
 * application link or an office number is refused. That is why the blocked
 * message copy explains where to put the information instead, and why
 * ALLOWED_LINK_HOSTS exists and is meant to grow. Keep the allowlist to hosts
 * that cannot be used to collect a student's contact details.
 *
 * These are deterministic string checks, not a classifier. Attachments are a
 * different problem and go to a vision model, see lib/chat/scanAttachment.js.
 */

// ─────────────────────────────────────────────────────── off-platform contact

/*
 * Links to these hosts are not an attempt to leave the platform. Subdomains
 * count. Everything else is blocked, including application portals, which is
 * the deliberate cost of the policy above.
 */
const ALLOWED_LINK_HOSTS = ["useproximity.org", "wustl.edu"];

// Any email address, whatever the domain. "email me at x@wustl.edu" is still
// moving the conversation off Proximity.
const EMAIL_PLAIN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/*
 * The same thing written to get past a filter: "landlord AT gmail DOT com",
 * "name (at) place [dot] org".
 *
 * At least ONE of the two separators has to be an actual obfuscation, either
 * the spelled-out word or a bracketed form. Accepting a plain "at" together
 * with a plain "." matched ordinary prose: "check the housing office at
 * wustl.edu" parsed as user "office", host "wustl", TLD "edu", which blocked a
 * sentence about the university and defeated the link allowlist at the same
 * time. A genuine address written normally is caught by EMAIL_PLAIN anyway.
 */
const USER_PART = "[a-z0-9._%+-]+";
const HOST_PART = "[a-z0-9-]+";
const TLD_PART = "(?:com|net|org|edu|io|co|gov|us)";
const AT_ANY = "(?:\\(\\s*at\\s*\\)|\\[\\s*at\\s*\\]|\\{\\s*at\\s*\\}|@|\\bat\\b)";
const AT_MARKED = "(?:\\(\\s*at\\s*\\)|\\[\\s*at\\s*\\]|\\{\\s*at\\s*\\})";
const DOT_ANY = "(?:\\(\\s*dot\\s*\\)|\\[\\s*dot\\s*\\]|\\{\\s*dot\\s*\\}|\\bdot\\b|\\.)";
const DOT_MARKED = "(?:\\(\\s*dot\\s*\\)|\\[\\s*dot\\s*\\]|\\{\\s*dot\\s*\\}|\\bdot\\b)";

const EMAIL_OBFUSCATED = new RegExp(
  // the dot is spelled out or bracketed
  `${USER_PART}\\s*${AT_ANY}\\s*${HOST_PART}\\s*${DOT_MARKED}\\s*${TLD_PART}\\b`
    // or the at is bracketed
    + `|${USER_PART}\\s*${AT_MARKED}\\s*${HOST_PART}\\s*${DOT_ANY}\\s*${TLD_PART}\\b`,
  "i"
);

// Ten digits with any common separator, with or without a country code.
const PHONE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;

/*
 * Messaging platforms. Bare "snap", "ig" and "fb" are deliberately absent:
 * "send me a snap of the kitchen" is a normal request about a listing and
 * blocking it would be a bad false positive.
 */
const PLATFORMS =
  /\b(instagram|snapchat|whats\s?app|telegram|discord|tik\s?tok|facebook|messenger|wechat|kik|signal\s+app)\b/i;

// Asking to be reached somewhere. Pairs with a platform or a handle.
const CONTACT_INTENT =
  /\b(dm\s*me|dm'?ing|add\s*me|find\s*me\s*on|follow\s*me|reach\s*me|contact\s*me|hit\s*me\s*up|my\s*(handle|username|number|email)\s*is)\b/i;

const SOCIAL_HANDLE = /(?:^|\s)@[a-z][a-z0-9._]{2,}/i;

// Explicitly proposing to continue elsewhere, even with no details attached.
const OFF_PLATFORM_REQUEST = [
  /\b(off|outside)\s*(of\s*)?(the\s*)?(platform|app|site|website|proximity)\b/i,
  /\b(move|take|continue|finish)\s*(this|that|the)?\s*(conversation|chat|thread|discussion)?\s*(off|outside|elsewhere|somewhere\s*else)\b/i,
  /\b(email|text|call|message|phone)\s*me\s*(instead|directly|rather)\b/i,
  /\b(don'?t|do\s*not|no\s*need\s*to)\s*(use|reply\s*on|message\s*(me\s*)?on)\s*(this|the)\s*(app|site|platform)\b/i,
];

// ───────────────────────────────────────────────────────────── deposit fraud

// Rails with no legitimate use in a housing transaction.
const RAILS_ALWAYS_BLOCK = [
  /\bgift\s*cards?\b/i,
  /\b(steam|itunes|google\s*play|amazon)\s*(gift\s*)?cards?\b/i,
  /\bgreen\s*dot\b/i,
  /\bwestern\s*union\b/i,
  /\bmoney\s*gram\b/i,
  /\b(bitcoin|btc|ethereum|eth|usdt|tether|crypto(currency)?)\b/i,
];

// Rails a real landlord might genuinely use. Only a problem in context.
const RAILS_CONDITIONAL = [
  /\bzelle\b/i,
  /\bvenmo\b/i,
  /\bcash\s*app\b/i,
  /\bcashapp\b/i,
  /\bpay\s*pal\b/i,
  /\bpaypal\b/i,
  /\bwire\s*(transfer|the|me|funds|money)\b/i,
  /\bmoney\s*order\b/i,
  /\bcashier'?s\s*che(ck|que)\b/i,
];

// Money changing hands, or pressure to make it change hands quickly.
const MONEY_SIGNALS = [
  /\$\s?\d/,
  /\b\d+\s*(dollars|usd)\b/i,
  /\b(security\s*)?deposit\b/i,
  /\bfirst\s*(and\s*last\s*)?month'?s?\b/i,
  /\bholding\s*(fee|deposit)\b/i,
  /\bapplication\s*fee\b/i,
  /\breservation\s*fee\b/i,
  /\bup\s*front\b/i,
  /\bupfront\b/i,
  /\bto\s*(hold|reserve|secure)\s*(the\s*)?(unit|apartment|place|room)\b/i,
];

/*
 * The canonical rental scam narrative: the landlord cannot meet you, so pay
 * first and the keys arrive in the post.
 */
const SCAM_NARRATIVE = [
  /\bout\s*of\s*the\s*country\b/i,
  /\bcurrently\s*(abroad|overseas|out\s*of\s*state)\b/i,
  /\bmail\s*(you\s*)?the\s*keys\b/i,
  /\bkeys?\s*(will\s*be\s*)?(mailed|shipped|couriered|sent)\b/i,
  /\bsight\s*unseen\b/i,
  /\bwithout\s*(a\s*)?(viewing|tour|seeing)\b/i,
  /\bno\s*need\s*to\s*(tour|view|visit|see)\b/i,
  /\bmissionar(y|ies)\b/i,
];

// Credential harvesting.
const PHISHING = [
  /\b(verify|confirm|re-?enter|update)\s*(your\s*)?(account|identity|password|credentials)\b/i,
  /\b(wustl|university|school)\s*(login|password|credentials)\b/i,
  /\byour\s*password\b/i,
  /\b(one[-\s]?time|2fa|two[-\s]?factor)\s*(code|passcode)\b/i,
  /\bsend\s*(me\s*)?(the\s*)?(code|otp)\b/i,
];

// ────────────────────────────────────────────────────────────── abuse

const THREATS = [
  /\bi('?m| am| will|'ll)?\s*(going to\s*)?(kill|murder|shoot|stab)\s*(you|u)\b/i,
  /\bkill\s*your\s*self\b/i,
  /\bkys\b/i,
  /\bi\s*(know|found out)\s*where\s*you\s*(live|sleep|work)\b/i,
  /\bwatch\s*your\s*back\b/i,
  /\byou'?re?\s*dead\b/i,
  /\bi('?ll| will)\s*(hurt|beat|assault|rape)\s*(you|u)\b/i,
  /\bburn\s*(your|ur)\s*(house|place|apartment)\s*down\b/i,
];

/*
 * Slurs. Kept to terms that are slurs in effectively every context, because a
 * list that reaches for borderline words starts blocking real conversations.
 */
const SLURS = [
  /\bn[i1]gg(er|a|ers|as)\b/i,
  /\bf[a4]gg?(ot|ots|s)?\b/i,
  /\bk[i1]ke\b/i,
  /\bch[i1]nk\b/i,
  /\bsp[i1]c\b/i,
  /\btr[a4]nn(y|ies)\b/i,
  /\bret[a4]rd(ed|s)?\b/i,
  /\bw[e3]tb[a4]ck\b/i,
];

const SSN_REQUEST = /\b(social\s*security|ssn)\b/i;

/*
 * Hosts in the text that are not on the allowlist. Emails are stripped first
 * so an address does not also report as a link, and the TLD list is explicit
 * so "St. Louis", "1.5 baths" and "sq.ft" do not read as domains.
 */
const LINK_CANDIDATE =
  /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+(?:com|net|org|io|co|info|xyz|ru|cn|edu|gov|us|app|dev|me|biz|site|online|link|shop))\b/gi;

function disallowedLinkHosts(text) {
  const withoutEmails = text
    .replace(new RegExp(EMAIL_PLAIN.source, "gi"), " ")
    .replace(new RegExp(EMAIL_OBFUSCATED.source, "gi"), " ");

  const hosts = [];
  for (const match of withoutEmails.matchAll(LINK_CANDIDATE)) {
    const host = match[1].toLowerCase();
    const allowed = ALLOWED_LINK_HOSTS.some(
      (ok) => host === ok || host.endsWith(`.${ok}`)
    );
    if (!allowed) hosts.push(host);
  }
  return hosts;
}

function matchesAny(patterns, text) {
  return patterns.some((re) => re.test(text));
}

const BLOCKING_REASONS = new Set([
  "slur",
  "threat",
  "irreversible_payment_rail",
  "credential_phishing",
  "off_platform_payment_request",
  "contact_email",
  "contact_phone",
  "external_link",
  "social_handle",
  "off_platform_request",
]);

/**
 * Screen a chat message body.
 *
 * @param {string} text raw message body as typed
 * @returns {{ action: "block"|"flag"|"allow", reasons: string[], message: string|null }}
 *   `message` is copy to show the sender, and is only set when action is block.
 */
export function screenChatText(text) {
  const body = String(text ?? "");
  if (!body.trim()) return { action: "allow", reasons: [], message: null };

  const reasons = [];

  // ── abuse and fraud ───────────────────────────────────────────────────────
  if (matchesAny(SLURS, body)) reasons.push("slur");
  if (matchesAny(THREATS, body)) reasons.push("threat");
  if (matchesAny(RAILS_ALWAYS_BLOCK, body)) reasons.push("irreversible_payment_rail");
  if (matchesAny(PHISHING, body)) reasons.push("credential_phishing");

  const conditionalRail = matchesAny(RAILS_CONDITIONAL, body);
  const moneySignal = matchesAny(MONEY_SIGNALS, body);
  const scamNarrative = matchesAny(SCAM_NARRATIVE, body);

  // A rail plus a reason to send money, or a rail plus "I cannot meet you", is
  // the deposit scam. Either on its own is not.
  if (conditionalRail && (moneySignal || scamNarrative)) {
    reasons.push("off_platform_payment_request");
  }

  // ── off-platform contact ──────────────────────────────────────────────────
  if (EMAIL_PLAIN.test(body) || EMAIL_OBFUSCATED.test(body)) {
    reasons.push("contact_email");
  }
  if (PHONE.test(body)) reasons.push("contact_phone");
  if (disallowedLinkHosts(body).length > 0) reasons.push("external_link");

  const hasPlatform = PLATFORMS.test(body);
  const hasIntent = CONTACT_INTENT.test(body);
  const hasHandle = SOCIAL_HANDLE.test(body);
  if ((hasPlatform && hasIntent) || (hasHandle && (hasIntent || hasPlatform))) {
    reasons.push("social_handle");
  }

  if (matchesAny(OFF_PLATFORM_REQUEST, body)) reasons.push("off_platform_request");

  const blocking = reasons.filter((r) => BLOCKING_REASONS.has(r));
  if (blocking.length > 0) {
    return { action: "block", reasons: blocking, message: blockMessage(blocking) };
  }

  // ── flags ─────────────────────────────────────────────────────────────────
  if (conditionalRail) reasons.push("payment_rail_mentioned");
  if (scamNarrative) reasons.push("scam_narrative");
  if (hasPlatform) reasons.push("platform_mentioned");
  if (SSN_REQUEST.test(body)) reasons.push("ssn_mentioned");

  if (reasons.length > 0) return { action: "flag", reasons, message: null };
  return { action: "allow", reasons: [], message: null };
}

/*
 * What the sender sees. For a contact-detail block this has to say where the
 * information belongs instead, otherwise a landlord sharing an office number
 * in good faith just hits a wall and gives up on the thread.
 */
function blockMessage(reasons) {
  if (reasons.includes("slur") || reasons.includes("threat")) {
    return "This message cannot be sent. Proximity does not carry abusive or threatening messages.";
  }
  if (reasons.includes("credential_phishing")) {
    return "This message cannot be sent because it asks for login details. Never share a password or a verification code in chat.";
  }
  if (
    reasons.includes("irreversible_payment_rail") ||
    reasons.includes("off_platform_payment_request")
  ) {
    return "This message cannot be sent because it asks for payment through a method Proximity cannot protect. Never send a deposit before signing a lease and seeing the unit.";
  }
  return "Phone numbers, email addresses, outside links and social handles cannot be sent in chat";
}

/** Attachment captions go through the same screen as a message body. */
export const screenChatCaption = screenChatText;

export { ALLOWED_LINK_HOSTS };
