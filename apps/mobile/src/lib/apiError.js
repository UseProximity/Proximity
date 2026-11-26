// Turns whatever a request threw into a message a person can act on. The wording
// itself lives in errorMessages.js; this file only decides which message applies.
//
// The api client's request() throws Error objects carrying the server's JSON body
// as `.body` and the HTTP status as `.status`; anything else (fetch failing
// outright, a bug, a library error) has neither.
//
//   1. No connection or a timeout: ERROR_MESSAGES.NETWORK.
//   2. An error the app raised itself for the user (userFacingError): its text,
//      which always comes from errorMessages.js.
//   3. An expired session or a rate limit: their own messages.
//   4. A server answer we know (SERVER_ERRORS, by exact text or code): our wording
//      for it. Server text is NEVER shown as it arrives.
//   5. Anything else, including 5xx and technical text: the caller's fallback.
import { ERROR_MESSAGES, SCREENING_VERDICTS, SERVER_ERRORS, SERVER_ERROR_PATTERNS } from "./errorMessages.js";

const NETWORK_FAILURE =
  /network request failed|failed to fetch|network error|timed out|timeout|no internet|offline|enotfound|econnrefused|econnreset|load failed/i;

export function isNetworkError(err) {
  return !err?.status && NETWORK_FAILURE.test(String(err?.message ?? ""));
}

// Options:
//   overrides   server text or code -> message, for a screen that words a known
//               answer differently (Apple sign-in's unverified email).
//
// Server text is never shown as it arrives. The one server-written explanation the
// app shows is the "Send anyway?" prompt, which is a 409 with code CONFIRM_SEND and
// is read straight from the response by the chat screens (see isConfirmSend), not
// through this function.
export function getErrorMessage(err, fallback = ERROR_MESSAGES.GENERIC, { overrides } = {}) {
  if (isNetworkError(err)) return ERROR_MESSAGES.NETWORK;
  if (err?.userFacing && err.message) return err.message;

  const status = err?.status;
  if (status === 401 && err?.message === "Session expired") return ERROR_MESSAGES.AUTH.SESSION_EXPIRED;
  if (status === 429 && !SERVER_ERRORS[err?.body?.error]) return ERROR_MESSAGES.RATE_LIMITED;

  const code = err?.body?.code;
  const text = err?.body?.error;
  // A chat screening verdict: only as a 422, and only one of the known texts.
  if (status === 422 && typeof text === "string" && SCREENING_VERDICTS[text]) return SCREENING_VERDICTS[text];
  for (const key of [text, code]) {
    if (typeof key !== "string") continue;
    if (overrides && overrides[key]) return overrides[key];
    if (SERVER_ERRORS[key]) return SERVER_ERRORS[key];
  }
  if (typeof text === "string") {
    const match = SERVER_ERROR_PATTERNS.find(([pattern]) => pattern.test(text));
    if (match) return match[1];
  }
  return fallback;
}

// An error whose text is meant for the user, for failures the app raises itself.
// Pass a constant from ERROR_MESSAGES.
export function userFacingError(message) {
  const error = new Error(message);
  error.userFacing = true;
  return error;
}
