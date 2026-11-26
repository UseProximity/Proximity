/*
 * Signed release links for PMS swing-guard holds. Same trust model as the
 * availability-check links (lib/availabilityCheck.js): the HMAC-signed token
 * emailed to an admin IS the authorization; no login required. Tokens expire
 * after 14 days; the target hold row must still be open when redeemed.
 */
import crypto from "crypto";

const TOKEN_TTL_DAYS = 14;

function secret() {
  const s = process.env.AVAILABILITY_LINK_SECRET || process.env.AUTH_SECRET;
  if (!s) throw new Error("AVAILABILITY_LINK_SECRET or AUTH_SECRET must be set");
  return s;
}

const b64url = (s) => Buffer.from(s).toString("base64url");
const hmac = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export function signHoldToken(holdId, now = Date.now()) {
  const payload = b64url(
    JSON.stringify({ h: holdId, exp: Math.floor(now / 1000) + TOKEN_TTL_DAYS * 86400 })
  );
  return `${payload}.${hmac(payload)}`;
}

// Returns { holdId } or null (bad signature / malformed / expired).
export function verifyHoldToken(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 500) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data?.h || typeof data.exp !== "number" || data.exp * 1000 < now) return null;
    return { holdId: data.h };
  } catch {
    return null;
  }
}

export function holdReleaseUrl(holdId, baseUrl) {
  return `${baseUrl}/api/pms/hold?token=${encodeURIComponent(signHoldToken(holdId))}`;
}
