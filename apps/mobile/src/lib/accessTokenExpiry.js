// Whether the stored mobile access token should be refreshed before a call.
//
// Some optional-auth routes (for example /api/listings/suggested) answer an
// expired bearer token as signed out, with a 200 and empty data rather than a
// 401, so the api client's refresh-on-401 never runs for them. Callers of such
// routes check the token's expiry first and refresh only when it is due.
//
// This reads the `exp` claim without verifying the signature. That is fine
// because it only decides whether to refresh early; the server still verifies
// every token it receives. Anything it cannot read counts as "refresh", the
// safe side: a needless refresh costs one call, a missed one costs the data.
//
// CommonJS on purpose, like shareLink.js, so `npm test` can require it.

// Refresh this long before expiry: covers a request that is still in flight
// when the token lapses, and a phone clock that is slightly behind.
const REFRESH_MARGIN_SECONDS = 60;

function decodePayload(part) {
  // JWTs use base64url without padding; atob (Hermes and Node) wants base64.
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

function accessTokenNeedsRefresh(token, nowMs = Date.now()) {
  if (typeof token !== "string" || !token) return true;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return true;
  let payload;
  try {
    payload = decodePayload(parts[1]);
  } catch {
    return true;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
  const { exp } = payload;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return true;
  return exp - REFRESH_MARGIN_SECONDS <= nowMs / 1000;
}

module.exports = { REFRESH_MARGIN_SECONDS, accessTokenNeedsRefresh };
