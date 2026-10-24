/*
 * Columns that must never leave the server, for any caller, staff included.
 *
 * Password hashes can be cracked offline; the token columns are bearer
 * credentials (or hashes of them) that sign in, reset a password or verify an
 * inbox; the cred_* columns are a landlord's encrypted PMS login. No admin
 * screen needs them, so every route that hands DB rows to a browser runs them
 * through stripSecrets first: the generic admin table view and export, the
 * hierarchy views, "view as", and a user's own profile payloads.
 *
 * action_log rows are audit copies of whole rows (old_data, new_data and the
 * per-column diff in changed_fields), so those are stripped one level down.
 */

const SECRET_COLUMNS = new Set([
  "password_hash",
  "password_reset_token",
  "password_reset_expires_at",
  "email_verification_token",
  "email_verification_expires_at",
  "profile_setup_token",
  "profile_setup_link_hash",
  "profile_setup_link_hashes",
  "profile_setup_expires_at",
  "apple_refresh_token",
  "token_hash",
  "reply_token_hash",
]);

const isSecretColumn = (key) => SECRET_COLUMNS.has(key) || key.startsWith("cred_");

function stripObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!isSecretColumn(key)) clean[key] = value;
  }
  return clean;
}

/** One row, with secret columns removed (and the audit copies inside it). */
export function stripSecrets(row) {
  const clean = stripObject(row);
  if (!clean || typeof clean !== "object") return clean;
  for (const nested of ["old_data", "new_data", "changed_fields"]) {
    if (clean[nested] && typeof clean[nested] === "object") {
      clean[nested] = stripObject(clean[nested]);
    }
  }
  return clean;
}

export const stripSecretsFromRows = (rows) => (Array.isArray(rows) ? rows.map(stripSecrets) : rows);
