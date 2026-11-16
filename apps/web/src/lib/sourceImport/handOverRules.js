/*
 * The rules for handing imported drafts to a landlord (handOver.js), kept
 * pure so they can be tested without a database.
 *
 * The team imports a landlord's website under a team account, so every draft
 * is born owned by that account and carrying its contact details. Handing
 * over moves ownership and swaps only the contact fields that are still the
 * importer's: an address the website gave, or one somebody typed in, stays.
 */

const norm = (v) => String(v ?? "").trim().toLowerCase();
const digits = (v) => String(v ?? "").replace(/\D/g, "");

/*
 * The contact fields of `row` to rewrite when it passes from `from` to `to`
 * (both { name, email, phone }). Returns a patch, empty when nothing on the
 * row is the importer's.
 */
export function contactPatch(row, from, to) {
  const patch = {};
  if (!row || !from || !to) return patch;
  if (norm(from.email) && norm(row.contact_email) === norm(from.email)) patch.contact_email = to.email ?? null;
  if (norm(from.name) && norm(row.contact_name) === norm(from.name)) patch.contact_name = to.name ?? null;
  if (digits(from.phone) && digits(row.contact_phone) === digits(from.phone)) patch.contact_phone = to.phone ?? null;
  return patch;
}

/*
 * Which of a batch's jobs hold a draft this import created and finished.
 * A building that already existed (the importer's own, or one it claimed), a
 * site read queued after an import, and the marker a cancel leaves are never
 * handed over.
 */
export function handOverCandidates(jobs = []) {
  const seen = new Set();
  const out = [];
  for (const j of jobs) {
    if (!j || j.status !== "done" || !j.listing_id) continue;
    if (j.target?.sync || j.target?.cancelMarker || j.target?.alreadyListed) continue;
    if (seen.has(j.listing_id)) continue;
    seen.add(j.listing_id);
    out.push(j);
  }
  return out;
}

/*
 * Why a draft cannot be handed over, or null when it can.
 *   listing    { published_at, deleted_at } or null
 *   ownerIds   the user ids on its listing_landlords rows
 */
export function refusal({ listing, ownerIds = [], fromId, toId }) {
  if (!listing || listing.deleted_at) return "This draft no longer exists.";
  if (listing.published_at !== null) return "Already published, so it was left with its owner.";
  if (ownerIds.includes(toId)) return "Already theirs.";
  if (!ownerIds.includes(fromId)) return "No longer owned by the account that imported it.";
  if (ownerIds.some((id) => id !== fromId)) return "Someone else is on this draft too.";
  return null;
}
