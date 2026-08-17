// Extracts a user-facing message from an ApiClient error (packages/api-client's
// request() throws Error objects carrying the server's JSON body as `.body`)
// or a network-level error, falling back to a caller-supplied default.
// New screens should use this instead of re-deriving the
// `err?.body?.error ?? err?.message ?? fallback` chain already duplicated
// across the existing auth/profile screens.
export function getErrorMessage(err, fallback) {
  return err?.body?.error ?? err?.message ?? fallback;
}
