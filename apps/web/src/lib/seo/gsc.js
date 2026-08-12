import { importPKCS8, SignJWT } from "jose";

/*
 * Google Search Console client using a service account, with no new
 * dependency: the JWT-bearer OAuth flow is built directly on `jose` (already
 * in package.json) instead of pulling in googleapis.
 *
 * Env (Vercel Production only):
 *   GSC_CLIENT_EMAIL  service account email (added as a restricted user on
 *                     the Search Console property)
 *   GSC_PRIVATE_KEY   the service account's PKCS8 private key; newlines may
 *                     be stored as literal \n
 *   GSC_SITE_URL      property identifier, e.g. "sc-domain:useproximity.org"
 *                     or "https://useproximity.org/"
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export function gscConfigured() {
  return Boolean(
    process.env.GSC_CLIENT_EMAIL &&
      process.env.GSC_PRIVATE_KEY &&
      process.env.GSC_SITE_URL
  );
}

async function getAccessToken() {
  const clientEmail = process.env.GSC_CLIENT_EMAIL;
  const rawKey = process.env.GSC_PRIVATE_KEY.replace(/\\n/g, "\n");
  const key = await importPKCS8(rawKey, "RS256");

  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`GSC token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).access_token;
}

async function queryRange(token, startDate, endDate) {
  const site = encodeURIComponent(process.env.GSC_SITE_URL);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["page", "query"],
        rowLimit: 5000,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`GSC query failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return (data.rows ?? []).map((r) => ({
    page: r.keys[0],
    query: r.keys[1],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
}

const dayString = (d) => d.toISOString().slice(0, 10);

/**
 * Search analytics for the last 28 full days and the 28 days before that
 * (GSC data lags ~2 days, so both windows end 3 days ago).
 * Returns { current, previous, currentRange, previousRange }.
 */
export async function fetchGscWindows(now = new Date()) {
  const token = await getAccessToken();
  const end = new Date(now);
  end.setDate(end.getDate() - 3);
  const currentStart = new Date(end);
  currentStart.setDate(currentStart.getDate() - 27);
  const previousEnd = new Date(currentStart);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - 27);

  const [current, previous] = await Promise.all([
    queryRange(token, dayString(currentStart), dayString(end)),
    queryRange(token, dayString(previousStart), dayString(previousEnd)),
  ]);
  return {
    current,
    previous,
    currentRange: { start: dayString(currentStart), end: dayString(end) },
    previousRange: { start: dayString(previousStart), end: dayString(previousEnd) },
  };
}
