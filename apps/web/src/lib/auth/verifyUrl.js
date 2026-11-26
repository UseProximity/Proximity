/*
The link in the verification email. `next` is where to send them once verified; it is
only added when present, and always encoded as a single query value. The AASA file
(lib/appLinks/aasa.js) keeps links that carry `next` out of the app, so the shape of
this URL and that rule must change together.
 */
export function buildVerifyUrl({ baseUrl, token, next }) {
  return `${baseUrl}/api/auth/verify-email?token=${token}` + (next ? `&next=${encodeURIComponent(next)}` : "");
}
