/*
 * A landlord who rejects the agreement in Documenso's signing window gets a change
 * request opened for them (or their open one added to) with the reason they typed
 * there. That message is written in one fixed shape so the signing window, the
 * Billing tab and the server can all recognise it, and so the landlord can fill it
 * in properly (section, proposed wording, a file) straight after rejecting.
 *
 * Plain functions, no imports: used in the browser and on the server.
 */
export const DECLINE_NOTE = "Declined to sign in the signing window.";
const NO_REASON = "No reason given.";
const MAX = 10000;

// The message body: the fixed first line, then what the landlord wrote.
export function declineBody(text) {
  const t = String(text ?? "").replace(/\r\n/g, "\n").trim() || NO_REASON;
  return `${DECLINE_NOTE}\n\n${t}`.slice(0, MAX);
}

export const isDeclineMessage = (m) =>
  (m?.author_role ?? m?.authorRole) === "landlord" && String(m?.body ?? "").startsWith(DECLINE_NOTE);

// What the landlord wrote, without the fixed first line ("" when they gave no reason).
export function declineText(body) {
  const rest = String(body ?? "").slice(DECLINE_NOTE.length).trim();
  return rest === NO_REASON ? "" : rest;
}
