/*
 * Is an emailed reply really from the domain in its From line?
 *
 * SES checks SPF, DKIM and DMARC on every message it receives and writes the
 * results into an Authentication-Results header that starts "amazonses.com;".
 * A reply passes when DMARC passes, or, when the sender's domain publishes no
 * DMARC policy, when SPF or DKIM passes for that same domain (or a subdomain
 * of it). A DMARC fail is always refused.
 *
 * SES names the SPF identity "envelope-from=", not the RFC 8601
 * "smtp.mailfrom=". Only the second was read before (Wyatt, 2026-10-23), so a
 * sender with no DMARC record and no custom DKIM key (Google Workspace's
 * default *.gappssmtp.com signature) was refused even though SPF passed for
 * their own domain. Clocktower's reply of 2026-10-20 was lost that way. Both
 * spellings are read now.
 *
 * Kept free of app imports so the node test runner can load it directly.
 */

export function domainOf(email) {
  return String(email ?? "").trim().toLowerCase().split("@")[1] || "";
}

export function aligned(a, b) {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** The SES Authentication-Results header, unfolded, without its name. Null when absent. */
export function sesAuthenticationResults(headerLines = []) {
  const all = headerLines
    .filter((h) => String(h.key).toLowerCase() === "authentication-results")
    .map((h) => h.line.replace(/^authentication-results:\s*/i, "").replace(/\s+/g, " "));
  return all.find((r) => /^amazonses\.com\b/i.test(r)) ?? null;
}

/**
 * @param {Array<{key: string, line: string}>} headerLines mailparser's raw header lines
 * @param {string} fromEmail the From address, lower case
 */
export function authenticated(headerLines, fromEmail) {
  const results = sesAuthenticationResults(headerLines);
  if (!results) return false;

  const fromDomain = domainOf(fromEmail);
  const dmarc = results.match(/\bdmarc=(\w+)/i)?.[1]?.toLowerCase();
  if (dmarc === "pass") return true;
  if (dmarc === "fail") return false;

  if (/\bspf=pass\b/i.test(results)) {
    const mailFrom =
      results.match(/\bsmtp\.mailfrom=([^\s;]+)/i)?.[1] ??
      results.match(/\benvelope-from=([^\s;]+)/i)?.[1] ??
      "";
    const spfDomain = domainOf(mailFrom.includes("@") ? mailFrom : `x@${mailFrom}`);
    if (aligned(spfDomain, fromDomain)) return true;
  }

  for (const m of results.matchAll(/\bdkim=pass\b[^;]*?header\.(?:i|d)=@?([^\s;]+)/gi)) {
    if (aligned(m[1].toLowerCase().replace(/^.*@/, ""), fromDomain)) return true;
  }
  return false;
}
