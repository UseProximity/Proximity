/*
 * A return URL that arrives from outside (a query string, a request body, an
 * emailed link) is only ever followed if it is a path on this site.
 *
 * "//host" and "/\host" are both read by browsers as another origin, so a bare
 * startsWith("/") is not enough.
 */
export function sanitizeCallbackUrl(raw, fallback = "/dashboard") {
  if (typeof raw !== "string" || !raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  return raw;
}
