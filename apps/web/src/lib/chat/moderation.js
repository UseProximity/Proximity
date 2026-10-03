/*
 * Content screening for in-app chat.
 *
 * Deliberately NOT lib/contentRules. Those rules police text that lands on a
 * public page: no personal names, no links, no phone numbers. Chat is private
 * correspondence between two people arranging a tour, so every one of those is
 * legitimate here. Running them would reject the composer's own prefilled
 * "Hi Max, I'm interested in this listing.", and would stop a landlord sending
 * an application link or a phone number, which is most of what chat is for.
 *
 * What actually goes wrong in a student housing marketplace is deposit fraud:
 * someone who does not hold the property collects money through a rail that
 * cannot be reversed, usually before any viewing. That is what this blocks.
 * Harassment and violent threats are blocked for the obvious reason.
 *
 * Three outcomes:
 *   block  the send is refused and the sender is told why
 *   flag   the message is delivered, and recorded for an admin to look at
 *   allow  nothing to say about it
 *
 * Precision matters more than recall. A false block breaks a real conversation
 * about a real apartment and the student never finds out the landlord replied,
 * which is worse than a fraud attempt that gets logged and reviewed. So a
 * payment rail on its own is only a flag: "we accept Zelle for monthly rent" is
 * a normal thing for a landlord to say. It escalates to a block when the
 * message also carries a money or urgency signal, which is what turns it into
 * "wire the deposit today".
 *
 * These are deterministic string checks, not a classifier. A hosted moderation
 * model is the real answer and is a follow-up, not a blocker: this covers the
 * unambiguous cases cheaply and offline, and logs the rest for a human.
 */

// Rails that have no legitimate use in a housing transaction. Nobody collects
// a security deposit in Steam cards.
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
 * The canonical rental scam narrative: the "landlord" cannot meet you, so pay
 * first and the keys arrive in the post. Strong enough that it is worth
 * blocking when it comes with a payment rail, and worth flagging on its own.
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

// Credential harvesting. An application link is fine; "sign in with your
// university password at this link" is not.
const PHISHING = [
  /\b(verify|confirm|re-?enter|update)\s*(your\s*)?(account|identity|password|credentials)\b/i,
  /\b(wustl|university|school)\s*(login|password|credentials)\b/i,
  /\byour\s*password\b/i,
  /\b(one[-\s]?time|2fa|two[-\s]?factor)\s*(code|passcode)\b/i,
  /\bsend\s*(me\s*)?(the\s*)?(code|otp)\b/i,
];

// Threats of violence and targeted abuse. Unambiguous phrasings only.
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
 * Leading and trailing word boundaries only, so it does not catch substrings of
 * innocent words.
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

// Flag-only patterns. Delivered, recorded, reviewed later.
const LINKS = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|info|xyz|ru|cn)\b/i;
const PHONE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const SSN_REQUEST = /\b(social\s*security|ssn)\b/i;

function matchesAny(patterns, text) {
  return patterns.some((re) => re.test(text));
}

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

  // ── blocks ────────────────────────────────────────────────────────────────
  if (matchesAny(SLURS, body)) reasons.push("slur");
  if (matchesAny(THREATS, body)) reasons.push("threat");
  if (matchesAny(RAILS_ALWAYS_BLOCK, body)) reasons.push("irreversible_payment_rail");
  if (matchesAny(PHISHING, body)) reasons.push("credential_phishing");

  const conditionalRail = matchesAny(RAILS_CONDITIONAL, body);
  const moneySignal = matchesAny(MONEY_SIGNALS, body);
  const scamNarrative = matchesAny(SCAM_NARRATIVE, body);

  // A rail plus a reason to send money, or a rail plus "I can't meet you", is
  // the deposit scam. Either on its own is not.
  if (conditionalRail && (moneySignal || scamNarrative)) {
    reasons.push("off_platform_payment_request");
  }

  const blocking = reasons.filter((r) =>
    [
      "slur",
      "threat",
      "irreversible_payment_rail",
      "credential_phishing",
      "off_platform_payment_request",
    ].includes(r)
  );

  if (blocking.length > 0) {
    return { action: "block", reasons: blocking, message: blockMessage(blocking) };
  }

  // ── flags ─────────────────────────────────────────────────────────────────
  if (conditionalRail) reasons.push("payment_rail_mentioned");
  if (scamNarrative) reasons.push("scam_narrative");
  if (LINKS.test(body)) reasons.push("external_link");
  if (PHONE.test(body)) reasons.push("phone_number");
  if (SSN_REQUEST.test(body)) reasons.push("ssn_mentioned");

  if (reasons.length > 0) return { action: "flag", reasons, message: null };
  return { action: "allow", reasons: [], message: null };
}

/*
 * What the sender sees. Says enough to correct an innocent message without
 * reading as a list of things to route around.
 */
function blockMessage(reasons) {
  if (reasons.includes("slur") || reasons.includes("threat")) {
    return "This message cannot be sent. Proximity does not carry abusive or threatening messages.";
  }
  if (reasons.includes("credential_phishing")) {
    return "This message cannot be sent because it asks for login details. Never share a password or a verification code in chat.";
  }
  return "This message cannot be sent because it asks for payment through a method Proximity cannot protect. Never send a deposit before signing a lease and seeing the unit.";
}

/** Attachment captions go through the same screen as a message body. */
export const screenChatCaption = screenChatText;
