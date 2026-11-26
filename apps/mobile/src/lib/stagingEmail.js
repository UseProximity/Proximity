import * as secureStorage from "./secureStorage";

// Mobile equivalent of the staging web app's "Test email destination" picker
// (apps/web/src/components/layout/StagingEmailPicker.js). The web keeps it in a
// cookie; the app keeps it in SecureStore and the API client sends it as the
// x-staging-email-to header. The server only honours that header off production
// (apps/web/src/lib/outreach.js), so this is a no-op against the real site. As a
// second line, nothing is stored or sent when the app points at production.
//
// SecureStore keys may only contain letters, digits, ".", "-" and "_".
const KEY = "staging_email_to";
// Same pattern as the server (outreach.js) and the web picker: one address, no commas,
// semicolons or angle brackets.
const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
const PRODUCTION_HOSTS = new Set(["useproximity.org", "www.useproximity.org"]);

let current = null;

export function isValidTestEmail(value) {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

// True when the API is anything other than the real site. Hand-written host
// match because React Native's URL implementation is incomplete.
export function isNonProductionApi(apiUrl) {
  const match = /^https?:\/\/([^/?#:@]+)/i.exec(typeof apiUrl === "string" ? apiUrl.trim() : "");
  return !!match && !PRODUCTION_HOSTS.has(match[1].toLowerCase());
}

export function getStagingEmail() {
  return current;
}

// Reads the saved destination into memory. Called once at startup; a failure
// leaves it unset, which the server treats as "use the fallback or suppress".
export async function loadStagingEmail() {
  try {
    const saved = await secureStorage.get(KEY);
    current = isValidTestEmail(saved) ? saved.trim() : null;
  } catch {
    current = null;
  }
  return current;
}

// An empty value clears the destination. Returns false, saving nothing, for a
// value that is not a valid email address.
export async function setStagingEmail(value) {
  const next = typeof value === "string" ? value.trim() : "";
  if (next && !isValidTestEmail(next)) return false;
  current = next || null;
  try {
    if (next) await secureStorage.set(KEY, next);
    else await secureStorage.remove(KEY);
  } catch (err) {
    console.warn("stagingEmail: could not save destination", err);
  }
  return true;
}
