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
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
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
 * The lease the student picked comes first, since that is whose application
 * they mean. Otherwise the primary landlord's link, then any link at all, so
 * a listing where only one of several landlords added one still gets a
 * button. `listing` is the getListing shape (unitTypes[].leases[]).
 */
export function pickApplication(listing, selectedLease = null) {
  const leases = (listing?.unitTypes ?? []).flatMap((u) => u.leases ?? []);
  const withLink = leases.filter((l) => l.applicationUrl);
  if (!withLink.length) return null;
  const chosen = selectedLease?.id ? withLink.find((l) => l.id === selectedLease.id) : null;
  const primaryId = listing?.owner?._id ?? null;
  const pick =
    chosen ??
    (selectedLease?.ownerId ? withLink.find((l) => l.ownerId === selectedLease.ownerId) : null) ??
    (primaryId ? withLink.find((l) => l.ownerId === primaryId) : null) ??
    withLink[0];
  return { url: pick.applicationUrl, leaseId: pick.id };
}
