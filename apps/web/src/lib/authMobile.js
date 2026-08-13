/*
 * Mobile bearer-token auth — the planned counterpart to `auth()` for a native client.
 *
 * authMobile(req) verifies an `Authorization: Bearer <token>` header against
 * MOBILE_JWT_SECRET and resolves it to { user: { id, role, profileComplete } },
 * or null when the header is missing, malformed, or fails verification — the same
 * session shape web routes already read, so a route can accept either.
 *
 * PLACEHOLDER: not implemented yet, and nothing imports it. The module exists to
 * reserve the seam; implement it before wiring up any mobile client.
 */

export {};
