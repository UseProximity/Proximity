export const AUTH_ERRORS = Object.freeze({
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_EXISTS: "EMAIL_EXISTS",
  GOOGLE_ACCOUNT: "GOOGLE_ACCOUNT",
  INVALID_TOKEN: "INVALID_TOKEN",
  // Sign-in blocked because the account was deleted. Only returned on paths
  // where the caller has already proven they own the address (verified OAuth
  // id_token) — the password path returns INVALID_CREDENTIALS instead so it
  // never confirms the address is registered.
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  MISSING_FIELDS: "MISSING_FIELDS",
  FORBIDDEN: "FORBIDDEN",
  SERVER_ERROR: "SERVER_ERROR",
});
