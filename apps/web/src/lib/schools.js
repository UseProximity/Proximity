/*
 * The universities Proximity serves, and the email domains that prove membership.
 *
 * Reviews are gated on a student email rather than a self-declared school: the dropdown in
 * the review flow is cross-checked against the signed-in account's domain, so a school tag
 * on a review can be trusted. Adding a campus means adding a row here AND a row in the
 * `schools` table (short_name must match exactly — that's the join key).
 *
 * Shared by client and server; keep it free of server-only imports.
 */

// Ordered as shown in the "What school do/did you go to?" dropdown.
export const SCHOOLS = [
  {
    shortName: "WashU",
    label: "Washington University in St. Louis",
    domains: ["wustl.edu"],
  },
  {
    shortName: "SLU",
    label: "Saint Louis University",
    domains: ["slu.edu"],
  },
  {
    shortName: "UMSL",
    label: "University of Missouri–St. Louis",
    domains: ["umsl.edu", "umsystem.edu"],
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
