// Email addresses are case-insensitive in practice, but users.email is stored
// and compared as typed. Phones auto-capitalize the first letter and password
// managers autofill whatever was saved, so "Union@..." vs "union@..." used to
// read as two different accounts: sign-up said "already exists" while sign-in
// said "invalid email or password" for the same person.

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Case-insensitive match for Supabase `.ilike()`. Escapes the LIKE wildcards
// (`_` is common in addresses) so the pattern only matches the exact address.
// Needed because rows created before normalization may still hold capitals.
export function emailMatchPattern(email) {
  return normalizeEmail(email).replace(/[\\%_]/g, "\\$&");
}
