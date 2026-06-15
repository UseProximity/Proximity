/**
 * testauth.mjs — obtains a session for authenticated impact testing.
 *
 * Two ways to get a session, in priority order:
 *   1. TEST_SESSION_COOKIE — a cookie copied from a logged-in browser (no password needed).
 *   2. TEST_EMAIL + TEST_PASSWORD — performs the NextAuth credentials login flow.
 *
 * Credentials are read from `.env.test.local` at the repo root (gitignored — never
 * committed). Returns a Cookie header string to attach to authenticated requests.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

// Minimal .env parser — no dependency. Ignores comments and blank lines.
export function loadTestEnv() {
  const out = {};
  const p = join(ROOT, ".env.test.local");
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// Collapse a Set-Cookie list into a "name=value; name2=value2" request header.
function setCookieToHeader(headers) {
  const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  return list.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

function hasSessionToken(cookieHeader) {
  return /(?:^|[\s;])(?:__Secure-)?authjs\.session-token=/.test(cookieHeader);
}

async function credentialsLogin(root, env) {
  // NextAuth requires a CSRF token (and its cookie) before a credentials sign-in.
  const csrfRes = await fetch(`${root}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json().catch(() => ({}));
  const csrfCookie = setCookieToHeader(csrfRes.headers);
  if (!csrfToken) return { error: "could not fetch CSRF token from /api/auth/csrf" };

  const body = new URLSearchParams({
    csrfToken,
    email: env.TEST_EMAIL,
    password: env.TEST_PASSWORD,
    callbackUrl: root,
    json: "true",
  });
  const res = await fetch(`${root}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: csrfCookie },
    body: body.toString(),
    redirect: "manual",
  });
  const sessionCookies = setCookieToHeader(res.headers);
  const cookie = [csrfCookie, sessionCookies].filter(Boolean).join("; ");
  if (!hasSessionToken(cookie)) {
    return { error: `credentials login failed (status ${res.status}) — check TEST_EMAIL/TEST_PASSWORD` };
  }
  return { cookie, role: env.TEST_ROLE || "unknown", method: "credentials" };
}

// Returns { cookie, role, method } on success, { error } on failure, or null if no creds configured.
export async function getTestSession(baseUrl) {
  const env = loadTestEnv();
  const root = baseUrl.replace(/\/+$/, "");

  if (env.TEST_SESSION_COOKIE) {
    return { cookie: env.TEST_SESSION_COOKIE, role: env.TEST_ROLE || "unknown", method: "cookie" };
  }
  if (env.TEST_EMAIL && env.TEST_PASSWORD) {
    return await credentialsLogin(root, env);
  }
  return null; // no credentials configured — runner falls back to unauthenticated-only
}
