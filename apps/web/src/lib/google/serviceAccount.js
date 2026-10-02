import { importPKCS8, SignJWT } from "jose";

/*
 * Access tokens for Google APIs from the project's service account, using the
 * JWT-bearer OAuth flow built on `jose` (no googleapis dependency).
 *
 * One service account serves every Google read: Search Console (SEO engine)
 * and Google Analytics (/analytics). Each API only works once the account's
 * email has been granted access on that product's property.
 *
 * Env (Vercel Preview + Production):
 *   GSC_CLIENT_EMAIL  service account email
 *   GSC_PRIVATE_KEY   the service account's PKCS8 private key; newlines may
 *                     be stored as literal \n
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function serviceAccountConfigured() {
  return Boolean(process.env.GSC_CLIENT_EMAIL && process.env.GSC_PRIVATE_KEY);
}

export async function getGoogleAccessToken(scope) {
  const clientEmail = process.env.GSC_CLIENT_EMAIL;
  const rawKey = process.env.GSC_PRIVATE_KEY.replace(/\\n/g, "\n");
  const key = await importPKCS8(rawKey, "RS256");

  const assertion = await new SignJWT({ scope })
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
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).access_token;
}
