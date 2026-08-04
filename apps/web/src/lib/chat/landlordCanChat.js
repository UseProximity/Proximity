/*
 * Server-side gate for in-app listing chat. Primary landlord must be a real
 * signed-in account — not a soft-deleted, system, or house (info@) placeholder.
 * Never expose password_hash (or other auth fields) on listing payloads; use
 * formatListingOwner() to strip to {_id, name, email, image, canChat}.
 */

const HOUSE_ACCOUNT_EMAIL = "info@useproximity.org";

/** Fields required from users to compute canChat (and build the public owner). */
export const LANDLORD_CHAT_SELECT =
  "id, name, email, image, is_system, deleted_at, google_account, password_hash, email_verified";

/**
 * @param {{ id?: string, deleted_at?: string|null, is_system?: boolean, email?: string|null, google_account?: boolean, password_hash?: string|null, email_verified?: boolean } | null | undefined} user
 * @returns {boolean}
 */
export function landlordCanChat(user) {
  if (!user?.id) return false;
  if (user.deleted_at) return false;
  if (user.is_system === true) return false;
  const email = (user.email || "").toLowerCase().trim();
  if (email === HOUSE_ACCOUNT_EMAIL) return false;
  if (user.google_account === true) return true;
  if (user.password_hash && user.email_verified) return true;
  return false;
}

/**
 * Public listing.owner shape — never includes password_hash / auth fields.
 * @returns {{ _id: string, name: *, email: string|null, image: string|null, canChat: boolean } | null}
 */
export function formatListingOwner(user) {
  if (!user?.id) return null;
  return {
    _id: user.id,
    name: user.name,
    email: user.email ?? null,
    image: user.image ?? null,
    canChat: landlordCanChat(user),
  };
}
