import { SignJWT, jwtVerify } from "jose";

function getSecretKey() {
  const secret = process.env.MOBILE_JWT_SECRET;
  if (!secret) throw new Error("MOBILE_JWT_SECRET environment variable is not set.");
  return new TextEncoder().encode(secret);
}

/**
 * Signs a short-lived access token (15 minutes).
 * Payload: { sub: userId, role, profileComplete, type: "access" }
 */
export async function signAccessToken({ id, role, profileComplete = false }) {
  return new SignJWT({ role, profileComplete, type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(id))
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecretKey());
}

/**
 * Signs a long-lived refresh token (30 days).
 * Payload: { sub: userId, type: "refresh" }
 */
export async function signRefreshToken({ id }) {
  return new SignJWT({ type: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(id))
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecretKey());
}

/**
 * Verifies any token signed with MOBILE_JWT_SECRET.
 * Returns the decoded payload or throws on invalid/expired tokens.
 */
export async function verifyMobileToken(token) {
  const { payload } = await jwtVerify(token, getSecretKey());
  return payload;
}

/**
 * Verifies the Authorization: Bearer token on an incoming Next.js request.
 * Returns { user: { id, role, profileComplete } } on success, or null if the
 * header is missing, malformed, expired, or not an access token.
 *
 * Usage in a route handler:
 *   const auth = await authMobile(req);
 *   if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
 */
export async function authMobile(req) {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const payload = await verifyMobileToken(token);
    if (payload.type !== "access") return null;
    return {
      user: {
        id: payload.sub,
        role: payload.role ?? "student",
        profileComplete: payload.profileComplete ?? false,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Builds the user object returned to the mobile client from a Supabase user row
 * (with joined role via roles!role_id(name)).
 */
export function buildUserPayload(userRow) {
  return {
    id: userRow.id,
    email: userRow.email,
    name: userRow.name ?? null,
    role: userRow.roles?.name ?? "student",
    profileComplete: userRow.profile_complete ?? false,
    image: userRow.image ?? null,
  };
}
