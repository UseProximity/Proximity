/*
 * Who signs and who pays for a landlord account (billing_payers).
 *
 * A landlord account can name an AUTHORIZED SIGNER (Project B, Wyatt 2026-11-09):
 * a billing account that signs the marketing agreement for it. The signer holds
 * the master agreement; the landlord account's properties are added to it by
 * addenda the signer signs. Without one, a landlord signs for themselves.
 *
 * And an AUTHORIZED PAYER (Wyatt, 2026-11-25): the person invoiced, once they
 * accept. Both roles can be set for the whole account (listing_id NULL) or for
 * one listing of it, and the same person can be named by many accounts:
 *
 *   who signs for a listing   its own signer, else the account's signer, else
 *                             the landlord
 *   who is invoiced for it    its own payer, else the account's payer, else
 *                             whoever signs for it, else the landlord
 *
 * In this file "payer link" (activePayerLink, payeeLinks: names from Project B,
 * when the signer always paid) means a SIGNER link. The payer role's reads are
 * the ones named payerRole... and billedTo....
 *
 * The low-level reads every billing module can use without importing the rest.
 * `db` is a service-role Supabase client.
 */
const missingSchema = (error) => ["PGRST205", "42P01", "42703", "PGRST200", "PGRST204"].includes(error?.code);

export const LINK_COLUMNS = "id, landlord_id, payer_id, listing_id, role, signer_name, signer_email, status, invited_at, declined_at, accepted_at, created_at";
export const SIGNER = "signer";
export const PAYER = "payer";

// The account-wide authorized signer of a landlord, or null.
export async function activePayerLink(db, landlordId) {
  if (!landlordId) return null;
  const { data, error } = await db
    .from("billing_payers")
    .select(LINK_COLUMNS)
    .eq("landlord_id", landlordId)
    .eq("role", SIGNER)
    .is("listing_id", null)
    .eq("status", "active")
    .maybeSingle();
  if (missingSchema(error)) return null;
  if (error) throw error;
  return data ?? null;
}

const EMPTY = () => ({ account: null, byListing: new Map() });

// Every active link of one role on a landlord account: `account` the account-wide
// one (listing_id NULL) or null, `byListing` a Map listingId -> that listing's own.
async function linksOfRole(db, landlordId, role) {
  if (!landlordId) return EMPTY();
  const { data, error } = await db.from("billing_payers").select(LINK_COLUMNS).eq("landlord_id", landlordId).eq("role", role).eq("status", "active");
  if (missingSchema(error)) return EMPTY();
  if (error) throw error;
  const out = EMPTY();
  for (const l of data ?? []) {
    if (l.listing_id) out.byListing.set(l.listing_id, l);
    else out.account = l;
  }
  return out;
}

// Every authorized signer of a landlord account: the account's, and each listing's own.
export const signerLinksFor = (db, landlordId) => linksOfRole(db, landlordId, SIGNER);

// The link covering one listing: its own, else the account's, else null (the landlord).
export const linkForListing = (links, listingId) => (listingId ? links.byListing.get(listingId) : null) ?? links.account ?? null;

// Who holds the agreement covering one listing: its signer, or the landlord.
export const holderForListing = (links, landlordId, listingId) => linkForListing(links, listingId)?.payer_id ?? landlordId;

// Whether any signer link of this account is `signerId`'s.
export const signsForAccount = (links, signerId) => links.account?.payer_id === signerId || [...links.byListing.values()].some((l) => l.payer_id === signerId);

// Every link in a { account, byListing } set, the account's first.
export const allLinks = (links) => [...(links.account ? [links.account] : []), ...links.byListing.values()];

/*
 * Every authorized payer of a landlord account (Wyatt, 2026-11-25). Only the
 * ones who accepted count for billing; `pending: true` adds those still invited.
 */
export async function payerRoleLinksFor(db, landlordId, { pending = false } = {}) {
  const links = await linksOfRole(db, landlordId, PAYER);
  if (pending) return links;
  const out = EMPTY();
  if (links.account?.accepted_at) out.account = links.account;
  for (const [id, l] of links.byListing) if (l.accepted_at) out.byListing.set(id, l);
  return out;
}

/*
 * Who is invoiced for one listing of a landlord account, as { userId, name, via }:
 *   via "payer"    its own accepted payer, else the account's
 *       "signer"   no payer: whoever signs for it, when that is not the landlord
 *       "landlord" nobody else: the landlord themselves (name null)
 * `listingId` null (a charge on no listing, a new property) reads the account's.
 * Pure: pass the two link sets, so a caller reading many listings loads them once.
 */
export function billedTo({ landlordId, listingId = null, signers, payers }) {
  const payer = linkForListing(payers, listingId);
  if (payer) return { userId: payer.payer_id, name: payer.signer_name, via: PAYER, link: payer };
  const signer = linkForListing(signers, listingId);
  if (signer) return { userId: signer.payer_id, name: signer.signer_name, via: SIGNER, link: signer };
  return { userId: landlordId, name: null, via: "landlord", link: null };
}

// Both link sets of an account, for billedTo.
export async function billingLinksFor(db, landlordId) {
  const [signers, payers] = await Promise.all([signerLinksFor(db, landlordId), payerRoleLinksFor(db, landlordId)]);
  return { signers, payers };
}

// The landlord accounts this user signs for (active signer links), oldest first.
// One row per link: an account they sign several listings of appears once per listing.
export async function payeeLinks(db, payerId) {
  return linksHeldBy(db, payerId, SIGNER);
}

// The links naming this user as authorized payer (accepted or still invited), oldest first.
export async function payerRoleLinksOf(db, payerId) {
  return linksHeldBy(db, payerId, PAYER);
}

async function linksHeldBy(db, userId, role) {
  if (!userId) return [];
  const { data, error } = await db
    .from("billing_payers")
    .select(LINK_COLUMNS)
    .eq("payer_id", userId)
    .eq("role", role)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (missingSchema(error)) return [];
  if (error) throw error;
  return data ?? [];
}

// Whether `userId` is an accepted authorized payer for anything of `landlordId`.
export async function isAcceptedPayerFor(db, userId, landlordId) {
  if (!userId || !landlordId) return false;
  return allLinks(await payerRoleLinksFor(db, landlordId)).some((l) => l.payer_id === userId);
}

// The payer declined a document for these accounts: their landlords see "Declined"
// until they ask again (requestPayerCoverage clears it).
// `signerId`: the signer who declined (an account can have several, one per listing).
export async function markPayerDeclined(db, landlordIds, now = new Date(), { signerId = null } = {}) {
  const ids = [...new Set(landlordIds.filter(Boolean))];
  if (!ids.length) return;
  let q = db.from("billing_payers").update({ declined_at: now.toISOString() }).in("landlord_id", ids).eq("role", SIGNER).eq("status", "active");
  if (signerId) q = q.eq("payer_id", signerId);
  const { error } = await q;
  if (error && !missingSchema(error)) throw error;
}

// The authorized signer signed for these accounts: an earlier "declined" no longer shows.
export async function clearPayerDeclined(db, landlordIds, { signerId = null } = {}) {
  const ids = [...new Set(landlordIds.filter(Boolean))];
  if (!ids.length) return;
  let q = db.from("billing_payers").update({ declined_at: null }).in("landlord_id", ids).eq("role", SIGNER).eq("status", "active");
  if (signerId) q = q.eq("payer_id", signerId);
  const { error } = await q;
  if (error && !missingSchema(error)) throw error;
}

/*
 * Which listings a document was opened with (payer_publish_requests.document_*,
 * Wyatt 2026-11-09). What the signer opened is locked in: a listing sent later
 * waits for the next document, and only listings on this one are approved or
 * declined when it is signed.
 */
// The signer opened (or reopened) this document for these accounts' waiting listings.
export async function stampRequests(db, { landlordIds, listingIds, kind, id }) {
  const accounts = [...new Set((landlordIds ?? []).filter(Boolean))];
  const listings = [...new Set((listingIds ?? []).filter(Boolean))];
  if (!accounts.length || !listings.length || !id) return;
  const { error } = await db
    .from("payer_publish_requests")
    .update({ document_kind: kind, document_id: id })
    .in("landlord_id", accounts)
    .in("listing_id", listings)
    .eq("status", "waiting");
  if (error && !missingSchema(error)) throw error;
}

// The document ended unsigned (cancelled, replaced, voided): its listings wait for the next one.
export async function clearDocumentRequests(db, { kind, id }) {
  if (!id) return;
  const { error } = await db
    .from("payer_publish_requests")
    .update({ document_kind: null, document_id: null })
    .eq("document_kind", kind)
    .eq("document_id", id)
    .eq("status", "waiting");
  if (error && !missingSchema(error)) throw error;
}

// The signer rejected the document: every listing on it reads Declined.
export async function declineDocumentRequests(db, { kind, id, now = new Date() }) {
  if (!id) return;
  const { error } = await db
    .from("payer_publish_requests")
    .update({ status: "declined", resolved_at: now.toISOString() })
    .eq("document_kind", kind)
    .eq("document_id", id)
    .eq("status", "waiting");
  if (error && !missingSchema(error)) throw error;
}
