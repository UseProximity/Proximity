/*
 * A payer for a landlord account (Project B, Wyatt 2026-11-09). See
 * payerLinks.js for the model. This is everything a landlord, a payer and the
 * signing webhook do with one:
 *
 *   namePayer             the landlord names the person who signs and pays. A new
 *                         email gets a billing-only landlord account (no password
 *                         yet: the invite carries a set-password link).
 *   requestPayerCoverage  the landlord confirmed that what they are publishing
 *                         goes to their payer: it waits as a draft for the next
 *                         document the payer opens (one already open is never
 *                         changed or cancelled by it)
 *   settleSignedDocument  after the payer signs: each listing on the document is
 *                         approved (covered) or declined (left off). Nothing is
 *                         published: the landlord publishes an approved listing
 *                         when they choose (Wyatt, 2026-11-09)
 *   approveWaiting        any waiting listing the payer's agreement already covers
 *                         is approved
 *   landlordPayerView     what the landlord's Billing tab shows: status only,
 *                         never the agreement
 *   payerAccounts         what the payer sees: each account they pay for, its
 *                         covered properties and what waits for their signature
 *   endPayerFor           the payer voids their agreement for one account
 *
 * The landlord account never signs once it has a payer, and cannot remove a payer
 * who has signed: only the payer can void (Wyatt, 2026-11-09).
 *
 * `db` is a service-role Supabase client. Sending and publishing are passed in
 * (`deps`) so the rules can be tested without email or listings.
 */
import { BillingError } from "./errors.js";
import { activePayerLink, clearDocumentRequests, payeeLinks } from "./payerLinks.js";
import { agreementState, coverageFor, voidDocument } from "./agreements.js";
import { getLiveVersion } from "./agreementVersions.js";
import { displayAddress } from "./coverage.js";
import { getGateSettings } from "./listingGate.js";
import { hasActivePaymentMethod } from "./paymentMethodState.js";

/*
 * Whether publishing for the accounts this signer covers waits on the signer's
 * payment method: required, and they have no active one. A listing already
 * covered then waits for that, not for another signature.
 */
export async function signerNeedsPaymentMethod(db, payerId, now = new Date()) {
  const { requirePaymentMethod } = await getGateSettings(db);
  if (!requirePaymentMethod) return false;
  const { data, error } = await db.from("payment_methods").select("status, type, exp_month, exp_year, deleted_at").eq("user_id", payerId).is("deleted_at", null);
  if (error) throw error;
  return !hasActivePaymentMethod(data ?? [], now);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const missingSchema = (error) => ["PGRST205", "42P01", "42703", "PGRST200", "PGRST204"].includes(error?.code);

export function cleanPayerInput({ name, email } = {}) {
  const n = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!n) throw new BillingError("name_required", "Enter the name of the person who will sign and pay.");
  if (n.length > 100) throw new BillingError("name_too_long", "Keep the name under 100 characters.");
  const e = String(email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) throw new BillingError("bad_email", "Enter a valid email address.");
  return { name: n, email: e };
}

// ilike with the wildcards in an email escaped, so it matches only that address.
const exactIlike = (email) => email.replace(/[\\%_]/g, (c) => `\\${c}`);

async function userByEmail(db, email) {
  const { data, error } = await db
    .from("users")
    .select("id, name, email, deleted_at, review_sandbox, billing_only, password_hash, google_account, apple_account, roles!role_id(name)")
    .ilike("email", exactIlike(email))
    .is("deleted_at", null)
    .limit(2);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function landlordRoleId(db) {
  const { data, error } = await db.from("roles").select("id").eq("name", "landlord").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("landlord role missing");
  return data.id;
}

// Whether the account can still sign in without a password reset (it has a password or a social login).
export const canSignIn = (u) => !!(u?.password_hash || u?.google_account || u?.apple_account);

/*
 * What an admin sees when they type a payer's email (Wyatt, 2026-11-09):
 *   { status: "existing", user }   a landlord or billing account already has it
 *   { status: "new" }              nobody: a billing account will be made, and
 *                                  they set a password from the email
 *   { status: "refused", reason }  a student, admin or sandbox account, or
 *                                  someone who has a payer themselves
 * `user` is { id, name, email, billingOnly, paysFor }.
 */
export async function lookupPayer(db, email) {
  const clean = String(email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) return { status: "invalid" };
  const u = await userByEmail(db, clean);
  if (!u) return { status: "new", email: clean };
  if ((u.roles?.name ?? null) !== "landlord" || u.review_sandbox) {
    return { status: "refused", reason: "That email belongs to an account that can't pay for listings (a student or admin). Use another email." };
  }
  if (await activePayerLink(db, u.id)) {
    return { status: "refused", reason: "That landlord has their own authorized signer, so they can't sign for others." };
  }
  const paysFor = (await payeeLinks(db, u.id)).length;
  return { status: "existing", user: { id: u.id, name: u.name ?? null, email: u.email, billingOnly: u.billing_only === true, paysFor } };
}

/*
 * The landlord names their payer. Refused when:
 *   - the landlord signed their own agreement (they void it first: contact us)
 *   - the landlord has terms negotiated for them alone (their terms are theirs)
 *   - the landlord pays for others (no chains), or already has a payer (Change instead)
 *   - the email is the landlord's own, a student's or admin's account, or someone with a payer
 * Returns { link, payer, created } (created: a new billing-only account was made).
 */
// `createdBy`: an admin assigning the payer (default: the landlord themselves).
export async function namePayer(db, { landlord, name, email, createdBy = null, now = new Date() }) {
  const input = cleanPayerInput({ name, email });
  if (String(landlord?.email ?? "").toLowerCase() === input.email) {
    throw new BillingError("payer_is_you", "That is your own email. To sign yourself, use Review and sign.");
  }
  if (await activePayerLink(db, landlord.id)) {
    throw new BillingError("payer_exists", "You already have an authorized signer. Use Change signer instead.", 409);
  }
  const state = await agreementState(db, landlord.id, now);
  if (state.signed && state.valid) {
    throw new BillingError("already_signed", "You already signed your marketing agreement. Contact us to void it before handing it to someone else.", 409);
  }
  const own = await getLiveVersion(db, { kind: "master", landlordId: landlord.id });
  if (own?.landlord_id) {
    throw new BillingError("negotiated_terms", "Your agreement has terms made for your account, so it can't be handed to someone else. Contact us and we'll sort it out.", 409);
  }
  if ((await payeeLinks(db, landlord.id)).length) {
    throw new BillingError("you_pay_for_others", "You are the authorized signer for other accounts, so you sign for yourself.", 409);
  }

  let payer = await userByEmail(db, input.email);
  let created = false;
  if (payer) {
    const role = payer.roles?.name ?? null;
    if (role !== "landlord" || payer.review_sandbox) {
      throw new BillingError("payer_not_landlord", "That email belongs to an account that can't pay for listings. Use another email or contact us.", 409);
    }
    if (await activePayerLink(db, payer.id)) {
      throw new BillingError("payer_has_payer", "That person has their own authorized signer, so they can't sign for your account.", 409);
    }
  } else {
    const { data, error } = await db
      .from("users")
      .insert({
        email: input.email,
        name: input.name,
        role_id: await landlordRoleId(db),
        billing_only: true,
        email_verified: false,
        // No "complete your profile" popup (its role picker could turn them into a
        // student): the landlord gave their name, and they only use Billing.
        profile_complete: true,
        gender: "unspecified",
        phone: "N/A",
        description: "",
        referral_source: "payer_invite",
      })
      .select("id, name, email, billing_only")
      .single();
    if (error) {
      if (error.code === "23505") throw new BillingError("email_taken", "An account was just made with this email. Try again.", 409);
      throw error;
    }
    payer = data;
    created = true;
  }

  // Anything the landlord had started signing themselves is cancelled: they no longer sign.
  const { data: link, error: linkError } = await db
    .from("billing_payers")
    .insert({
      landlord_id: landlord.id,
      payer_id: payer.id,
      signer_name: input.name,
      signer_email: input.email,
      created_by: createdBy ?? landlord.id,
      invited_at: now.toISOString(),
    })
    .select("id, landlord_id, payer_id, signer_name, signer_email, status, invited_at, declined_at, created_at")
    .single();
  if (linkError) {
    // Nothing points at a billing account made just now: remove it rather than leave an orphan.
    if (created) await db.from("users").delete().eq("id", payer.id).eq("billing_only", true);
    if (linkError.code === "23505") throw new BillingError("payer_exists", "You already have an authorized signer. Reload the page.", 409);
    throw linkError;
  }
  return { link, payer, created };
}

/*
 * Cancel the landlord's own documents still being signed, BEFORE a payer is
 * named: a copy left open would block the payer's addendum. Throws when one
 * can't be cancelled, so nothing is named half way.
 */
export async function cancelOwnSigning(db, documenso, landlordId) {
  const state = await agreementState(db, landlordId);
  const own = [];
  if (state.pendingAmendment && !state.pendingAmendment.signer_id) own.push(["amendment", state.pendingAmendment.id]);
  // The master rows read are the payer's now; the landlord's own pending master is looked up directly.
  const { data: masters } = await db.from("landlord_agreements").select("id").eq("user_id", landlordId).in("status", ["not_sent", "sent"]);
  for (const m of masters ?? []) own.push(["master", m.id]);
  for (const [kind, id] of own) {
    try {
      await voidDocument(db, documenso, { userId: landlordId, kind, id });
    } catch (err) {
      if (err?.code === "already_ended") continue;
      console.error("billing: cancelling own signing failed", err?.message);
      throw new BillingError("own_signing_open", "We couldn't cancel the agreement you started signing. Try again in a minute, or contact us.", 409);
    }
  }
}

/*
 * Whether anything has been signed under the payer for this account: then only
 * the payer can end it (by voiding), never the landlord.
 */
async function signedForAccount(db, landlordId) {
  const { data, error } = await db.from("agreement_coverage").select("id").eq("user_id", landlordId).eq("status", "covered").limit(1);
  if (missingSchema(error)) return false;
  if (error) throw error;
  return (data ?? []).length > 0;
}

/*
 * The landlord changes who signs, before anything was signed: the old link ends,
 * any document waiting on the old payer is cancelled, and the new one is named.
 * Waiting listings move to the new payer.
 */
export async function changePayer(db, documenso, { landlord, name, email, now = new Date() }) {
  const link = await activePayerLink(db, landlord.id);
  if (!link) throw new BillingError("no_payer", "You don't have an authorized signer to change.", 404);
  if (await signedForAccount(db, landlord.id)) {
    throw new BillingError("payer_signed", `${link.signer_name} already signed for your account. Only they can void it.`, 409);
  }
  const input = cleanPayerInput({ name, email });
  if (input.email === link.signer_email) throw new BillingError("same_payer", "That is already your authorized signer. Use Resend instead.");
  // The new signer is named first; the old one's document is cancelled only once
  // that worked, so a refusal leaves everything exactly as it was.
  const { error } = await db
    .from("billing_payers")
    .update({ status: "ended", ended_reason: "changed by the landlord", ended_at: now.toISOString() })
    .eq("id", link.id)
    .eq("status", "active");
  if (error) throw error;
  let made;
  try {
    made = await namePayer(db, { landlord, ...input, now });
    // Waiting listings now wait on the new payer.
    const { error: moveError } = await db.from("payer_publish_requests").update({ payer_link_id: made.link.id }).eq("landlord_id", landlord.id).eq("status", "waiting");
    if (moveError) {
      await db.from("billing_payers").update({ status: "ended", ended_reason: "naming failed", ended_at: now.toISOString() }).eq("id", made.link.id);
      throw moveError;
    }
  } catch (err) {
    // The new payer was refused: the old one stays.
    await db.from("billing_payers").update({ status: "active", ended_reason: null, ended_at: null }).eq("id", link.id);
    throw err;
  }
  // Only now: the old signer's copy for this account stops working.
  const cancelled = await cancelPayerDocuments(db, documenso, landlord.id, { payerId: link.payer_id }).catch((err) => {
    console.error("billing: cancelling the old signer's document failed", err?.message);
    return null;
  });
  return { ...made, oldPayerId: link.payer_id, cancelled };
}

/*
 * Documents still being signed for this account by its payer: the addendum, or a
 * master started for it. Only for a change of signer or the arrangement ending
 * (a signed-off account), never because the landlord sent more listings.
 * A master can't be edited once sent, so one also covering other accounts is
 * cancelled whole (Wyatt, 2026-11-09: cancel and email the payer). Returns
 * { payerId, otherAccounts } when that happened, so the caller emails the payer.
 */
export async function cancelPayerDocuments(db, documenso, landlordId, { payerId = null } = {}) {
  // Whose master: the payer given (the old one, after a change of signer), else the current one.
  const holderId = payerId ?? (await activePayerLink(db, landlordId))?.payer_id ?? null;
  const { data: amendments, error: amendError } = await db.from("agreement_amendments").select("id").eq("user_id", landlordId).in("status", ["not_sent", "sent"]);
  if (amendError && !missingSchema(amendError)) throw amendError;
  for (const a of amendments ?? []) {
    await voidDocument(db, documenso, { userId: landlordId, kind: "amendment", id: a.id }).catch(() => {});
  }
  if (!holderId || holderId === landlordId) return null;
  const { data: masters, error: masterError } = await db.from("landlord_agreements").select("id").eq("user_id", holderId).in("status", ["not_sent", "sent"]);
  if (masterError) throw masterError;
  for (const m of masters ?? []) {
    const { data } = await db.from("agreement_coverage").select("user_id").eq("agreement_id", m.id).neq("status", "released").limit(500);
    const onIt = new Set((data ?? []).map((r) => r.user_id));
    const { data: stamped } = await db.from("payer_publish_requests").select("landlord_id").eq("document_kind", "master").eq("document_id", m.id).eq("status", "waiting");
    for (const r of stamped ?? []) onIt.add(r.landlord_id);
    if (!onIt.has(landlordId)) continue;
    await voidDocument(db, documenso, { userId: holderId, kind: "master", id: m.id });
    const otherAccounts = [...onIt].filter((id) => id !== landlordId && id !== holderId);
    if (otherAccounts.length) return { payerId: holderId, otherAccounts };
  }
  return null;
}

/*
 * The landlord confirmed: these listings go to their payer. They stay drafts,
 * waiting for the next document the payer opens. A document the payer already
 * has open is locked in and never cancelled by this (Wyatt, 2026-11-09). A
 * listing the payer's agreement already covers is approved at once.
 * Returns { added, approved, toSign }: `toSign` (listing ids) are what the payer
 * is emailed about, once per send.
 */
export async function requestPayerCoverage(db, documenso, { landlordId, listingIds = [], now = new Date() }) {
  const link = await activePayerLink(db, landlordId);
  if (!link) throw new BillingError("no_payer", "Your account has no authorized signer.", 409);
  const ids = [...new Set(listingIds.filter((id) => typeof id === "string"))].slice(0, 100);
  if (!ids.length) throw new BillingError("nothing_to_add", "Choose what to add.");

  const { data: before, error: beforeError } = await db.from("payer_publish_requests").select("listing_id").eq("landlord_id", landlordId).eq("status", "waiting");
  if (beforeError) throw beforeError;
  const waiting = new Set((before ?? []).map((r) => r.listing_id));
  const fresh = ids.filter((id) => !waiting.has(id));
  // One row each: the partial unique index (one waiting row per listing) refuses a
  // duplicate from a double click, which is simply skipped.
  for (const listing_id of fresh) {
    const { error } = await db.from("payer_publish_requests").insert({ landlord_id: landlordId, listing_id, payer_link_id: link.id, status: "waiting", created_at: now.toISOString() });
    if (error && error.code !== "23505") throw error;
  }
  // Asking again clears an earlier decline.
  if (link.declined_at) await db.from("billing_payers").update({ declined_at: null }).eq("id", link.id);
  // Already covered (the payer signed it before): approved now, nothing to sign.
  const { approved } = await approveWaiting(db, { landlordId, now });
  const { covered } = await coverageFor(db, landlordId, now);
  const toSign = fresh.filter((id) => !covered.has(id));
  return { added: fresh.length, approved, toSign, link };
}

// The listing ids waiting on the payer, oldest first.
export async function waitingRequests(db, landlordId) {
  const { data, error } = await db
    .from("payer_publish_requests")
    .select("id, listing_id, created_at")
    .eq("landlord_id", landlordId)
    .eq("status", "waiting")
    .order("created_at", { ascending: true });
  if (missingSchema(error)) return [];
  if (error) throw error;
  return data ?? [];
}

// The landlord deleted or withdrew a draft that was waiting: it drops off.
export async function cancelWaiting(db, landlordId, listingIds, now = new Date()) {
  if (!listingIds?.length) return;
  const { error } = await db
    .from("payer_publish_requests")
    .update({ status: "cancelled", resolved_at: now.toISOString() })
    .eq("landlord_id", landlordId)
    .eq("status", "waiting")
    .in("listing_id", listingIds);
  if (error && !missingSchema(error)) throw error;
}

// The waiting listings that are gone (deleted): they drop off.
async function dropGone(db, landlordId, ids, now) {
  if (!ids.length) return { alive: [], byId: new Map() };
  const { data: listings, error } = await db.from("listings").select("id, address, city, state, zipcode, deleted_at").in("id", ids);
  if (error) throw error;
  const byId = new Map((listings ?? []).map((l) => [l.id, l]));
  const gone = ids.filter((id) => !byId.get(id) || byId.get(id).deleted_at);
  if (gone.length) await cancelWaiting(db, landlordId, gone, now);
  return { alive: ids.filter((id) => !gone.includes(id)), byId };
}

async function resolveRequests(db, landlordId, ids, status, now) {
  if (!ids.length) return;
  const { error } = await db
    .from("payer_publish_requests")
    .update({ status, resolved_at: now.toISOString() })
    .eq("landlord_id", landlordId)
    .in("listing_id", ids)
    .eq("status", "waiting");
  if (error) throw error;
}

/*
 * Every waiting listing of this account that the payer's agreement now covers is
 * approved: the landlord can publish it. Nothing is published here (Wyatt,
 * 2026-11-09). Listings that are gone are dropped. Returns { approved } (addresses).
 */
export async function approveWaiting(db, { landlordId, now = new Date() }) {
  const waiting = await waitingRequests(db, landlordId);
  if (!waiting.length) return { approved: [] };
  const { covered } = await coverageFor(db, landlordId, now);
  const { alive, byId } = await dropGone(db, landlordId, waiting.filter((w) => covered.has(w.listing_id)).map((w) => w.listing_id), now);
  await resolveRequests(db, landlordId, alive, "approved", now);
  return { approved: alive.map((id) => displayAddress(byId.get(id))) };
}

/*
 * The payer signed a document (kind, id). Only the listings on it change
 * (Wyatt, 2026-11-09): each is approved when it is now covered, or declined when
 * the signer left it off. Listings sent after the document was opened stay
 * waiting for the next one. Accounts with nothing on it are not touched.
 * Returns { [landlordId]: { approved: [address], declined: [address] } }.
 * Safe to run again: only waiting rows change.
 */
export async function settleSignedDocument(db, { kind, id, accounts = [], now = new Date() }) {
  const { data: rows, error } = await db
    .from("payer_publish_requests")
    .select("landlord_id, listing_id")
    .eq("document_kind", kind)
    .eq("document_id", id)
    .eq("status", "waiting");
  if (missingSchema(error)) return {};
  if (error) throw error;
  const byAccount = new Map();
  for (const r of rows ?? []) byAccount.set(r.landlord_id, [...(byAccount.get(r.landlord_id) ?? []), r.listing_id]);
  for (const a of accounts) if (!byAccount.has(a)) byAccount.set(a, []);
  const out = {};
  for (const [landlordId, stamped] of byAccount) {
    const { covered } = await coverageFor(db, landlordId, now);
    const { alive, byId } = await dropGone(db, landlordId, stamped, now);
    const declinedIds = alive.filter((lid) => !covered.has(lid));
    await resolveRequests(db, landlordId, declinedIds, "declined", now);
    // The approved ones: on this document, and any other waiting listing it now covers.
    const { approved } = await approveWaiting(db, { landlordId, now });
    out[landlordId] = { approved, declined: declinedIds.map((lid) => displayAddress(byId.get(lid))) };
  }
  return out;
}

/*
 * A daily safety net for a signature whose follow-up never finished (a failed
 * webhook step): waiting listings still locked to a signed document are settled,
 * and ones locked to a document that ended unsigned go back to waiting.
 * `notify(landlordId, { approved, declined })` emails the landlord.
 */
export async function settleStaleDocuments(db, { notify = null, now = new Date() } = {}) {
  const { data, error } = await db
    .from("payer_publish_requests")
    .select("document_kind, document_id")
    .eq("status", "waiting")
    .not("document_id", "is", null)
    .limit(500);
  if (missingSchema(error)) return { settled: 0, cleared: 0 };
  if (error) throw error;
  const docs = new Map((data ?? []).map((r) => [`${r.document_kind}:${r.document_id}`, { kind: r.document_kind, id: r.document_id }]));
  let settled = 0;
  let cleared = 0;
  for (const { kind, id } of docs.values()) {
    const table = kind === "amendment" ? "agreement_amendments" : "landlord_agreements";
    const { data: doc, error: docError } = await db.from(table).select("id, status").eq("id", id).maybeSingle();
    if (docError) throw docError;
    if (doc && ["sent", "not_sent"].includes(doc.status)) continue;
    if (doc?.status === "signed") {
      const result = await settleSignedDocument(db, { kind, id, now });
      settled += 1;
      for (const [landlordId, r] of Object.entries(result)) {
        if (notify && (r.approved.length || r.declined.length)) await notify(landlordId, r).catch(() => {});
      }
    } else {
      await clearDocumentRequests(db, { kind, id });
      cleared += 1;
    }
  }
  return { settled, cleared };
}

// Requests of one status, latest first, one per listing, each with its listing row.
async function requestsWithListings(db, landlordId, status) {
  const { data, error } = await db
    .from("payer_publish_requests")
    .select("id, listing_id, resolved_at")
    .eq("landlord_id", landlordId)
    .eq("status", status)
    .order("resolved_at", { ascending: false });
  if (missingSchema(error)) return [];
  if (error) throw error;
  const latest = [];
  const seen = new Set();
  for (const r of [...(data ?? [])].sort((a, b) => String(b.resolved_at ?? "").localeCompare(String(a.resolved_at ?? "")))) {
    if (seen.has(r.listing_id)) continue;
    seen.add(r.listing_id);
    latest.push(r);
  }
  if (!latest.length) return [];
  const { data: listings, error: listingError } = await db
    .from("listings")
    .select("id, address, city, state, zipcode, published_at, deleted_at")
    .in("id", latest.map((r) => r.listing_id));
  if (listingError) throw listingError;
  const byId = new Map((listings ?? []).map((l) => [l.id, l]));
  return latest.map((r) => ({ ...r, listings: byId.get(r.listing_id) ?? null })).filter((r) => r.listings && !r.listings.deleted_at);
}

// The listings an account's payer approved that are still drafts: ready for the landlord to publish.
export async function approvedDrafts(db, landlordId) {
  return (await requestsWithListings(db, landlordId, "approved")).filter((r) => !r.listings.published_at);
}

// The listings the payer declined, latest first, unless sent again or covered since.
async function declinedRequests(db, landlordId, skip) {
  const skipped = new Set(skip);
  return (await requestsWithListings(db, landlordId, "declined")).filter((r) => !skipped.has(r.listing_id));
}

/*
 * What the landlord's Billing tab shows when they have a payer. Never the
 * agreement or its terms (Wyatt, 2026-11-09).
 *   status   pending   waiting on the payer (sent, or listings waiting)
 *            declined  the payer declined the last document (no reason shown)
 *            signed    everything asked for is covered
 *   covered  [{ listingId, address }], waiting [{ listingId, address, since }]
 */
export async function landlordPayerView(db, landlordId, now = new Date()) {
  const link = await activePayerLink(db, landlordId);
  if (!link) return null;
  const [{ state, properties, covered }, waiting] = await Promise.all([coverageFor(db, landlordId, now), waitingRequests(db, landlordId)]);
  const nameOf = new Map(properties.map((p) => [p.listingId, p.address]));
  const missingNames = waiting.map((w) => w.listing_id).filter((id) => !nameOf.has(id));
  if (missingNames.length) {
    const { data } = await db.from("listings").select("id, address, city, state, zipcode").in("id", missingNames);
    for (const l of data ?? []) nameOf.set(l.id, displayAddress(l));
  }
  // What the signer verified (covered by their agreement), with when (Wyatt, 2026-11-09).
  const coveredList = [...covered.entries()].map(([listingId, row]) => ({ listingId, address: nameOf.get(listingId) ?? row.address, verifiedAt: row.covered_at ?? null }));
  const live = properties.filter((p) => p.live);
  const liveUncovered = live.filter((p) => !covered.has(p.listingId));
  const needsMethod = await signerNeedsPaymentMethod(db, link.payer_id, now);
  const approved = await approvedDrafts(db, landlordId);
  const declined = await declinedRequests(db, landlordId, [...waiting.map((w) => w.listing_id), ...covered.keys()]);
  const status = link.declined_at ? "declined" : waiting.some((w) => !covered.has(w.listing_id)) || liveUncovered.length || !state.valid ? "pending" : "signed";
  return {
    payer: { name: link.signer_name, email: link.signer_email, invitedAt: link.invited_at },
    status,
    signedAt: status === "signed" ? state.signed?.signed_at ?? null : null,
    // What the authorized signer has done of the two things publishing needs (both are theirs, not the landlord's).
    signerChecklist: { agreementSigned: !!state.valid, paymentMethodAdded: !needsMethod },
    // Nothing has been signed for this account yet: the landlord may still change who signs.
    canChange: !coveredList.length,
    covered: coveredList.sort((a, b) => a.address.localeCompare(b.address, "en", { numeric: true })),
    // Each waits for a signature, or (covered already) for the signer's payment method.
    waiting: waiting.map((w) => ({
      listingId: w.listing_id,
      address: nameOf.get(w.listing_id) ?? "Listing",
      since: w.created_at,
      waitingFor: covered.has(w.listing_id) ? (needsMethod ? "payment_method" : "approval") : "signature",
    })),
    // Approved by the signer, still drafts: the landlord publishes them (Wyatt, 2026-11-09).
    approved: approved.map((r) => ({ listingId: r.listing_id, address: displayAddress(r.listings), approvedAt: r.resolved_at, waitingFor: needsMethod ? "payment_method" : null })),
    // On a document the signer signed (or rejected) and left off: they can be sent again.
    declined: declined.map((r) => ({ listingId: r.listing_id, address: displayAddress(r.listings), declinedAt: r.resolved_at })),

  };
}

/*
 * What a payer sees for the accounts they pay for: per account, its name, the
 * properties covered under the payer's agreement, what waits for their signature
 * (and whether they can sign it now), and the documents they signed for it.
 */
export async function payerAccounts(db, payerId, now = new Date()) {
  const links = await payeeLinks(db, payerId);
  if (!links.length) return [];
  const { data: users, error } = await db.from("users").select("id, name, email, company_name").in("id", links.map((l) => l.landlord_id));
  if (error) throw error;
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const needsMethod = await signerNeedsPaymentMethod(db, payerId, now);
  const out = [];
  for (const link of links) {
    const [{ state, properties, covered }, waiting] = await Promise.all([coverageFor(db, link.landlord_id, now), waitingRequests(db, link.landlord_id)]);
    const u = userById.get(link.landlord_id);
    const nameOf = new Map(properties.map((p) => [p.listingId, p.address]));
    const liveUncovered = properties.filter((p) => p.live && !covered.has(p.listingId));
    const waitingIds = new Set(waiting.map((w) => w.listing_id));
    out.push({
      landlordId: link.landlord_id,
      accountName: u?.company_name?.trim() || u?.name || u?.email || "Landlord account",
      accountEmail: u?.email ?? null,
      since: link.created_at,
      covered: [...covered.entries()]
        .map(([listingId, row]) => ({ listingId, address: nameOf.get(listingId) ?? row.address }))
        .sort((a, b) => a.address.localeCompare(b.address, "en", { numeric: true })),
      // What needs their signature: listings the landlord sent that aren't covered, and live ones not covered.
      waiting: [
        ...waiting.filter((w) => !covered.has(w.listing_id)).map((w) => ({ listingId: w.listing_id, address: nameOf.get(w.listing_id) ?? "Listing" })),
        ...liveUncovered.filter((p) => !waiting.some((w) => w.listing_id === p.listingId)).map((p) => ({ listingId: p.listingId, address: p.address })),
      ],
      // Covered already, but waiting to go live on the signer's payment method.
      waitingOnPaymentMethod: needsMethod
        ? waiting.filter((w) => covered.has(w.listing_id)).map((w) => ({ listingId: w.listing_id, address: nameOf.get(w.listing_id) ?? "Listing" }))
        : [],
      // What signing for it now makes: the agreement itself, or an addendum to it.
      needs: !state.valid ? "agreement" : waiting.some((w) => !covered.has(w.listing_id)) || liveUncovered.length ? "addendum" : null,
      // The landlord's drafts not covered yet: the signer sees them and may add
      // them to the agreement (Wyatt, 2026-11-09). Covering a draft does not publish it.
      drafts: properties
        .filter((p) => p.draft && !p.live && !covered.has(p.listingId) && !waitingIds.has(p.listingId))
        .map((p) => ({ listingId: p.listingId, address: p.address })),
      declined: !!link.declined_at,
    });
  }
  return out;
}

/*
 * The payer voids their agreement for one account they pay for (Wyatt,
 * 2026-11-09: the landlord can't remove them, they void it): that account's
 * properties come off the payer's agreement, anything waiting is cancelled and
 * the link ends. The payer's agreement stays in force for everything else. The
 * landlord then signs for themselves or names someone else. Returns { released }.
 */
// `endLink`: an admin ending the arrangement entirely (the link ends too).
export async function endPayerFor(db, documenso, { payerId, landlordId, endLink = false, now = new Date() }) {
  const link = await activePayerLink(db, landlordId);
  if (!link || link.payer_id !== payerId) throw new BillingError("not_payer", "You don't pay for that account.", 404);
  const cancelled = await cancelPayerDocuments(db, documenso, landlordId);
  const nowIso = now.toISOString();
  const { data: masters } = await db.from("landlord_agreements").select("id").eq("user_id", payerId);
  const masterIds = (masters ?? []).map((m) => m.id);
  let released = 0;
  if (masterIds.length) {
    const { data, error } = await db
      .from("agreement_coverage")
      .update({ status: "released", released_at: nowIso })
      .eq("user_id", landlordId)
      .in("agreement_id", masterIds)
      .in("status", ["proposed", "covered"])
      .select("id");
    if (error) throw error;
    released = data?.length ?? 0;
  }
  if (endLink) {
    // An admin ending the arrangement: the account signs for itself again.
    const { error: waitError } = await db.from("payer_publish_requests").update({ status: "cancelled", resolved_at: nowIso }).eq("landlord_id", landlordId).eq("status", "waiting");
    if (waitError) throw waitError;
    const { error } = await db.from("billing_payers").update({ status: "ended", ended_reason: "ended by an admin", ended_at: nowIso }).eq("id", link.id);
    if (error) throw error;
  } else {
    // The signer voided: they stay the account's authorized signer, shown as
    // having declined (Wyatt, 2026-11-09). The landlord can change signer; the
    // signer can sign again later. Drafts sent to them stay waiting.
    const { error } = await db.from("billing_payers").update({ declined_at: nowIso }).eq("id", link.id);
    if (error) throw error;
  }
  return { released, cancelled };
}

// The account's drafts not covered yet: what "Add drafts to your agreement" puts on the document.
export async function uncoveredDraftIds(db, landlordId, now = new Date()) {
  const { properties, covered } = await coverageFor(db, landlordId, now);
  return properties.filter((p) => p.draft && !p.live && !covered.has(p.listingId)).map((p) => p.listingId);
}
