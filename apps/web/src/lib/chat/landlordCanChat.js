/*
 * Server-side gate for in-app listing chat: can this landlord be reached?
 *
 * This used to require Google OR (password AND verified email), i.e. proof the
 * person had actually signed up. That gated chat to 58 of 205 live listings,
 * because most landlords behind the inventory have rows the listing importer
 * created and have never signed in. While the email contact form existed that
 * was survivable. Retiring it (Wyatt, 2026-10-03) made it untenable: it would
 * have left most of the catalogue with no way to contact anyone at all.
 *
 * Reachable now means "we have an email address for this person". The
 * notification email's magic link signs them in without a password, so a
 * landlord who has never logged in can still read and reply. Setting a password
 * is required before they can send, which is where identity gets established,
 * not here. See fn_chat_resolve_landlord for the server-side counterpart, which
 * additionally provisions an account from a listing or lease contact address.
 *
 * Still excluded, because a message to any of them goes nowhere: soft-deleted
 * accounts, system accounts, the info@ house account (it is a shared inbox, not
 * a landlord), and anyone with no email on file.
 *
 * Deciding canChat needs columns that must never reach a browser, so the
 * listing routes select LANDLORD_CHAT_SELECT and then pass the row through
 * formatListingOwner(), which is the only shape allowed onto a public payload:
 * {_id, name, image, canChat}.
 *
 * The landlord's email is deliberately NOT in that shape. Public listing
 * payloads stopped carrying landlord contact details in 0e1d673, and the chat
 * RPCs resolve the recipient server-side, so nothing needs it client-side.
 */
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
  if (!email) return false;
  if (email === HOUSE_ACCOUNT_EMAIL) return false;
  return true;
}

/**
 * Is there any address an inquiry about this listing could reach?
 *
 * The landlord's own account is the first answer, but a listing can carry its
 * own contact address while its landlord row has none, or has no row at all.
 * fn_chat_resolve_landlord provisions an account from that address server-side,
 * so those listings ARE reachable and the composer has to appear on them.
 *
 * Without this the two halves disagreed: 107 of 205 dev listings passed the
 * client gate while the server could route 204. With the email contact form
 * retired, the 97 in between would have had no way to be contacted at all.
 *
 * @param {object|null} user  primary landlord row (LANDLORD_CHAT_SELECT)
 * @param {{contact_email?: string|null}|null} listing  the listing row
 */
export function listingIsReachable(user, listing) {
  if (landlordCanChat(user)) return true;
  const fallback = (listing?.contact_email || "").toLowerCase().trim();
  if (!fallback || !fallback.includes("@")) return false;
  return fallback !== HOUSE_ACCOUNT_EMAIL;
}

/**
 * Public listing.owner shape. Never includes auth fields or contact details.
 *
 * `listing` is optional and only contributes its contact_email to the canChat
 * decision. The address itself never reaches the payload.
 *
 * @returns {{ _id: string, name: *, image: string|null, canChat: boolean } | null}
 */
export function formatListingOwner(user, listing = null) {
  if (!user?.id) return null;
  return {
    _id: user.id,
    name: user.name,
    image: user.image ?? null,
    canChat: listingIsReachable(user, listing),
  };
}
