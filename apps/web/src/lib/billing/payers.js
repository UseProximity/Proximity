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
 *   endPayerFor           the arrangement ends for one account: the landlord
 *                         revoked their signer, or an admin ended it
 *   completeTakeover      the landlord signed their own agreement while they had
 *                         a signer: the signer is removed, with no gap in coverage
 *
 * A signer cannot void what they signed for an account. The landlord can revoke
 * their signer at any time (Wyatt, 2026-11-10, replacing the rule of 2026-11-09
 * that only the signer could void): the account's listings are then no longer
 * covered until the landlord signs their own agreement. Live listings stay on the
 * site; nothing new can be published until they sign. A landlord with covered
 * listings is offered to sign first instead, which keeps every one covered: the
 * signer is only removed once that signature lands.
 *
 * A signer for ONE listing (Wyatt, 2026-11-25): namePayer, changePayer and
 * endPayerFor take a `listingId`. The account's signer covers a landlord's
 * properties, but a property with its own signer is taken by that signer: each
 * signer gets their own requests and their own addendum, for only what they hold.
 * A listing covered now can still be handed to a signer of its own: the landlord
 * is told it stops being covered until the new signer signs, and confirms.
 *
 * `db` is a service-role Supabase client. Sending and publishing are passed in
 * (`deps`) so the rules can be tested without email or listings.
 */
import { BillingError } from "./errors.js";
import { activePayerLink, allLinks, billedTo, billingLinksFor, clearDocumentRequests, linkForListing, LINK_COLUMNS, payeeLinks, payerRoleLinksFor, payerRoleLinksOf, signerLinksFor } from "./payerLinks.js";
import { PAPER, PAPER_HOLD_MESSAGE, agreementState, coverageFor, voidDocument } from "./agreements.js";
import { getLiveVersion } from "./agreementVersions.js";
import { displayAddress, resolvePublishedIds } from "./coverage.js";
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

/*
 * For these listings of one account: whose payment method each waits on, when
 * one is required and the person invoiced for it has none (its authorized payer,
 * else whoever signs for it, else the landlord). A Map listingId -> { userId,
 * name } (name null: the landlord themselves); a listing not waiting is absent.
 */
// `links`: the account's { signers, payers } when the caller has them already.
// `needsOf(userId)`: a shared check, so several calls ask once per person.
export async function paymentMethodWaits(db, landlordId, listingIds, now = new Date(), { links: given = null, needsOf = null } = {}) {
  const out = new Map();
  if (!listingIds.length) return out;
  const links = given ?? (await billingLinksFor(db, landlordId));
  const needs = new Map();
  const check = needsOf ?? ((userId) => signerNeedsPaymentMethod(db, userId, now));
  for (const listingId of listingIds) {
    const who = billedTo({ landlordId, listingId, ...links });
    if (!needs.has(who.userId)) needs.set(who.userId, await check(who.userId));
    if (needs.get(who.userId)) out.set(listingId, { userId: who.userId, name: who.name });
  }
  return out;
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
// `role`: who is being named. A signer can't have a signer of their own; a payer
// can't have a payer of their own (nameAuthorizedPayer's rule). Having a signer
// does not stop someone paying for another account.
export async function lookupPayer(db, email, { role = "signer" } = {}) {
  const clean = String(email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) return { status: "invalid" };
  const u = await userByEmail(db, clean);
  if (!u) return { status: "new", email: clean };
  if ((u.roles?.name ?? null) !== "landlord" || u.review_sandbox) {
    return { status: "refused", reason: "That email belongs to an account that can't pay for listings (a student or admin). Use another email." };
  }
  if (role === "payer") {
    if (allLinks(await payerRoleLinksFor(db, u.id, { pending: true })).length) {
      return { status: "refused", reason: "That person has their own authorized payer, so they can't pay for another account." };
    }
  } else if (allLinks(await signerLinksFor(db, u.id)).length) {
    return { status: "refused", reason: "That landlord has their own authorized signer, so they can't sign for others." };
  }
  const paysFor = new Set([...(await payeeLinks(db, u.id)), ...(await payerRoleLinksOf(db, u.id))].map((l) => l.landlord_id)).size;
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
// `listingId`: a signer for that one listing only (Wyatt, 2026-11-25). The
// account's other listings stay with the landlord (or the account's signer).
// `confirmUncover`: the landlord confirmed that a listing covered now stops
// being covered until the new signer signs.
export async function namePayer(db, { landlord, name, email, createdBy = null, listingId = null, confirmUncover = false, documenso = null, now = new Date() }) {
  const input = cleanPayerInput({ name, email });
  if (String(landlord?.email ?? "").toLowerCase() === input.email) {
    throw new BillingError("payer_is_you", "That is your own email. To sign yourself, use Review and sign.");
  }
  const links = await signerLinksFor(db, landlord.id);
  let handOff = null;
  if (listingId) {
    handOff = await checkListingHandOff(db, { landlordId: landlord.id, listingId, links, input, confirmUncover, now });
    // A draft copy of a listing they already have live is named on the live one.
    listingId = handOff.listingId;
  } else {
    if (links.account) {
      throw new BillingError("payer_exists", "You already have an authorized signer. Use Change signer instead.", 409);
    }
    const state = await agreementState(db, landlord.id, now);
    if (state.signed && state.valid) {
      throw new BillingError("already_signed", "You already signed your marketing agreement. Contact us to void it before handing it to someone else.", 409);
    }
  }
  if ((await payeeLinks(db, landlord.id)).length) {
    throw new BillingError("you_pay_for_others", "You are the authorized signer for other accounts, so you sign for yourself.", 409);
  }

  let payer = await userByEmail(db, input.email);
  // Custom terms stay with the accounts they were made for, unless the signer is
  // on the same custom version (Wyatt, 2026-11-22): then nothing changes hands.
  const own = await getLiveVersion(db, { kind: "master", landlordId: landlord.id });
  if (own?.audience === "selected") {
    const theirs = payer ? await getLiveVersion(db, { kind: "master", landlordId: payer.id }) : null;
    if (theirs?.id !== own.id) {
      throw new BillingError("negotiated_terms", "Your agreement has terms made for your account, so it can't be handed to someone else. Contact us and we'll sort it out.", 409);
    }
  }
  let created = false;
  if (payer) {
    assertCanHoldBilling(payer);
    if (allLinks(await signerLinksFor(db, payer.id)).length) {
      throw new BillingError("payer_has_payer", "That person has their own authorized signer, so they can't sign for your account.", 409);
    }
  } else {
    payer = await createBillingAccount(db, input);
    created = true;
  }

  // The listing comes off the agreement covering it now, and anything still being
  // signed for it is cancelled, before the new signer is named (confirmed above).
  let uncovered = null;
  if (handOff?.covered || handOff?.proposed) {
    try {
      uncovered = await releaseListing(db, documenso, { landlordId: landlord.id, listingId, holderId: handOff.holderId, now });
    } catch (err) {
      if (created) await db.from("users").delete().eq("id", payer.id).eq("billing_only", true);
      throw err;
    }
  }

  // Anything the landlord had started signing themselves is cancelled: they no longer sign.
  const { data: link, error: linkError } = await db
    .from("billing_payers")
    .insert({
      landlord_id: landlord.id,
      payer_id: payer.id,
      ...(listingId && { listing_id: listingId }),
      role: "signer",
      status: "active",
      signer_name: input.name,
      signer_email: input.email,
      created_by: createdBy ?? landlord.id,
      invited_at: now.toISOString(),
    })
    .select(LINK_COLUMNS)
    .single();
  if (linkError) {
    // Nothing points at a billing account made just now: remove it rather than leave an orphan.
    if (created) await db.from("users").delete().eq("id", payer.id).eq("billing_only", true);
    if (linkError.code === "23505") throw new BillingError("payer_exists", listingId ? "That listing already has an authorized signer. Reload the page." : "You already have an authorized signer. Reload the page.", 409);
    throw linkError;
  }
  // What was waiting on the signer before them for this listing now waits on them.
  if (listingId) {
    const { error: moveError } = await db
      .from("payer_publish_requests")
      .update({ payer_link_id: link.id, document_kind: null, document_id: null })
      .eq("landlord_id", landlord.id)
      .eq("listing_id", listingId)
      .eq("status", "waiting");
    if (moveError && !missingSchema(moveError)) throw moveError;
  }
  return { link, payer, created, uncovered };
}

// An account that can sign or pay for others: a landlord (or billing) account, never a student, admin or sandbox one.
export function assertCanHoldBilling(user) {
  const role = user.roles?.name ?? null;
  if (role !== "landlord" || user.review_sandbox) {
    throw new BillingError("payer_not_landlord", "That email belongs to an account that can't pay for listings. Use another email or contact us.", 409);
  }
}

// The account with this email (not deleted), with its role, or null.
export const billingUserByEmail = (db, email) => userByEmail(db, email);

// A billing-only landlord account for someone named as a signer or payer: no
// password yet (the invite carries a set-password link), no listings.
export async function createBillingAccount(db, input) {
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
  return data;
}

/*
 * Whether one listing of this account can be handed to a signer of its own: the
 * landlord lists there, it has no signer of its own yet, and the person named is
 * not already the one who signs for it. A listing covered now (by the landlord's
 * agreement or the account signer's) can still be handed over (Wyatt,
 * 2026-11-25): the landlord is told first, and it is uncovered until the new
 * signer signs. Returns { holderId, covered, proposed, address }.
 */
async function checkListingHandOff(db, { landlordId, listingId: given, links, input, confirmUncover, now }) {
  const { properties, covered, rows, holderOf } = await coverageFor(db, landlordId, now);
  const listingId = await listingToName(db, properties, given);
  const property = properties.find((p) => p.listingId === listingId);
  if (!property) throw new BillingError("not_your_listing", "That listing isn't on this account.", 404);
  if (links.byListing.has(listingId)) throw new BillingError("payer_exists", "That listing already has its own authorized signer. Use Change signer instead.", 409);
  if (links.account?.signer_email === input.email) {
    throw new BillingError("same_payer", `${links.account.signer_name} already signs for this account, including that listing.`, 409);
  }
  const isCovered = covered.has(listingId);
  if (isCovered && !confirmUncover) {
    throw new BillingError(
      "listing_covered",
      `${property.address} is already covered under a marketing agreement. It will no longer be covered until ${input.name} signs. Confirm to hand it over.`,
      409
    );
  }
  return { listingId, holderId: holderOf(listingId), covered: isCovered, proposed: rows.some((r) => r.listing_id === listingId && r.status === "proposed"), address: property.address };
}

/*
 * The listing a signer or payer is named on. A draft that is a copy of a listing
 * this account already has live (the same building) is merged into it when it is
 * published, and it is the live one that is checked and charged: so the person is
 * named there, not on a row that is about to be retired. Anything else: itself.
 */
export async function listingToName(db, properties, listingId) {
  if (!listingId) return listingId;
  const [live] = await resolvePublishedIds(db, [listingId]);
  return live && live !== listingId && properties.some((p) => p.listingId === live) ? live : listingId;
}

/*
 * One listing comes off whatever covers it for this account, because someone
 * else signs for it now: a document still being signed that lists it is
 * cancelled (it can't be edited once sent), and its coverage is released. Live
 * listings stay on the site, uncovered. Returns { released, cancelled }:
 * `cancelled` when a signer's document also covering other accounts went with it
 * (the caller emails that signer).
 */
export async function releaseListing(db, documenso, { landlordId, listingId, holderId, now = new Date() }) {
  await assertNoPaperHold(db, landlordId);
  const { data: open, error: openError } = await db
    .from("agreement_coverage")
    .select("agreement_id, amendment_id")
    .eq("user_id", landlordId)
    .eq("listing_id", listingId)
    .eq("status", "proposed");
  if (openError && !missingSchema(openError)) throw openError;
  let cancelled = null;
  // Each document once, voided under whoever it belongs to: an addendum is the
  // account's; an agreement is its holder's, read from the row itself (who holds
  // the listing NOW can differ from who was signing for it: a signer being
  // changed is no longer the holder by the time this runs).
  const docs = new Map();
  for (const r of open ?? []) {
    if (r.amendment_id) docs.set(`amendment:${r.amendment_id}`, { userId: landlordId, kind: "amendment", id: r.amendment_id });
    else if (r.agreement_id) docs.set(`master:${r.agreement_id}`, { userId: null, kind: "master", id: r.agreement_id });
  }
  for (const doc of docs.values()) {
    if (doc.kind === "master") {
      const { data: owner, error: ownerError } = await db.from("landlord_agreements").select("user_id").eq("id", doc.id).maybeSingle();
      if (ownerError) throw ownerError;
      doc.userId = owner?.user_id ?? holderId;
      // A signer's agreement being signed for several accounts is cancelled whole: tell them.
      if (doc.userId !== landlordId) {
        const { data } = await db.from("agreement_coverage").select("user_id").eq("agreement_id", doc.id).neq("status", "released").limit(500);
        const otherAccounts = [...new Set((data ?? []).map((x) => x.user_id))].filter((id) => id !== landlordId && id !== doc.userId);
        if (otherAccounts.length) cancelled = { payerId: doc.userId, otherAccounts };
      }
    }
    try {
      await voidDocument(db, documenso, { ...doc, now });
    } catch (err) {
      if (err?.code !== "already_ended") throw err;
    }
  }
  const nowIso = now.toISOString();
  const { data, error } = await db
    .from("agreement_coverage")
    .update({ status: "released", released_at: nowIso })
    .eq("user_id", landlordId)
    .eq("listing_id", listingId)
    .in("status", ["proposed", "covered"])
    .select("id");
  if (error) throw error;
  return { released: data?.length ?? 0, cancelled };
}

/*
 * A paper copy out that holds this account: their own, or their signer's printed
 * for it. While it is out nobody changes who signs (Wyatt, 2026-11-19): naming,
 * changing, revoking or ending a signer, or a landlord taking over, would void
 * the copy the team is waiting on. Checked before anything changes.
 */
export async function assertNoPaperHold(db, landlordId) {
  const { data: rows, error } = await db.from("agreement_coverage").select("agreement_id").eq("user_id", landlordId).eq("status", "proposed").not("agreement_id", "is", null).is("amendment_id", null).limit(200);
  if (missingSchema(error)) return;
  if (error) throw error;
  const ids = [...new Set((rows ?? []).map((r) => r.agreement_id))];
  const { data: own, error: ownError } = await db.from("landlord_agreements").select("id").eq("user_id", landlordId).eq("provider", PAPER).eq("status", "sent").limit(1);
  if (ownError) throw ownError;
  let held = (own ?? []).length > 0;
  if (!held && ids.length) {
    const { data, error: paperError } = await db.from("landlord_agreements").select("id").in("id", ids).eq("provider", PAPER).eq("status", "sent").limit(1);
    if (paperError) throw paperError;
    held = (data ?? []).length > 0;
  }
  if (held) throw new BillingError("paper_out", PAPER_HOLD_MESSAGE, 409);
}

/*
 * Cancel the landlord's own documents still being signed, BEFORE a payer is
 * named: a copy left open would block the payer's addendum. Throws when one
 * can't be cancelled, so nothing is named half way. A paper copy out is never
 * cancelled this way: naming a signer waits for it.
 */
export async function cancelOwnSigning(db, documenso, landlordId) {
  await assertNoPaperHold(db, landlordId);
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
 * Whether anything has been signed under the payer for this account: then the
 * signer can't simply be swapped (Change signer); the landlord revokes them first.
 */
async function signedForAccount(db, landlordId, link) {
  // Only what this signer holds: the account's other listings may be covered by someone else.
  const { covered } = await coverageFor(db, landlordId, new Date(), { holderId: link.payer_id });
  return link.listing_id ? covered.has(link.listing_id) : covered.size > 0;
}

/*
 * The landlord changes who signs, before anything was signed: the old link ends,
 * any document waiting on the old payer is cancelled, and the new one is named.
 * Waiting listings move to the new payer.
 */
// `listingId`: change the signer of that one listing (its own signer, never the account's).
export async function changePayer(db, documenso, { landlord, name, email, listingId = null, now = new Date() }) {
  const links = await signerLinksFor(db, landlord.id);
  const link = listingId ? links.byListing.get(listingId) ?? null : links.account;
  if (!link) throw new BillingError("no_payer", "You don't have an authorized signer to change.", 404);
  await assertNoPaperHold(db, landlord.id);
  if (await signedForAccount(db, landlord.id, link)) {
    throw new BillingError("payer_signed", `${link.signer_name} already signed for ${listingId ? "that listing" : "your account"}. Revoke them first, then name someone else.`, 409);
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
    made = await namePayer(db, { landlord, ...input, listingId, documenso, now });
    // Waiting listings now wait on the new payer.
    const { error: moveError } = await db.from("payer_publish_requests").update({ payer_link_id: made.link.id }).eq("payer_link_id", link.id).eq("status", "waiting");
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
  const cancelled = await cancelPayerDocuments(db, documenso, landlord.id, { payerId: link.payer_id, listingId: link.listing_id ?? null }).catch((err) => {
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
// `listingId`: only ONE listing changed hands (its own signer was changed or
// removed): only the documents that list it are cancelled. Whatever else that
// person is signing for the account stays open (Wyatt, 2026-11-25).
export async function cancelPayerDocuments(db, documenso, landlordId, { payerId = null, listingId = null } = {}) {
  // Before anything is cancelled: a paper copy holding this account stops it all.
  await assertNoPaperHold(db, landlordId);
  // Whose master: the payer given (the old one, after a change of signer), else the current one.
  const holderId = payerId ?? (await activePayerLink(db, landlordId))?.payer_id ?? null;
  // The documents still being signed that list that one listing.
  let onListing = null;
  if (listingId) {
    const { data, error } = await db.from("agreement_coverage").select("agreement_id, amendment_id").eq("user_id", landlordId).eq("listing_id", listingId).eq("status", "proposed");
    if (error && !missingSchema(error)) throw error;
    const { data: stamped } = await db.from("payer_publish_requests").select("document_kind, document_id").eq("landlord_id", landlordId).eq("listing_id", listingId).eq("status", "waiting").not("document_id", "is", null);
    onListing = {
      amendment: new Set([...(data ?? []).map((r) => r.amendment_id), ...(stamped ?? []).filter((r) => r.document_kind === "amendment").map((r) => r.document_id)].filter(Boolean)),
      master: new Set([...(data ?? []).filter((r) => !r.amendment_id).map((r) => r.agreement_id), ...(stamped ?? []).filter((r) => r.document_kind === "master").map((r) => r.document_id)].filter(Boolean)),
    };
  }
  // Only this signer's addenda: the account may have others in progress, its own or another signer's.
  let amendQ = db.from("agreement_amendments").select("id").eq("user_id", landlordId).in("status", ["not_sent", "sent"]);
  if (holderId && holderId !== landlordId) amendQ = amendQ.eq("signer_id", holderId);
  const { data: amendments, error: amendError } = await amendQ;
  if (amendError && !missingSchema(amendError)) throw amendError;
  for (const a of amendments ?? []) {
    if (onListing && !onListing.amendment.has(a.id)) continue;
    await voidDocument(db, documenso, { userId: landlordId, kind: "amendment", id: a.id }).catch(() => {});
  }
  if (!holderId || holderId === landlordId) return null;
  const { data: masters, error: masterError } = await db.from("landlord_agreements").select("id").eq("user_id", holderId).in("status", ["not_sent", "sent"]);
  if (masterError) throw masterError;
  for (const m of masters ?? []) {
    if (onListing && !onListing.master.has(m.id)) continue;
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
  // Each listing goes to its own signer, else the account's (Wyatt, 2026-11-25).
  const links = await signerLinksFor(db, landlordId);
  const all = [...new Set(listingIds.filter((id) => typeof id === "string"))].slice(0, 100);
  if (!all.length) throw new BillingError("nothing_to_add", "Choose what to add.");
  const linkOf = new Map(all.map((id) => [id, linkForListing(links, id)]));
  // Listings the landlord signs for themselves are not sent to anyone: `own`.
  const own = all.filter((id) => !linkOf.get(id));
  const ids = all.filter((id) => linkOf.get(id));
  if (!ids.length) throw new BillingError("no_payer", allLinks(links).length ? "You sign for that listing yourself: use Review and sign." : "Your account has no authorized signer.", 409);
  const link = links.account ?? linkOf.get(ids[0]);

  const { data: before, error: beforeError } = await db.from("payer_publish_requests").select("listing_id").eq("landlord_id", landlordId).eq("status", "waiting");
  if (beforeError) throw beforeError;
  const waiting = new Set((before ?? []).map((r) => r.listing_id));
  const fresh = ids.filter((id) => !waiting.has(id));
  // One row each: the partial unique index (one waiting row per listing) refuses a
  // duplicate from a double click, which is simply skipped.
  for (const listing_id of fresh) {
    const { error } = await db.from("payer_publish_requests").insert({ landlord_id: landlordId, listing_id, payer_link_id: linkOf.get(listing_id).id, status: "waiting", created_at: now.toISOString() });
    if (error && error.code !== "23505") throw error;
  }
  // Asking again clears an earlier decline (each signer's own).
  for (const l of new Map(ids.map((id) => [linkOf.get(id).id, linkOf.get(id)])).values()) {
    if (l.declined_at) await db.from("billing_payers").update({ declined_at: null }).eq("id", l.id);
  }
  // Already covered (the payer signed it before): approved now, nothing to sign.
  const { approved } = await approveWaiting(db, { landlordId, now });
  const { covered } = await coverageFor(db, landlordId, now);
  const toSign = fresh.filter((id) => !covered.has(id));
  // Grouped by signer, so each is emailed about their own listings only.
  const bySigner = new Map();
  for (const id of toSign) {
    const l = linkOf.get(id);
    const entry = bySigner.get(l.payer_id) ?? { link: l, listingIds: [] };
    entry.listingIds.push(id);
    bySigner.set(l.payer_id, entry);
  }
  return { added: fresh.length, approved, toSign, link, own, bySigner: [...bySigner.values()] };
}

// The listing ids waiting on the account's signers, oldest first. `payerId`: only
// those waiting on that signer (an account can have one per listing).
export async function waitingRequests(db, landlordId, { payerId = null } = {}) {
  const { data, error } = await db
    .from("payer_publish_requests")
    .select("id, listing_id, created_at, payer_link_id")
    .eq("landlord_id", landlordId)
    .eq("status", "waiting")
    .order("created_at", { ascending: true });
  if (missingSchema(error)) return [];
  if (error) throw error;
  if (!payerId) return data ?? [];
  const links = await signerLinksFor(db, landlordId);
  return (data ?? []).filter((w) => linkForListing(links, w.listing_id)?.payer_id === payerId);
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

/*
 * What the landlord's Billing tab shows when they have a payer. Never the
 * agreement or its terms (Wyatt, 2026-11-09).
 *   status   pending   waiting on the payer (sent, or listings waiting)
 *            declined  the payer declined the last document (no reason shown)
 *            signed    everything asked for is covered
 *   covered  [{ listingId, address }], waiting [{ listingId, address, since }]
 */
// `link`: one signer's view (a listing's own signer); default the account's signer.
// `once`: a shared memo (onceFor), so the cards of one page load each thing once.
export async function landlordPayerView(db, landlordId, now = new Date(), { link: given = null, once = onceFor() } = {}) {
  const link = given ?? (await activePayerLink(db, landlordId));
  if (!link) return null;
  const holderId = link.payer_id;
  // Only what this signer holds for the account.
  const [{ state, properties: held, covered: heldCovered, links }, allWaiting, billing, allApproved, allDeclined] = await Promise.all([
    once(`coverage:${holderId}`, () => coverageFor(db, landlordId, now, { holderId })),
    once("waiting", () => waitingRequests(db, landlordId)),
    once("billing", () => billingLinksFor(db, landlordId)),
    once("approved", () => approvedDrafts(db, landlordId)),
    once("declined", () => requestsWithListings(db, landlordId, "declined")),
  ]);
  /*
   * What THIS card is about. The account's signer: every listing they hold. A
   * listing's own signer: that one listing, even when the same person signs
   * other listings of the account (each has its own card), so the card never
   * reads "Signed" for a listing that was not signed for (Wyatt, 2026-11-25).
   */
  const inScope = link.listing_id ? (listingId) => listingId === link.listing_id : (listingId) => linkForListing(links, listingId)?.id === link.id;
  const properties = held.filter((p) => inScope(p.listingId));
  const covered = new Map([...heldCovered].filter(([listingId]) => inScope(listingId)));
  const waiting = allWaiting.filter((w) => inScope(w.listing_id));
  const nameOf = new Map(held.map((p) => [p.listingId, p.address]));
  const missingNames = [...waiting.map((w) => w.listing_id), ...(link.listing_id ? [link.listing_id] : [])].filter((id) => !nameOf.has(id));
  if (missingNames.length) {
    const { data } = await db.from("listings").select("id, address, city, state, zipcode").in("id", missingNames);
    for (const l of data ?? []) nameOf.set(l.id, displayAddress(l));
  }
  // What the signer verified (covered by their agreement), with when (Wyatt, 2026-11-09).
  const coveredList = [...covered.entries()].map(([listingId, row]) => ({ listingId, address: nameOf.get(listingId) ?? row.address, verifiedAt: row.covered_at ?? null }));
  const liveUncovered = properties.filter((p) => p.live && !covered.has(p.listingId));
  const approved = allApproved.filter((r) => inScope(r.listing_id));
  const skipDeclined = new Set([...waiting.map((w) => w.listing_id), ...covered.keys()]);
  const declined = allDeclined.filter((r) => inScope(r.listing_id) && !skipDeclined.has(r.listing_id));
  /*
   * Who is invoiced for what this card is about: the listing's authorized payer,
   * else the account's, else this signer (Wyatt, 2026-11-25). The card says the
   * signer pays only when they do, and names whoever does otherwise.
   */
  const scopeIds = [...new Set([...properties.map((p) => p.listingId), ...waiting.map((w) => w.listing_id), ...approved.map((r) => r.listing_id), ...(link.listing_id ? [link.listing_id] : [])])];
  const billed = (scopeIds.length ? scopeIds : [null]).map((listingId) => billedTo({ landlordId, listingId, ...billing }));
  const others = [...new Map(billed.filter((b) => b.userId !== holderId).map((b) => [b.userId, b.name])).values()].filter(Boolean);
  const signerPays = billed.some((b) => b.userId === holderId);
  const needsOf = (userId) => once(`method:${userId}`, () => signerNeedsPaymentMethod(db, userId, now));
  // Whose payment method each listing waits on, when one is required.
  const methodWaits = await paymentMethodWaits(db, landlordId, scopeIds, now, { links: billing, needsOf });
  const signerNeedsMethod = signerPays && (await needsOf(holderId));
  // Signed: their agreement counts, nothing is waiting on them, and (a listing's
  // own signer) that listing is actually on it.
  const nothingPending = !waiting.some((w) => !covered.has(w.listing_id)) && !liveUncovered.length && state.valid;
  const status = link.declined_at ? "declined" : nothingPending && (!link.listing_id || covered.has(link.listing_id)) ? "signed" : "pending";
  const methodOf = (listingId) => methodWaits.get(listingId)?.name ?? null;
  return {
    payer: { name: link.signer_name, email: link.signer_email, invitedAt: link.invited_at },
    // The whole account's signer, or one listing's own.
    scope: link.listing_id ? "listing" : "account",
    linkId: link.id,
    listingId: link.listing_id ?? null,
    listingAddress: link.listing_id ? nameOf.get(link.listing_id) ?? "Listing" : null,
    status,
    signedAt: status === "signed" ? state.signed?.signed_at ?? null : null,
    // What the authorized signer has done of the two things publishing needs. The
    // payment method is theirs only for what nobody else pays for: `paidBy` names
    // the authorized payer(s) invoiced instead, for some or all of it.
    signerChecklist: { agreementSigned: !!state.valid && (!link.listing_id || covered.has(link.listing_id)), paymentMethodAdded: !signerNeedsMethod, paymentMethodTheirs: signerPays, paidBy: others.length ? joinNames(others) : null },
    // Nothing has been signed for this account yet: the landlord may still change who signs.
    canChange: !coveredList.length,
    covered: coveredList.sort((a, b) => a.address.localeCompare(b.address, "en", { numeric: true })),
    // Each waits for a signature, or (covered already) for a payment method: `methodOf` says whose.
    waiting: waiting.map((w) => ({
      listingId: w.listing_id,
      address: nameOf.get(w.listing_id) ?? "Listing",
      since: w.created_at,
      waitingFor: covered.has(w.listing_id) ? (methodWaits.has(w.listing_id) ? "payment_method" : "approval") : "signature",
      ...(covered.has(w.listing_id) && methodWaits.has(w.listing_id) && { methodOf: methodOf(w.listing_id) }),
    })),
    // Approved by the signer, still drafts: the landlord publishes them (Wyatt, 2026-11-09).
    approved: approved.map((r) => ({
      listingId: r.listing_id,
      address: displayAddress(r.listings),
      approvedAt: r.resolved_at,
      waitingFor: methodWaits.has(r.listing_id) ? "payment_method" : null,
      ...(methodWaits.has(r.listing_id) && { methodOf: methodOf(r.listing_id) }),
    })),
    // On a document the signer signed (or rejected) and left off: they can be sent again.
    declined: declined.map((r) => ({ listingId: r.listing_id, address: displayAddress(r.listings), declinedAt: r.resolved_at })),
  };
}

// A memo for one page load: once(key, load) runs `load` the first time and
// answers the same promise after, so several cards share each read.
export function onceFor() {
  const made = new Map();
  return (key, load) => {
    if (!made.has(key)) made.set(key, load());
    return made.get(key);
  };
}

const joinNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "");

// A card for each listing of the account that has its own signer (Wyatt,
// 2026-11-25). Everything the cards share is read once, however many there are.
export async function landlordListingSignerViews(db, landlordId, now = new Date(), { once = onceFor() } = {}) {
  const links = await signerLinksFor(db, landlordId);
  const out = await Promise.all([...links.byListing.values()].map((link) => landlordPayerView(db, landlordId, now, { link, once })));
  return out.sort((a, b) => String(a.listingAddress).localeCompare(String(b.listingAddress), "en", { numeric: true }));
}

/*
 * What a payer sees for the accounts they pay for: per account, its name, the
 * properties covered under the payer's agreement, what waits for their signature
 * (and whether they can sign it now), and the documents they signed for it.
 */
export async function payerAccounts(db, payerId, now = new Date()) {
  const every = await payeeLinks(db, payerId);
  if (!every.length) return [];
  // One entry per account, whether they sign for all of it or some of its listings.
  const byAccount = new Map();
  for (const l of every) byAccount.set(l.landlord_id, [...(byAccount.get(l.landlord_id) ?? []), l]);
  const links = [...byAccount.values()].map((ls) => ({
    ...(ls.find((x) => !x.listing_id) ?? ls[0]),
    declined_at: ls.find((x) => x.declined_at)?.declined_at ?? null,
    listingsOnly: ls.every((x) => x.listing_id),
  }));
  const { data: users, error } = await db.from("users").select("id, name, email, company_name").in("id", links.map((l) => l.landlord_id));
  if (error) throw error;
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const out = [];
  for (const link of links) {
    // Only what this signer holds on that account.
    const [{ state, properties, covered }, waiting] = await Promise.all([
      coverageFor(db, link.landlord_id, now, { holderId: payerId }),
      waitingRequests(db, link.landlord_id, { payerId }),
    ]);
    // Covered listings held back by a missing payment method that is THEIRS to add.
    const methodWaits = await paymentMethodWaits(db, link.landlord_id, waiting.map((w) => w.listing_id), now);
    const theirMethod = (listingId) => methodWaits.get(listingId)?.userId === payerId;
    const billing = await billingLinksFor(db, link.landlord_id);
    const theirIds = [...new Set([...properties.map((p) => p.listingId), ...waiting.map((w) => w.listing_id)])];
    const paysAny = (theirIds.length ? theirIds : [null]).some((listingId) => billedTo({ landlordId: link.landlord_id, listingId, ...billing }).userId === payerId);
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
      waitingOnPaymentMethod: waiting.filter((w) => covered.has(w.listing_id) && theirMethod(w.listing_id)).map((w) => ({ listingId: w.listing_id, address: nameOf.get(w.listing_id) ?? "Listing" })),
      // What signing for it now makes: the agreement itself, or an addendum to it.
      // "paper": their agreement is out on paper, so there is nothing to sign in the app.
      needs: !state.valid ? (state.pending?.provider === PAPER && state.pending.status === "sent" ? "paper" : "agreement") : waiting.some((w) => !covered.has(w.listing_id)) || liveUncovered.length ? "addendum" : null,
      // The landlord's drafts not covered yet: the signer sees them and may add
      // them to the agreement (Wyatt, 2026-11-09). Covering a draft does not publish it.
      drafts: properties
        .filter((p) => p.draft && !p.live && !covered.has(p.listingId) && !waitingIds.has(p.listingId))
        .map((p) => ({ listingId: p.listingId, address: p.address })),
      declined: !!link.declined_at,
      // They sign for some of this account's listings only, not all of it.
      listingsOnly: link.listingsOnly,
      // Whether any of what they sign for here is invoiced to them. False when an
      // authorized payer is invoiced for all of it: no payment method is theirs to add.
      pays: paysAny,
    });
  }
  return out;
}

/*
 * The arrangement ends for one landlord account: the landlord revoked their
 * authorized signer (Wyatt, 2026-11-10), or an admin ended it. Any document the
 * signer was still signing for the account is cancelled, the account's properties
 * come off the signer's agreement, listings waiting on the signer go back to
 * plain drafts, and the link ends. The signer's agreement stays in force for
 * everything else. Nothing is taken off the site: live listings stay up,
 * uncovered, and the landlord signs for themselves or names someone else.
 * Charges already raised under the signer's agreement stay billed to the signer.
 *
 * `payerId`: only when the caller must be that signer's link (else any active link).
 * Returns { released, cancelled, link }: `cancelled` is set when a document also
 * covering other accounts was cancelled whole (the caller emails the signer).
 *
 * `listingId`: end that one listing's own signer instead (Wyatt, 2026-11-25):
 * only that listing comes off their agreement, and the account's signer (or the
 * landlord) signs for it again.
 */
export async function endPayerFor(db, documenso, { landlordId, payerId = null, listingId = null, reason = "ended by an admin", now = new Date() }) {
  const links = await signerLinksFor(db, landlordId);
  const link = listingId ? links.byListing.get(listingId) ?? null : links.account;
  if (!link || (payerId && link.payer_id !== payerId)) throw new BillingError("no_payer", listingId ? "That listing has no authorized signer of its own." : "This account has no authorized signer.", 404);
  // The listings this link holds: its own, or everything without a signer of its own.
  const held = (id) => (listingId ? id === listingId : !links.byListing.has(id));
  await assertNoPaperHold(db, landlordId);
  const nowIso = now.toISOString();
  // The link is ended first, and only by the run whose update changed it: two
  // runs at once (the signing webhook and the landlord's popup) can't both
  // cancel documents and email the signer.
  const { data: claimed, error } = await db
    .from("billing_payers")
    .update({ status: "ended", ended_reason: String(reason).slice(0, 300), ended_at: nowIso })
    .eq("id", link.id)
    .eq("status", "active")
    .select("id");
  if (error) throw error;
  if (!claimed?.length) throw new BillingError("no_payer", "This account has no authorized signer.", 404);
  try {
    const cancelled = await cancelPayerDocuments(db, documenso, landlordId, { payerId: link.payer_id, listingId: link.listing_id ?? null });
    const { data: masters, error: masterError } = await db.from("landlord_agreements").select("id").eq("user_id", link.payer_id);
    if (masterError) throw masterError;
    const masterIds = (masters ?? []).map((m) => m.id);
    let released = 0;
    if (masterIds.length) {
      // Only what this link held: the same person may still sign for other listings of the account.
      const { data: rows, error: rowsError } = await db.from("agreement_coverage").select("id, listing_id").eq("user_id", landlordId).in("agreement_id", masterIds).in("status", ["proposed", "covered"]);
      if (rowsError) throw rowsError;
      const ids = (rows ?? []).filter((r) => held(r.listing_id)).map((r) => r.id);
      if (ids.length) {
        const { data, error } = await db.from("agreement_coverage").update({ status: "released", released_at: nowIso }).in("id", ids).in("status", ["proposed", "covered"]).select("id");
        if (error) throw error;
        released = data?.length ?? 0;
      }
    }
    const { data: waitingRows, error: waitReadError } = await db.from("payer_publish_requests").select("id, listing_id").eq("landlord_id", landlordId).eq("status", "waiting");
    if (waitReadError) throw waitReadError;
    const waitIds = (waitingRows ?? []).filter((r) => held(r.listing_id)).map((r) => r.id);
    if (waitIds.length) {
      const { error: waitError } = await db.from("payer_publish_requests").update({ status: "cancelled", resolved_at: nowIso }).in("id", waitIds).eq("status", "waiting");
      if (waitError) throw waitError;
    }
    return { released, cancelled, link };
  } catch (err) {
    // A step after the claim failed (Documenso timing out, a database error).
    // The link goes back to active so the next run (the webhook, the popup's
    // sync, the daily cron) can finish the job: every step above is safe to
    // repeat. Only our own claim is undone, matched on the time it was stamped.
    const { error: undoError } = await db
      .from("billing_payers")
      .update({ status: "active", ended_reason: null, ended_at: null })
      .eq("id", link.id)
      .eq("status", "ended")
      .eq("ended_at", nowIso);
    if (undoError) console.error("[billing] could not reopen the signer link after a failed end:", undoError.message);
    throw err;
  }
}

/*
 * A landlord with an authorized signer signed their OWN agreement (startSigning's
 * takeover): now that it is signed, the signer is removed (endPayerFor). Their
 * listings were on the new agreement before the signer's coverage is released, so
 * they are covered throughout. Returns null when there is nothing to do: no
 * signer, no agreement of their own signed since the signer was named, or another
 * run (the signing webhook, the popup's sync, the daily cron) finished it first.
 */
export async function completeTakeover(db, documenso, landlordId, now = new Date()) {
  const link = await activePayerLink(db, landlordId);
  if (!link) return null;
  const { data, error } = await db.from("landlord_agreements").select("id, signed_at").eq("user_id", landlordId).eq("status", "signed");
  if (missingSchema(error)) return null;
  if (error) throw error;
  const own = (data ?? []).find((m) => m.signed_at && new Date(m.signed_at) > new Date(link.created_at));
  if (!own) return null;
  try {
    const result = await endPayerFor(db, documenso, { landlordId, reason: "revoked by the landlord, who signed their own agreement", now });
    return { ...result, agreementId: own.id };
  } catch (err) {
    if (err?.code === "no_payer") return null;
    throw err;
  }
}

/*
 * The safety net for takeovers (daily billing-review-clock cron): every landlord
 * who signed their own agreement while a signer link still stands, in case the
 * follow-up after their signature failed. Answers their landlord ids.
 */
export async function staleTakeoverLandlords(db) {
  const { data: links, error } = await db.from("billing_payers").select("landlord_id, created_at").eq("role", "signer").is("listing_id", null).eq("status", "active").limit(500);
  if (missingSchema(error)) return [];
  if (error) throw error;
  if (!links?.length) return [];
  const { data: signed, error: signedError } = await db
    .from("landlord_agreements")
    .select("user_id, signed_at")
    .in("user_id", links.map((l) => l.landlord_id))
    .eq("status", "signed");
  if (signedError) throw signedError;
  const since = new Map(links.map((l) => [l.landlord_id, new Date(l.created_at)]));
  return [...new Set((signed ?? []).filter((m) => m.signed_at && new Date(m.signed_at) > since.get(m.user_id)).map((m) => m.user_id))];
}

// The account's drafts not covered yet: what "Add drafts to your agreement" puts on the document.
// `holderId`: only the drafts that signer holds (theirs to add, never another signer's).
export async function uncoveredDraftIds(db, landlordId, now = new Date(), { holderId = null } = {}) {
  const { properties, covered } = await coverageFor(db, landlordId, now, { holderId });
  return properties.filter((p) => p.draft && !p.live && !covered.has(p.listingId)).map((p) => p.listingId);
}
