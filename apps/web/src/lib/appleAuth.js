/*
 * Sign in with Apple, server side (native iOS flow).
 *
 * The app sends Apple's identity token plus the single-use authorization code:
 *   - the identity token is verified here against Apple's published keys, which
 *     needs only APPLE_BUNDLE_ID, and
 *   - the authorization code is exchanged for a refresh token, stored so that
 *     account deletion can revoke the user's Apple grant (an App Store
 *     requirement). Exchange and revocation authenticate with a client secret
 *     signed by the Sign in with Apple key (APPLE_TEAM_ID, APPLE_KEY_ID,
 *     APPLE_PRIVATE_KEY).
 *
 * No Services ID is involved: for a native app the client_id is the App ID
 * (the bundle identifier), and there is no redirect URI.
 */
import { createHash } from "node:crypto";
import { createRemoteJWKSet, errors, importPKCS8, jwtVerify, SignJWT } from "jose";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_TIMEOUT_MS = 8000;
// Apple's key endpoint intermittently answers 404 (about 1 request in 5 was
// observed), so fetching the keys is retried before giving up.
const APPLE_KEY_ATTEMPTS = 4;
const APPLE_KEY_RETRY_DELAY_MS = 200;

const appleKeys = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

// Thrown for a token that is not a valid, fresh Apple token for this app.
// Anything else (missing config, network) is deliberately a different error.
export class AppleTokenError extends Error {}

// Marks a failure to obtain Apple's signing keys, as opposed to a bad token.
class AppleKeyFetchError extends Error {}

// Looks up the signing key for a token. Anything that goes wrong in here is a
// problem getting Apple's keys (jose reports a non-200 answer as the bare
// ERR_JOSE_GENERIC, a timeout as ERR_JWKS_TIMEOUT, a dropped connection as a
// plain Error). The exception is a token whose kid isn't among Apple's keys:
// that is the token's fault, so it is passed through and never retried.
async function appleKeyFor(header, token) {
  try {
    return await appleKeys(header, token);
  } catch (err) {
    if (err instanceof errors.JWKSNoMatchingKey || err instanceof errors.JWKSMultipleMatchingKeys) throw err;
    throw new AppleKeyFetchError(err?.message, { cause: err });
  }
}

function required(name, value) {
  if (!value) throw new Error(`${name} environment variable is not set.`);
  return value;
}

// Read on use, so a missing variable only breaks what needs it: verifying an
// identity token needs just the bundle ID, while exchange and revocation also
// need the signing key.
const config = {
  get bundleId() {
    return required("APPLE_BUNDLE_ID", process.env.APPLE_BUNDLE_ID);
  },
  get teamId() {
    return required("APPLE_TEAM_ID", process.env.APPLE_TEAM_ID);
  },
  get keyId() {
    return required("APPLE_KEY_ID", process.env.APPLE_KEY_ID);
  },
  get privateKey() {
    return required("APPLE_PRIVATE_KEY", process.env.APPLE_PRIVATE_KEY);
  },
};

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Verifies an identity token and returns its claims.
 *
 * `rawNonce` is the value generated on the device. The device gave Apple its
 * SHA-256, which Apple embeds in the token, so the hash of the raw value must
 * match the token's nonce claim. That ties the token to this one request.
 */
export async function verifyAppleIdentityToken(identityToken, rawNonce) {
  const audience = config.bundleId;

  let payload;
  for (let attempt = 1; ; attempt++) {
    try {
      ({ payload } = await jwtVerify(identityToken, appleKeyFor, {
        issuer: APPLE_ISSUER,
        audience,
        algorithms: ["RS256"],
      }));
      break;
    } catch (err) {
      // A real token problem (signature, issuer, audience, expiry, ...): never
      // retried, and logged with jose's message rather than just its code.
      if (!(err instanceof AppleKeyFetchError)) {
        throw new AppleTokenError(`${err?.code ?? err?.name}: ${err?.message}`);
      }
      // Apple's keys could not be fetched: not the token's fault, so this is a
      // plain error (a 500), not an AppleTokenError (a 401 INVALID_TOKEN).
      if (attempt === APPLE_KEY_ATTEMPTS) {
        throw new Error(`Could not fetch Apple's signing keys after ${attempt} attempts: ${err.message}`, {
          cause: err.cause,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, APPLE_KEY_RETRY_DELAY_MS));
    }
  }

  if (payload.nonce !== sha256Hex(rawNonce)) throw new AppleTokenError("nonce mismatch");
  if (!payload.sub) throw new AppleTokenError("missing sub");
  return payload;
}

// The client secret is a short-lived ES256 JWT signed with the .p8 key.
async function appleClientSecret() {
  // .env files and hosting dashboards often store the PEM with literal "\n".
  const pem = config.privateKey.replace(/\\n/g, "\n");
  const key = await importPKCS8(pem, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience(APPLE_ISSUER)
    .setSubject(config.bundleId)
    .sign(key);
}

async function postToApple(path, params) {
  return fetch(`${APPLE_ISSUER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
  });
}

/**
 * Exchanges the authorization code (single use, valid for 5 minutes) for
 * Apple's refresh token. Returns null on any failure: signing in must not
 * depend on this step, since the token is only needed later, to revoke.
 *
 * `expectedSub` is the verified identity token's subject. The code has to
 * belong to the same Apple user, otherwise a mismatched pair could attach
 * someone else's Apple grant to this account.
 */
export async function exchangeAuthorizationCode(code, expectedSub) {
  try {
    const res = await postToApple("/auth/token", {
      client_id: config.bundleId,
      client_secret: await appleClientSecret(),
      code,
      grant_type: "authorization_code",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("[apple] code exchange rejected:", res.status, body.error);
      return null;
    }

    const tokens = await res.json();
    const { payload } = await jwtVerify(tokens.id_token, appleKeys, {
      issuer: APPLE_ISSUER,
      audience: config.bundleId,
    });
    if (payload.sub !== expectedSub || !tokens.refresh_token) return null;
    return tokens.refresh_token;
  } catch (err) {
    console.error("[apple] code exchange failed:", err?.message);
    return null;
  }
}

/**
 * Revokes a user's Apple grant (App Store rule for apps that create accounts
 * with Sign in with Apple). Apple answers 200 for a token it has already
 * invalidated too. Never throws; returns whether Apple confirmed.
 */
export async function revokeAppleToken(refreshToken) {
  try {
    const res = await postToApple("/auth/revoke", {
      client_id: config.bundleId,
      client_secret: await appleClientSecret(),
      token: refreshToken,
      token_type_hint: "refresh_token",
    });
    if (!res.ok) console.error("[apple] revoke rejected:", res.status);
    return res.ok;
  } catch (err) {
    console.error("[apple] revoke failed:", err?.message);
    return false;
  }
}
