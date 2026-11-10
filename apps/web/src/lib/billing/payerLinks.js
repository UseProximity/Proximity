/*
 * Who pays for a landlord account (billing_payers, Project B, Wyatt 2026-11-09).
 * A landlord account can name a payer: a billing account that signs the
 * marketing agreement for it and pays its invoices. The payer holds the master
 * agreement; the landlord account's properties are added to it by addenda the
 * payer signs. Without a payer, a landlord signs and pays for themselves, exactly
 * as before.
 *
 * The low-level reads every billing module can use without importing the rest.
 * `db` is a service-role Supabase client.
 */
const missingSchema = (error) => ["PGRST205", "42P01", "42703", "PGRST200", "PGRST204"].includes(error?.code);

const LINK_COLUMNS = "id, landlord_id, payer_id, listing_id, signer_name, signer_email, status, invited_at, declined_at, created_at";

// The account-wide payer for a landlord, or null. (A payer per building is Project C.)
export async function activePayerLink(db, landlordId) {
  if (!landlordId) return null;
  const { data, error } = await db
    .from("billing_payers")
    .select(LINK_COLUMNS)
    .eq("landlord_id", landlordId)
    .is("listing_id", null)
    .eq("status", "active")
    .maybeSingle();
  if (missingSchema(error)) return null;
  if (error) throw error;
  return data ?? null;
}

// The landlord accounts this user pays for (active links), oldest first.
export async function payeeLinks(db, payerId) {
  if (!payerId) return [];
  const { data, error } = await db
    .from("billing_payers")
    .select(LINK_COLUMNS)
    .eq("payer_id", payerId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (missingSchema(error)) return [];
  if (error) throw error;
  return data ?? [];
}

// Who holds the agreement covering this landlord account: their payer, or themselves.
export async function agreementHolderId(db, landlordId) {
  const link = await activePayerLink(db, landlordId);
  return link?.payer_id ?? landlordId;
}

// Whether `payerId` is the active payer for `landlordId`.
export async function isPayerFor(db, payerId, landlordId) {
  const link = await activePayerLink(db, landlordId);
  return !!link && link.payer_id === payerId;
}

// The payer declined a document for these accounts: their landlords see "Declined"
// until they ask again (requestPayerCoverage clears it).
export async function markPayerDeclined(db, landlordIds, now = new Date()) {
  const ids = [...new Set(landlordIds.filter(Boolean))];
  if (!ids.length) return;
  const { error } = await db.from("billing_payers").update({ declined_at: now.toISOString() }).in("landlord_id", ids).eq("status", "active");
  if (error && !missingSchema(error)) throw error;
}

// The authorized signer signed for these accounts: an earlier "declined" no longer shows.
export async function clearPayerDeclined(db, landlordIds) {
  const ids = [...new Set(landlordIds.filter(Boolean))];
  if (!ids.length) return;
  const { error } = await db.from("billing_payers").update({ declined_at: null }).in("landlord_id", ids).eq("status", "active");
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
