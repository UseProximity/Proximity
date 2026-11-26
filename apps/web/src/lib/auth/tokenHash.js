/*
 * Hash for bearer tokens we email or hand out (password reset, profile setup).
 *
 * Only the hash is stored, so anything that can read users rows (an admin
 * table view, the action_log audit trail, a DB dump, the dev snapshot) learns
 * nothing it can redeem. The raw value exists only in the link or response it
 * was issued in. SHA-256 without a salt is enough here: the tokens are long
 * random values, not guessable passwords. Same scheme as review_invites and
 * the chat access tokens.
 */
import { createHash } from "crypto";

export function hashToken(raw) {
  return createHash("sha256").update(String(raw), "utf8").digest("hex");
}
