// Which web hosts the iOS app claims for Universal Links (the associatedDomains
// entitlement), decided from the backend a build talks to.
//
// Emails link to the host of the backend that sent them (getBaseUrl in the web app:
// NEXTAUTH_URL), so a build can only open its own backend's email links if it claims
// that host. Production always claims useproximity.org. A build whose API URL is the
// staging deployment also claims the staging host, which is what lets a TestFlight
// build pointed at staging open staging reset and verification emails. A production
// build, or any other API URL (a LAN address, say), never claims it.
//
// CommonJS on purpose, like envGuard.js: app.config.js is loaded by Node. The host
// list in chatLinks.js must stay in step with these; authLinks.test.js checks it.

const PRODUCTION_LINK_HOST = "useproximity.org";
const STAGING_LINK_HOST = "proximity-livid.vercel.app";

function hostOf(value) {
  if (typeof value !== "string") return null;
  const match = /^https:\/\/([^/?#@:]+)(?::\d+)?(?:[/?#]|$)/i.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

function associatedDomainsFor(apiUrl) {
  const domains = [`applinks:${PRODUCTION_LINK_HOST}`];
  if (hostOf(apiUrl) === STAGING_LINK_HOST) domains.push(`applinks:${STAGING_LINK_HOST}`);
  return domains;
}

module.exports = { PRODUCTION_LINK_HOST, STAGING_LINK_HOST, associatedDomainsFor };
