/*
 * The universities Proximity serves, and the email domains that prove membership.
 *
 * Reviews are gated on a student email rather than a self-declared school: the dropdown in
 * the review flow is cross-checked against the signed-in account's domain, so a school tag
 * on a review can be trusted. Adding a campus means adding a row here AND a row in the
 * `schools` table (short_name must match exactly — that's the join key).
 *
 * `center` mirrors the campus latitude/longitude on that row. It lives here as well because
 * address autocomplete biases its suggestions toward the reviewer's campus on every
 * keystroke, and a DB round-trip per keystroke to learn a constant isn't worth it. Keep the
 * two in sync; a campus doesn't move.
 *
 * `tagAliases` are the words a printed QR code's ?src= tag may use to name the campus
 * ("slu-flyer-mudd"). The short name always counts, lowercased.
 *
 * Shared by client and server; keep it free of server-only imports.
 */

// Ordered as shown in the "What school do/did you go to?" dropdown.
export const SCHOOLS = [
  {
    shortName: "WashU",
    label: "Washington University in St. Louis",
    domains: ["wustl.edu"],
    center: { latitude: 38.6488, longitude: -90.3108 },
    tagAliases: ["wustl"],
  },
  {
    shortName: "SLU",
    label: "Saint Louis University",
    domains: ["slu.edu"],
    center: { latitude: 38.6362, longitude: -90.234 },
    tagAliases: [],
  },
  {
    shortName: "UMSL",
    label: "University of Missouri–St. Louis",
    domains: ["umsl.edu", "umsystem.edu"],
    center: { latitude: 38.7096, longitude: -90.3093 },
    tagAliases: [],
  },
];

const VALID_SHORT_NAMES = new Set(SCHOOLS.map((s) => s.shortName));

/** Domain portion of an email, lowercased. "" when there isn't one. */
function emailDomain(email) {
  const at = String(email || "").toLowerCase().trim().lastIndexOf("@");
  return at === -1 ? "" : String(email).toLowerCase().trim().slice(at + 1);
}

/**
 * The school an email address belongs to, or null.
 * Subdomains count — a @mail.slu.edu address is still SLU.
 */
export function schoolForEmail(email) {
  const domain = emailDomain(email);
  if (!domain) return null;
  return (
    SCHOOLS.find((school) =>
      school.domains.some((d) => domain === d || domain.endsWith(`.${d}`))
    ) || null
  );
}

/** True when the address belongs to a school we accept reviews from. */
export function isReviewEligibleEmail(email) {
  return !!schoolForEmail(email);
}

/** True when `shortName` is one of our schools. */
export function isKnownSchool(shortName) {
  return VALID_SHORT_NAMES.has(shortName);
}

/**
 * True when a chosen school matches what the email proves. Used to reject a reviewer who
 * picks a campus their address doesn't back up.
 */
export function schoolMatchesEmail(shortName, email) {
  const fromEmail = schoolForEmail(email);
  return !!fromEmail && fromEmail.shortName === shortName;
}

/** Human-readable list of accepted domains, e.g. for the signed-out gate copy. */
export const ACCEPTED_DOMAINS_LABEL = SCHOOLS.map(
  (s) => `@${s.domains[0]}`
).join(", ");

/** The school we assume when nothing else identifies one. */
export const DEFAULT_SCHOOL_SHORT_NAME = "WashU";

/** A school by its short name (case-insensitive), or null. */
export function schoolByShortName(shortName) {
  const wanted = String(shortName || "").trim().toLowerCase();
  if (!wanted) return null;
  return SCHOOLS.find((s) => s.shortName.toLowerCase() === wanted) || null;
}

/*
 * The school a printed QR code's ?src= tag names, or null.
 *
 * Tags are invented at print time and carry a campus by convention rather than
 * registration — "slu-flyer-mudd", "umsl_table_1". The tag is split on the
 * separators normalizeReviewSource() leaves behind and each word is matched whole
 * against a school's short name or alias, so a campus is only claimed when it was
 * actually written as a word: "washu-dbf" is WashU, "sluice-gate" is nobody.
 */
export function schoolFromSourceTag(tag) {
  const words = String(tag || "").toLowerCase().split(/[-_]+/).filter(Boolean);
  if (!words.length) return null;
  return (
    SCHOOLS.find((school) => {
      const names = [school.shortName.toLowerCase(), ...(school.tagAliases || [])];
      return words.some((word) => names.includes(word));
    }) || null
  );
}

/**
 * The campus coordinates to bias a location search toward, falling back to the
 * default school so a caller always gets a usable point.
 */
export function schoolCenter(shortName) {
  return (
    schoolByShortName(shortName)?.center ||
    schoolByShortName(DEFAULT_SCHOOL_SHORT_NAME).center
  );
}
