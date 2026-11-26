/*
 * The landlord's application link (unit_leases.application_url), shared by
 * the browser and the server.
 *
 * A landlord pastes the link to their own application once per property, in
 * their contact block, and it is copied onto every lease they own there. The
 * Apply button shows only where a lease on the listing carries one; we never
 * host or submit the application ourselves (Wyatt, 2026-11-14).
 */

export const APPLICATION_URL_MAX = 2000;

/*
 * A pasted link, cleaned up, or { error }. Empty clears it (null). A bare
 * "portal.example.com/apply" gets https:// in front; anything that is not
 * https once parsed is refused, so a student never lands on an insecure form
 * with their details.
 */
export function normalizeApplicationUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { url: null };
  // "portal.example.com:8443/apply" is a host and port, not a scheme.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/:]+:\d+(?:[/?#]|$)/.test(raw);
  const withScheme = hasScheme ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: "That application link isn't a valid web address." };
  }
  if (parsed.protocol !== "https:") {
    return { error: "The application link must start with https://." };
  }
  if (!parsed.hostname.includes(".")) {
    return { error: "That application link isn't a valid web address." };
  }
  const url = parsed.toString();
  if (url.length > APPLICATION_URL_MAX) return { error: "That application link is too long." };
  return { url };
}

/*
 * Which application the Apply button opens on a listing, as { url, leaseId },
 * or null for no button.
 *
 * Once the student has picked a lease, only that lease's landlord counts: their
 * link (off that lease, or another of theirs here), or no button when they
 * have none (Wyatt, 2026-11-16). Another landlord's application would send the
 * student to the wrong person for the unit they meant. With nothing picked,
 * the primary landlord's link, then any link at all, so a listing where only
 * one of several landlords added one still gets a button. `listing` is the
 * getListing shape (unitTypes[].leases[]).
 */
export function pickApplication(listing, selectedLease = null) {
  const leases = (listing?.unitTypes ?? []).flatMap((u) => u.leases ?? []);
  const withLink = leases.filter((l) => l.applicationUrl);
  if (!withLink.length) return null;
  let pick;
  if (selectedLease?.id) {
    pick =
      withLink.find((l) => l.id === selectedLease.id) ??
      (selectedLease.ownerId ? withLink.find((l) => l.ownerId === selectedLease.ownerId) : null);
  } else {
    const primaryId = listing?.owner?._id ?? null;
    pick = (primaryId ? withLink.find((l) => l.ownerId === primaryId) : null) ?? withLink[0];
  }
  return pick ? { url: pick.applicationUrl, leaseId: pick.id } : null;
}
