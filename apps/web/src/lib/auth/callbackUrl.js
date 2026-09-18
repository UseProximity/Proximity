/*
 * A return URL that arrives from outside (a query string, a request body, an
 * emailed link) is only ever followed if it is a path on this site.
 *
 * Checking the string is not enough, because the browser does not read the
 * string, it parses it. "//host" and "/\host" become another origin, and so does
 * "/<tab>/host": the parser silently drops tabs and newlines, which turns it
 * into "//host" after every prefix check has already passed. So the decision is
 * made on what the parser produces, not on what was typed.
 *
 * A path stays on whatever origin it is resolved against; anything that names a
 * host lands on that host instead. Resolving against two different bases tells
 * the two apart even when the host it names happens to be one of the bases.
 * Reserved ".invalid" hosts are used because they can never be a real site.
 */
const BASES = ["https://x.invalid", "https://y.invalid"];

export function sanitizeCallbackUrl(raw, fallback = "/dashboard") {
  if (typeof raw !== "string" || !raw.startsWith("/")) return fallback;
  // Never legitimate in a path here, and the parser reads it as a slash.
  if (raw.includes("\\")) return fallback;
  try {
    if (!BASES.every((base) => new URL(raw, base).origin === base)) return fallback;
  } catch {
    return fallback;
  }
  return raw;
}
