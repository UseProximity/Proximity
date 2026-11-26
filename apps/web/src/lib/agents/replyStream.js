/*
 * Reading Proxy's answer while the model is still writing it (Wyatt,
 * 2026-11-11: show the reply as it is written).
 *
 * Proxy answers by calling the `final` tool, whose input arrives as JSON in
 * pieces. scanFinalJson reads whatever has arrived so far: the top-level
 * fields that are complete, and the reply text written so far (an unfinished
 * string the SDK's partial parser drops).
 *
 * replyStreamer decides whether to show that text at all. The reply streams
 * only once intent, answered_keys and unanswered_questions are complete, because
 * when nothing could be answered and the question goes to the landlord, the
 * student gets one fixed line instead of the model's words, and seeing
 * "I don't have that" type out and then change would read as a glitch.
 */

/*
 * Intents whose reply is the model's own words even when nothing in the
 * knowledge base was used and the landlord is asked: small talk, and a
 * student who wants to apply or negotiate (Wyatt, 2026-11-11: "I'd like to
 * apply" used to get "I don't have that yet"). proxy.js and replyStreamer
 * both read it, so what streams is what is saved.
 */
export const KEEPS_OWN_REPLY = new Set(["small_talk", "apply", "negotiate"]);

/*
 * The final tool's input in the shape proxy.js expects. Eager streaming turns
 * off the API's check of the input against the schema, so a field of the wrong
 * type is fixed or dropped here instead of throwing after the student's
 * message is saved. Returns null when there is no input at all.
 */
export function normalizeFinal(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    ...input,
    intent: typeof input.intent === "string" ? input.intent : "question",
    answered_keys: list(input.answered_keys).filter((k) => typeof k === "string"),
    unanswered_questions: list(input.unanswered_questions)
      .map((u) => (typeof u === "string" ? { question: u, lease_number: 0 } : u && typeof u === "object" ? u : null))
      .filter((u) => u && typeof u.question === "string" && u.question.trim()),
    reply: typeof input.reply === "string" ? input.reply : "",
    offered_question: typeof input.offered_question === "string" ? input.offered_question : "",
    nudged: input.nudged === true,
    clarifier_reply: input.clarifier_reply === true,
  };
}

// Same as stripEmDashes in model.js, kept here so this file has no imports (it is unit tested).
const noEmDash = (t) => t.replace(/\s*\u2014\s*/g, ", ");

/* Decodes the inside of a JSON string that may stop part way through. */
function decodePartialString(inner) {
  // Drop an escape that has not fully arrived ("\", "\u00").
  const cut = inner.replace(/\\u[0-9a-fA-F]{0,3}$/, "").replace(/(^|[^\\])((?:\\\\)*)\\$/, "$1$2");
  try { return JSON.parse(`"${cut}"`); } catch { return null; }
}

export function scanFinalJson(src) {
  const done = {};
  let depth = 0;
  let inStr = false;
  let esc = false;
  let phase = "start"; // at depth 1: key-wait, key, colon, value, in-value
  let key = null;
  let keyStart = -1;
  let valStart = -1;
  const finish = (end) => {
    try { done[key] = JSON.parse(src.slice(valStart, end).trim()); } catch {}
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') {
        inStr = false;
        if (depth === 1 && phase === "key") {
          try { key = JSON.parse(src.slice(keyStart, i + 1)); } catch { key = null; }
          phase = "colon";
        }
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      if (depth === 1 && phase === "key-wait") { keyStart = i; phase = "key"; }
      else if (depth === 1 && phase === "value") { valStart = i; phase = "in-value"; }
      continue;
    }
    if (c === "{" || c === "[") {
      if (depth === 1 && phase === "value") { valStart = i; phase = "in-value"; }
      depth++;
      if (depth === 1) phase = "key-wait";
      continue;
    }
    if (c === "}" || c === "]") {
      depth--;
      if (depth === 0 && phase === "in-value") { finish(i); phase = "end"; }
      continue;
    }
    if (depth !== 1) continue;
    if (c === ":" && phase === "colon") phase = "value";
    else if (c === "," && phase === "in-value") { finish(i); phase = "key-wait"; }
    else if (phase === "value" && !/\s/.test(c)) { valStart = i; phase = "in-value"; }
  }

  let reply = typeof done.reply === "string" ? done.reply : null;
  if (reply == null && key === "reply" && phase === "in-value" && src[valStart] === '"') {
    const rest = src.slice(valStart + 1);
    reply = inStr ? decodePartialString(rest) : decodePartialString(rest.replace(/"\s*$/, ""));
  }
  return { done, reply };
}

/*
 * Returns a function to call with the final tool's raw JSON so far; it calls
 * onDelta with each new piece of reply text worth showing.
 *   isUsedKey(key)  whether an answered key is a real fact
 *   canAsk          whether unanswered questions will go to the landlord
 */
export function replyStreamer({ onDelta, isUsedKey, canAsk }) {
  let show = null;
  let sent = "";
  return (raw) => {
    const { done, reply } = scanFinalJson(raw);
    if (show === null) {
      if (!("intent" in done) || !("answered_keys" in done) || !("unanswered_questions" in done)) return;
      const used = (Array.isArray(done.answered_keys) ? done.answered_keys : []).filter(isUsedKey);
      const asks = (Array.isArray(done.unanswered_questions) ? done.unanswered_questions : []).filter((u) => String(u?.question ?? "").trim());
      // Mirrors "nothingAnswered" in proxy.js: that reply is replaced by one fixed line.
      // Nothing can go to the landlord: any reply may carry a claim that it did, which is
      // cut before saving, so show nothing until the saved reply (no claim flashing up).
      show = canAsk && !(asks.length && !used.length && !KEEPS_OWN_REPLY.has(done.intent));
    }
    if (!show || !reply) return;
    // Trailing spaces wait for the next word: "online " becomes "online, "
    // once an em dash after it arrives and is replaced.
    const clean = noEmDash(reply).trimEnd();
    // Only ever add to what is on screen; the saved message settles any difference.
    if (clean.length > sent.length && clean.startsWith(sent)) {
      onDelta(clean.slice(sent.length));
      sent = clean;
    }
  };
}

/*
 * Sentences claiming Proxy asked (or will ask) the landlord, cut from a reply
 * when nothing can be sent: a landlord testing their own listing, a visitor
 * over the daily limit. The model is told not to say it and sometimes does
 * anyway (Rosebury, 2026-11-18). Returns { text, removed }.
 *
 * The asking verb has to point at the landlord, so "I've checked the listing
 * and the landlord doesn't allow pets" stays. A sentence that says nothing was
 * sent ("I can't pass this on to the landlord") is true and stays too. Only
 * the claiming clause goes: "The fee is $50, and I've asked the landlord
 * about parking." keeps "The fee is $50."
 */
const WHO = String.raw`(?:landlord|owner|property manager|leasing office|management)`;
const ME = String.raw`\b(?:I|I've|I have|I'll|I will|I'm|I am|we've|we have|we'll|we will)\b`;
const ASK_CLAIMS = [
  // "I've passed your question about parking to the landlord", "I'm checking with the owner"
  new RegExp(String.raw`${ME}[^.!?]*?\b(?:ask(?:ed|ing)?|pass(?:ed|ing)?|sen[dt]|sending|forward(?:ed|ing)?|relay(?:ed|ing)?|reach(?:ed|ing)? out to|contact(?:ed|ing)?|check(?:ed|ing)? with)\b\s+(?:[\w$',]+\s+){0,20}?(?:the |your |this )?${WHO}\b`, "i"),
  // "I've let the landlord know you'd like to apply", "I'll let the owner know"
  new RegExp(String.raw`${ME}[^.!?]*?\blet(?:ting)? (?:the |your |this )?${WHO} know\b`, "i"),
  // "I've passed it along"
  /\b(?:I|I've|I have|I'll|I will|I'm|I am)\b[^.!?]*?\bpass(?:ed|ing)? (?:it|this|that|your \w+) (?:along|on)\b/i,
  // "Your question has been sent to the landlord", "The owner has been notified"
  new RegExp(String.raw`\b(?:has|have|had)? ?(?:been|was|were|is being)\s+(?:sent|passed|forwarded|shared|relayed)\b[^.!?]*\b${WHO}\b`, "i"),
  new RegExp(String.raw`\b${WHO}\s+(?:has been|have been|was|is being)\s+(?:asked|notified|contacted|told|messaged)\b`, "i"),
  /(?:\bwill|'ll) (?:post|let you know|share|update you)\b[^.!?]*\b(?:answer|respond|response|reply|hear)/i,
  // "Once they respond, I'll post it here", not "Once they respond to your application, you'll sign the lease online."
  /\b(?:when|once) (?:they|the landlord|the owner) (?:respond|repl(?:y|ies|ied)|answer|gets? back)\w*\b[^.!?]*\b(?:here|I'll|I will|let you know|update you|you'll (?:see|get|hear))\b/i,
];
/*
 * Says nothing was sent. The negation has to govern the asking verb: "I can't
 * pass this on" is true, but in "Parking isn't listed, so I've asked the
 * landlord" the negation is about the listing and the claim is still false.
 */
const SAYS_NOT_SENT = new RegExp(String.raw`\b(?:(?:can'?t|cannot|won'?t|haven'?t|hasn'?t|didn'?t|wasn'?t|weren'?t|isn'?t|aren'?t|(?:un|not )able to|not)\s+(?:\w+\s+){0,2}?(?:ask|pass|send|sent|forward|relay|reach|contact|check with|let|share|shared|notif)|nothing (?:was|is|has been|will be|gets|got) (?:sent|passed|forwarded|shared|relayed))`, "i");
export const saysNothingSent = (t) => SAYS_NOT_SENT.test(String(t ?? "").replace(/[‘’]/g, "'"));
const LEAD_IN = /^(\s*)(?:in the meantime|meanwhile|until then|while you wait),?\s+(\w)/i;
// A full stop after these is not the end of a sentence ("St. Louis", "Apt. 3").
const ABBREV = /(?:^|[\s(])(?:St|Ave|Apt|Blvd|Rd|Dr|Ct|Ln|Ste|Bldg|Mr|Mrs|Ms|Jr|Sr|approx|vs|etc|e\.g|i\.e)\.$/;
// "No." and a lone capital ("Apt N.") end a sentence, unless a number follows ("No. 5").
const ABBREV_BEFORE_NUMBER = /(?:^|[\s(])(?:No|[A-Z])\.$/;

// Sentences, splitting only where a full stop is followed by a space and a capital
// (or a new line), so prices, decimals and abbreviations stay whole.
function sentencesOf(text) {
  const out = [];
  const re = /[.!?]+["')\]]*\s+|\n+/g;
  let start = 0;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (m[0][0] !== "\n") {
      if (end < text.length && !/[A-Z0-9"'(\[$]/.test(text[end])) continue;
      const before = text.slice(start, m.index + 1);
      if (ABBREV.test(before)) continue;
      if (ABBREV_BEFORE_NUMBER.test(before) && /[0-9]/.test(text[end] ?? "")) continue;
    }
    out.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

const flat = (s) => s.replace(/[‘’]/g, "'");
const isClaim = (s) => ASK_CLAIMS.some((re) => re.test(flat(s))) && !SAYS_NOT_SENT.test(flat(s));

/*
 * What is left of a claiming sentence: the clauses before the claim. Pieces
 * are clauses (", and", ", so", ", but", ";") and any full stop, abbreviation
 * or not, so "6609 Delmar Blvd. I've asked the landlord" keeps the address.
 * Everything from the claiming piece on goes (what follows usually carries the
 * claim on: "..., and they'll get back to you"). When no single piece is a
 * claim (it spans them), the whole sentence goes.
 */
const PIECE_BREAK = /(,\s+(?:and|so|but)\s+|;\s+|[.!?]+["')\]]*\s+(?=[A-Z0-9"'(\[$]))/;
function beforeClaim(sentence) {
  const parts = sentence.split(PIECE_BREAK);
  const at = parts.findIndex((p, i) => i % 2 === 0 && isClaim(p));
  if (at <= 0) return "";
  let kept = parts.slice(0, at - 1).join("");
  const sep = parts[at - 1];
  if (/^[.!?]/.test(sep)) return kept + sep.trimEnd();
  kept = kept.replace(/[\s,;:]+$/, "");
  if (!kept) return "";
  const end = sentence.trimEnd().match(/[.!?]+["')\]]*$/)?.[0] ?? ".";
  return `${kept}${/[.!?]$/.test(end) ? end.replace(/["')\]]+$/, "") : end}`;
}

export function withoutAskClaims(text) {
  const src = String(text ?? "");
  const kept = [];
  let removed = false;
  let afterCut = false;
  for (const s of sentencesOf(src)) {
    if (/^\n+$/.test(s)) { kept.push(s); continue; }
    if (isClaim(s)) {
      removed = true;
      afterCut = true;
      const rest = beforeClaim(s.trimEnd());
      if (rest) kept.push(`${rest}${s.match(/\s*$/)[0] || " "}`);
      continue;
    }
    // "In the meantime, tour first" means nothing once the asking before it is gone.
    kept.push(afterCut ? s.replace(LEAD_IN, (_, sp, c) => sp + c.toUpperCase()) : s);
    afterCut = false;
  }
  if (!removed) return { text: src, removed };
  return { text: kept.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}
