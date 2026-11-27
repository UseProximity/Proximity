/*
 * An authorized payer for a landlord account, or for one of its listings (Wyatt,
 * 2026-11-25). See payerLinks.js for the model.
 *
 * The payer is the person invoiced: they hold the payment method, get the
 * invoices and can approve or dispute the charges they are billed for. They sign
 * nothing and never see the agreement. Naming one is optional: without a payer,
 * whoever signs for a listing pays for it, as before.
 *
 *   nameAuthorizedPayer    the landlord (or an admin) names them. A new email
 *                          gets a billing-only account, as a signer does.
 *   acceptAuthorizedPayer  they accept the invite. Only from then on are they
 *                          invoiced: until they accept, whoever paid before
 *                          (the signer, or the landlord) stays billed.
 *   declineAuthorizedPayer they decline the invite: the link ends.
 *   endAuthorizedPayer     the landlord revokes them, or an admin ends it. A
 *                          payer can't step down on their own after accepting.
 *   landlordPayersView     what the landlord's Billing tab shows
 *   payingFor              what the payer's Billing tab shows
 *
 * Charges already raised stay with whoever they were billed to: a change of
 * payer only moves the charges made after it.
 *
 * `db` is a service-role Supabase client.
 */
// Relative imports: a node test imports this file, and node does not know the "@/" alias.
import { BillingError } from "./errors.js";
import { coverageFor } from "./agreements.js";
import { displayAddress, loadLandlordProperties } from "./coverage.js";
import { allLinks, linkForListing, LINK_COLUMNS, payerRoleLinksFor, payerRoleLinksOf, signerLinksFor } from "./payerLinks.js";
import { assertCanHoldBilling, billingUserByEmail, cleanPayerInput, createBillingAccount, listingToName } from "./payers.js";

const missingSchema = (error) => ["PGRST205", "42P01", "42703", "PGRST200", "PGRST204"].includes(error?.code);

// How long before the invite can be sent again.
export const PAYER_RESEND_GAP_MS = 30 * 60 * 1000;

/*
 * Name the payer for the account, or with `listingId` for that one listing.
 * Refused when:
 *   - the email is the landlord's own, or a student's, admin's or sandbox account
 *   - that level already has a payer (Change instead)
 *   - the person already pays for it as the one who signs
 *   - it would make a chain: the person named has a payer themselves, or the
 *     landlord is a payer for someone else
 * Returns { link, payer, created } (created: a new billing-only account was made).
 */
export async function nameAuthorizedPayer(db, { landlord, name, email, listingId: given = null, createdBy = null, now = new Date() }) {
  let listingId = given;
  const input = cleanPayerInput({ name, email });
  if (String(landlord?.email ?? "").toLowerCase() === input.email) {
    throw new BillingError("payer_is_you", "That is your own email. You already pay for your own listings.");
  }
  const [existing, signers] = await Promise.all([payerRoleLinksFor(db, landlord.id, { pending: true }), signerLinksFor(db, landlord.id)]);
  if (listingId) {
    const properties = await loadLandlordProperties(db, landlord.id);
    // A draft copy of a listing they already have live is named on the live one.
    listingId = await listingToName(db, properties, listingId);
    if (!properties.some((p) => p.listingId === listingId)) throw new BillingError("not_your_listing", "That listing isn't on this account.", 404);
    if (existing.byListing.has(listingId)) throw new BillingError("payer_exists", "That listing already has an authorized payer. Use Change payer instead.", 409);
    if (existing.account?.signer_email === input.email) {
      throw new BillingError("same_payer", `${existing.account.signer_name} is already the authorized payer for this account, including that listing.`, 409);
    }
  } else if (existing.account) {
    throw new BillingError("payer_exists", "You already have an authorized payer. Use Change payer instead.", 409);
  }
  // Whoever signs for it pays already, unless a payer above them takes it.
  const signer = linkForListing(signers, listingId);
  const payerAbove = listingId ? existing.account : null;
  if (signer?.signer_email === input.email && !payerAbove) {
    throw new BillingError("already_pays", `${signer.signer_name} already pays for ${listingId ? "that listing" : "this account"} as its authorized signer.`, 409);
  }
  // Only what they accepted: an invite anyone can send must not stop them naming their own payer.
  if ((await payerRoleLinksOf(db, landlord.id)).some((l) => l.accepted_at)) {
    throw new BillingError("you_pay_for_others", "This account is the authorized payer for other accounts, so it pays for itself.", 409);
  }

  let payer = await billingUserByEmail(db, input.email);
  let created = false;
  if (payer) {
    assertCanHoldBilling(payer);
    if (allLinks(await payerRoleLinksFor(db, payer.id, { pending: true })).length) {
      throw new BillingError("payer_has_payer", "That person has their own authorized payer, so they can't pay for another account.", 409);
    }
  } else {
    payer = await createBillingAccount(db, input);
    created = true;
  }

  const { data: link, error } = await db
    .from("billing_payers")
    .insert({
      landlord_id: landlord.id,
      payer_id: payer.id,
      ...(listingId && { listing_id: listingId }),
      role: "payer",
      status: "active",
      signer_name: input.name,
      signer_email: input.email,
      created_by: createdBy ?? landlord.id,
      invited_at: now.toISOString(),
    })
    .select(LINK_COLUMNS)
    .single();
  if (error) {
    if (created) await db.from("users").delete().eq("id", payer.id).eq("billing_only", true);
    if (error.code === "23505") throw new BillingError("payer_exists", "An authorized payer was just named here. Reload the page.", 409);
    throw error;
  }
  return { link, payer, created };
}

// One active payer link of this landlord, by id (theirs only), or a 404.
async function ownedLink(db, landlordId, linkId) {
  const { data, error } = await db.from("billing_payers").select(LINK_COLUMNS).eq("id", linkId).eq("landlord_id", landlordId).eq("role", "payer").eq("status", "active").maybeSingle();
  if (error && !missingSchema(error)) throw error;
  if (!data) throw new BillingError("no_payer", "That authorized payer was not found. Reload the page.", 404);
  return data;
}

// One active payer link naming this user, by id, or a 404.
async function invitedLink(db, userId, linkId) {
  const { data, error } = await db.from("billing_payers").select(LINK_COLUMNS).eq("id", linkId).eq("payer_id", userId).eq("role", "payer").eq("status", "active").maybeSingle();
  if (error && !missingSchema(error)) throw error;
  if (!data) throw new BillingError("no_invite", "That request was not found. It may have been withdrawn.", 404);
  return data;
}

/*
 * The person named accepts: from now on the charges made for it are invoiced to
 * them. Safe to repeat. Returns the link, with `justAccepted` true only for the
 * call that accepted it (so the landlord is emailed once, not on every repeat).
 * Refused while they have an authorized payer of their own (no chains).
 */
export async function acceptAuthorizedPayer(db, { userId, linkId, now = new Date() }) {
  const link = await invitedLink(db, userId, linkId);
  if (link.accepted_at) return link;
  if (allLinks(await payerRoleLinksFor(db, userId, { pending: true })).length) {
    throw new BillingError("you_have_a_payer", "You have named an authorized payer for your own account, so you can't pay for another one. Remove them first, or decline this request.", 409);
  }
  const { data, error } = await db
    .from("billing_payers")
    .update({ accepted_at: now.toISOString(), declined_at: null })
    .eq("id", link.id)
    .eq("status", "active")
    .is("accepted_at", null)
    .select(LINK_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  // Another click got there first, or the landlord withdrew it in between.
  return data ? { ...data, justAccepted: true } : await invitedLink(db, userId, linkId);
}

/*
 * The person named declines the invite, before accepting: the link ends and
 * whoever paid before keeps paying. After accepting only the landlord or an
 * admin can end it (Wyatt, 2026-11-25).
 */
export async function declineAuthorizedPayer(db, { userId, linkId, now = new Date() }) {
  const link = await invitedLink(db, userId, linkId);
  if (link.accepted_at) {
    throw new BillingError("already_accepted", "You already accepted this. To stop paying for it, ask the landlord to remove you, or contact us.", 409);
  }
  const { data, error } = await db
    .from("billing_payers")
    .update({ status: "ended", ended_reason: "declined by the payer", ended_at: now.toISOString(), declined_at: now.toISOString() })
    .eq("id", link.id)
    .eq("status", "active")
    .is("accepted_at", null)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new BillingError("status_changed", "This request just changed. Reload the page.", 409);
  return link;
}

/*
 * The landlord revokes a payer, or an admin ends it. New charges go to whoever
 * signs for the listing, or the landlord; what was already raised stays billed
 * to the payer. Returns the ended link.
 */
export async function endAuthorizedPayer(db, { landlordId, linkId, reason = "revoked by the landlord", now = new Date() }) {
  const link = await ownedLink(db, landlordId, linkId);
  const { data, error } = await db
    .from("billing_payers")
    .update({ status: "ended", ended_reason: String(reason).slice(0, 300), ended_at: now.toISOString() })
    .eq("id", link.id)
    .eq("status", "active")
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new BillingError("no_payer", "That authorized payer was already removed.", 404);
  return link;
}

/*
 * Name someone else at the same level: the old link ends and the new person is
 * invited. Refused naming leaves the old one in place. Until the new one
 * accepts, billing falls back to the signer or the landlord, not the old payer.
 */
export async function changeAuthorizedPayer(db, { landlord, linkId, name, email, createdBy = null, now = new Date() }) {
  const link = await ownedLink(db, landlord.id, linkId);
  const input = cleanPayerInput({ name, email });
  if (input.email === link.signer_email) throw new BillingError("same_payer", "That is already the authorized payer. Use Resend instead.");
  const { error } = await db.from("billing_payers").update({ status: "ended", ended_reason: "changed by the landlord", ended_at: now.toISOString() }).eq("id", link.id).eq("status", "active");
  if (error) throw error;
  try {
    const made = await nameAuthorizedPayer(db, { landlord, ...input, listingId: link.listing_id ?? null, createdBy, now });
    return { ...made, old: link };
  } catch (err) {
    await db.from("billing_payers").update({ status: "active", ended_reason: null, ended_at: null }).eq("id", link.id);
    throw err;
  }
}

/*
 * The invite goes out again, at most every 30 minutes. `send(link)` sends it and
 * answers whether it went: the time is stamped only once it did, so a failed
 * send can be tried again at once. Returns the link.
 */
export async function touchPayerInvite(db, { landlordId, linkId, send = null, now = new Date() }) {
  const link = await ownedLink(db, landlordId, linkId);
  if (link.accepted_at) throw new BillingError("already_accepted", `${link.signer_name} already accepted.`, 409);
  const wait = PAYER_RESEND_GAP_MS - (now.getTime() - new Date(link.invited_at).getTime());
  if (wait > 0) {
    const mins = Math.ceil(wait / 60000);
    throw new BillingError("too_soon", `We emailed them recently. You can resend in ${mins} minute${mins === 1 ? "" : "s"}.`, 429);
  }
  if (send && !(await send(link))) throw new BillingError("send_failed", "We couldn't send the email. Try again in a few minutes.", 502);
  const { error } = await db.from("billing_payers").update({ invited_at: now.toISOString() }).eq("id", link.id);
  if (error) throw error;
  return link;
}

// The address of each listing that still exists. One that was deleted is left
// out. Reading never ends its links (PR 486 review: an admin's read-only
// view-as goes through here): the delete paths and the daily billing cron
// (endLinksOnDeletedListings) do that.
async function addressesOf(db, listingIds) {
  const ids = [...new Set(listingIds.filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("listings").select("id, address, city, state, zipcode, deleted_at").in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const l of data ?? []) if (!l.deleted_at) out.set(l.id, displayAddress(l));
  }
  return out;
}

// A link on a listing that was deleted is not shown.
const stillThere = (addressOf) => (l) => !l.listing_id || addressOf.has(l.listing_id);

const payerView = (link, addressOf) => ({
  linkId: link.id,
  scope: link.listing_id ? "listing" : "account",
  listingId: link.listing_id ?? null,
  listingAddress: link.listing_id ? addressOf.get(link.listing_id) ?? "Listing" : null,
  name: link.signer_name,
  email: link.signer_email,
  // pending: invited, not billed yet. accepted: invoiced for the charges made since.
  status: link.accepted_at ? "accepted" : "pending",
  invitedAt: link.invited_at,
  acceptedAt: link.accepted_at ?? null,
});

/*
 * What the landlord's Billing tab shows: { account, listings }. `account` is the
 * account-wide payer or null; `listings` the listings with a payer of their own.
 */
export async function landlordPayersView(db, landlordId) {
  const links = await payerRoleLinksFor(db, landlordId, { pending: true });
  const addressOf = await addressesOf(db, [...links.byListing.keys()]);
  return {
    account: links.account ? payerView(links.account, addressOf) : null,
    listings: [...links.byListing.values()].filter(stillThere(addressOf)).map((l) => payerView(l, addressOf)).sort((a, b) => a.listingAddress.localeCompare(b.listingAddress, "en", { numeric: true })),
  };
}

/*
 * What the payer's Billing tab shows: each account (or listing of one) they were
 * asked to pay for, with whether they have accepted yet.
 */
export async function payingFor(db, payerId) {
  const links = await payerRoleLinksOf(db, payerId);
  if (!links.length) return [];
  const { data: users, error } = await db.from("users").select("id, name, email, company_name").in("id", [...new Set(links.map((l) => l.landlord_id))]);
  if (error) throw error;
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const addressOf = await addressesOf(db, links.map((l) => l.listing_id));
  return links.filter(stillThere(addressOf)).map((l) => {
    const u = userById.get(l.landlord_id);
    return {
      linkId: l.id,
      landlordId: l.landlord_id,
      accountName: u?.company_name?.trim() || u?.name || u?.email || "Landlord account",
      scope: l.listing_id ? "listing" : "account",
      listingId: l.listing_id ?? null,
      listingAddress: l.listing_id ? addressOf.get(l.listing_id) ?? "Listing" : null,
      status: l.accepted_at ? "accepted" : "pending",
      invitedAt: l.invited_at,
      acceptedAt: l.accepted_at ?? null,
    };
  });
}

/*
 * Who signs and who pays for each listing of an account, for the "Who signs and
 * who pays" card (landlord) and the admin's row:
 *   { account: { signer, payer }, listings: [{ listingId, address, live, draft,
 *     covered, ownSigner, ownPayer, signs, pays }] }
 * `ownSigner` / `ownPayer`: set on that listing itself ({ linkId, name, email,
 * status }), else null. `signs` / `pays`: who it comes down to in the end
 * ({ name, via }: name null means the landlord).
 */
export async function assignmentsFor(db, landlordId, now = new Date()) {
  const [{ properties, covered, links: signers }, pending] = await Promise.all([coverageFor(db, landlordId, now), payerRoleLinksFor(db, landlordId, { pending: true })]);
  const accepted = { account: pending.account?.accepted_at ? pending.account : null, byListing: new Map([...pending.byListing].filter(([, l]) => l.accepted_at)) };
  const person = (l) => (l ? { linkId: l.id, name: l.signer_name, email: l.signer_email, status: l.role === "payer" ? (l.accepted_at ? "accepted" : "pending") : l.declined_at ? "declined" : "active" } : null);
  return {
    account: { signer: person(signers.account), payer: person(pending.account) },
    listings: properties
      .map((p) => {
        const signer = linkForListing(signers, p.listingId);
        const payer = linkForListing(accepted, p.listingId);
        return {
          listingId: p.listingId,
          address: p.address,
          live: !!p.live,
          draft: !!p.draft,
          covered: covered.has(p.listingId),
          ownSigner: person(signers.byListing.get(p.listingId) ?? null),
          ownPayer: person(pending.byListing.get(p.listingId) ?? null),
          signs: { name: signer?.signer_name ?? null, via: signer ? (signer.listing_id ? "listing" : "account") : "landlord" },
          pays: payer
            ? { name: payer.signer_name, via: payer.listing_id ? "listing_payer" : "account_payer" }
            : { name: signer?.signer_name ?? null, via: signer ? "signer" : "landlord" },
        };
      })
      .sort((a, b) => a.address.localeCompare(b.address, "en", { numeric: true })),
  };
}
