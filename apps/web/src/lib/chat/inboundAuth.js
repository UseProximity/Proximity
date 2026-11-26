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
 * Google Workspace's default DKIM signature counts as proof too (Wyatt,
 * 2026-10-24). A Workspace customer that never set up its own DKIM key has
 * its mail signed as <domain with dots as dashes>.<date>.gappssmtp.com, for
 * example revivalstl-com.20251104.gappssmtp.com. Google only signs that way
 * for the Workspace account that owns the domain, so a pass proves the mail
 * came from that domain's own Google account even when its SPF record
 * forgets to list Google (Revival STL's reply of 2026-10-24 was lost that
 * way). A free gmail.com sender cannot get one.
 *
 * Kept free of app imports so the node test runner can load it directly.
 */

export function domainOf(email) {
  return String(email ?? "").trim().toLowerCase().split("@")[1] || "";
}

// <domain-with-dashes>.<digits>.gappssmtp.com
const GAPPS_DKIM = /^([a-z0-9-]+)\.\d{6,10}\.gappssmtp\.com$/;

/*
 * Is `dkimDomain` Google's default Workspace signing domain for `fromDomain`?
 * Only for a plain name.tld domain with no dash. Turning dots into dashes
 * makes landlord-co.com and landlord.co.com sign as the same name, so for any
 * other shape the signature does not say which domain sent it.
 */
export function workspaceDefaultDkim(dkimDomain, fromDomain) {
  const from = String(fromDomain ?? "").toLowerCase();
  if (!/^[a-z0-9]+\.[a-z]+$/.test(from)) return false;
  const m = String(dkimDomain ?? "").toLowerCase().match(GAPPS_DKIM);
  return Boolean(m) && m[1] === from.replace(/\./g, "-");
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
    const dkimDomain = m[1].toLowerCase().replace(/^.*@/, "");
    if (aligned(dkimDomain, fromDomain) || workspaceDefaultDkim(dkimDomain, fromDomain)) return true;
  }
  return false;
}
