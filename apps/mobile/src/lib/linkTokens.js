// In-memory hand-off for the one-time token in a password-reset or email-verification
// link. +native-intent.js reads the token out of the incoming URL and stores it here, then
// routes to a URL without it, so the token never enters the router's state or params.
// The screens read it from here and clear it once it has been used. It is never written to
// storage and must never be logged.
const tokens = { reset: null, verify: null };
const listeners = new Set();

export function setLinkToken(kind, token) {
  const next = token ?? null;
  if (tokens[kind] === next) return;
  tokens[kind] = next;
  listeners.forEach((listener) => listener());
}

export function getLinkToken(kind) {
  return tokens[kind];
}

export function clearLinkToken(kind) {
  setLinkToken(kind, null);
}

export function subscribeLinkTokens(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
