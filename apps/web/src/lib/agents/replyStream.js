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
 * only once answered_keys and unanswered_questions are complete, because
 * when nothing could be answered and the question goes to the landlord, the
 * student gets one fixed line instead of the model's words, and seeing
 * "I don't have that" type out and then change would read as a glitch.
 */

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
      if (!("answered_keys" in done) || !("unanswered_questions" in done)) return;
      const used = (Array.isArray(done.answered_keys) ? done.answered_keys : []).filter(isUsedKey);
      const asks = (Array.isArray(done.unanswered_questions) ? done.unanswered_questions : []).filter((u) => String(u?.question ?? "").trim());
      // Mirrors "nothingAnswered" in proxy.js: that reply is replaced by one fixed line.
      show = !(canAsk && asks.length && !used.length && done.intent !== "small_talk");
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
