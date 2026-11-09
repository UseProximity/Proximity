/*
 * A payer for a landlord account (Project B, Wyatt 2026-11-09). See
 * payerLinks.js for the model. This is everything a landlord, a payer and the
 * signing webhook do with one:
 *
 *   namePayer             the landlord names the person who signs and pays. A new
 *                         email gets a billing-only landlord account (no password
 *                         yet: the invite carries a set-password link).
 *   requestPayerCoverage  the landlord confirmed that what they are publishing
 *                         goes to their payer: it waits as a draft, on the
 *                         addendum still waiting for the payer's signature, or a
 *                         new one when the last was signed
 *   releaseWaiting        after the payer signs (or adds a payment method): what
 *                         is now allowed goes live and the landlord is emailed
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
import { activePayerLink, payeeLinks } from "./payerLinks.js";
import { agreementState, coverageFor, voidDocument } from "./agreements.js";
import { getLiveVersion } from "./agreementVersions.js";
import { displayAddress } from "./coverage.js";

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
    return { status: "refused", reason: "That landlord has someone else paying for their own account, so they can't pay for others." };
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
    throw new BillingError("payer_exists", "You already have a payer. Use Change signer instead.", 409);
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
    throw new BillingError("you_pay_for_others", "You pay for other accounts, so you sign for yourself.", 409);
  }

  let payer = await userByEmail(db, input.email);
  let created = false;
  if (payer) {
    const role = payer.roles?.name ?? null;
    if (role !== "landlord" || payer.review_sandbox) {
      throw new BillingError("payer_not_landlord", "That email belongs to an account that can't pay for listings. Use another email or contact us.", 409);
    }
    if (await activePayerLink(db, payer.id)) {
      throw new BillingError("payer_has_payer", "That person has someone else paying for their account, so they can't pay for yours.", 409);
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
    if (linkError.code === "23505") throw new BillingError("payer_exists", "You already have a payer. Reload the page.", 409);
    throw linkError;
  }
  return { link, payer, created };
}

// Cancel the landlord's own documents still being signed (they have a payer now).
export async function cancelOwnSigning(db, documenso, landlordId) {
  const state = await agreementState(db, landlordId);
  const own = [];
  if (state.pendingAmendment && !state.pendingAmendment.signer_id) own.push(["amendment", state.pendingAmendment.id]);
  // The master rows read are the payer's now; the landlord's own pending master is looked up directly.
  const { data: masters } = await db.from("landlord_agreements").select("id").eq("user_id", landlordId).in("status", ["not_sent", "sent"]);
  for (const m of masters ?? []) own.push(["master", m.id]);
  for (const [kind, id] of own) {
    await voidDocument(db, documenso, { userId: landlordId, kind, id }).catch((err) => console.error("billing: cancelling own signing failed", err?.message));
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
  if (!link) throw new BillingError("no_payer", "You don't have a payer to change.", 404);
  if (await signedForAccount(db, landlord.id)) {
    throw new BillingError("payer_signed", `${link.signer_name} already signed for your account. Only they can void it.`, 409);
  }
  const input = cleanPayerInput({ name, email });
  if (input.email === link.signer_email) throw new BillingError("same_payer", "That is already your payer. Use Resend instead.");
  await cancelPayerDocuments(db, documenso, landlord.id);
  const { error } = await db
    .from("billing_payers")
    .update({ status: "ended", ended_reason: "changed by the landlord", ended_at: now.toISOString() })
    .eq("id", link.id)
    .eq("status", "active");
  if (error) throw error;
  try {
    const made = await namePayer(db, { landlord, ...input, now });
    // Waiting listings now wait on the new payer.
    const { error: moveError } = await db.from("payer_publish_requests").update({ payer_link_id: made.link.id }).eq("landlord_id", landlord.id).eq("status", "waiting");
    if (moveError) throw moveError;
    return made;
  } catch (err) {
    // The new payer was refused: the old one stays.
    await db.from("billing_payers").update({ status: "active", ended_reason: null, ended_at: null }).eq("id", link.id);
    throw err;
  }
}

// Documents still being signed for this account by its payer: the addendum, or a master started for it.
async function cancelPayerDocuments(db, documenso, landlordId) {
  const state = await agreementState(db, landlordId);
  if (state.pendingAmendment) {
    await voidDocument(db, documenso, { userId: landlordId, kind: "amendment", id: state.pendingAmendment.id }).catch(() => {});
  }
  if (state.pending && !state.valid && state.holderId !== landlordId) {
    const { data } = await db.from("agreement_coverage").select("id").eq("agreement_id", state.pending.id).eq("user_id", landlordId).neq("status", "released").limit(1);
    if (data?.length) await voidDocument(db, documenso, { userId: state.holderId, kind: "master", id: state.pending.id }).catch(() => {});
  }
}

/*
 * The landlord confirmed: these listings go to their payer's addendum. They stay
 * drafts, waiting. If the payer has a copy open for this account it is
 * cancelled, so the next one they open lists everything waiting (a signed copy
 * can't change). Returns { added, firstRequest }: firstRequest when nothing was
 * waiting before, so the payer is emailed once per addendum, not per listing.
 */
export async function requestPayerCoverage(db, documenso, { landlordId, listingIds = [], now = new Date() }) {
  const link = await activePayerLink(db, landlordId);
  if (!link) throw new BillingError("no_payer", "Your account has no payer.", 409);
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
  // A copy the payer has open for this account can't change: cancel it so the next one lists everything.
  if (fresh.length) await cancelPayerDocuments(db, documenso, landlordId);
  return { added: fresh.length, firstRequest: waiting.size === 0 && fresh.length > 0, link };
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

/*
 * After the payer signs (or adds a payment method): every waiting listing the
 * listing gate now allows goes live, and the landlord is emailed which. Listings
 * that are gone are dropped. `deps`: { checkGate(landlordId, listingIds) -> gate,
 * publish(landlordId, listingId), notifyLive({ landlordId, payerName, addresses }) }.
 */
export async function releaseWaiting(db, { landlordId, deps, now = new Date() }) {
  const waiting = await waitingRequests(db, landlordId);
  if (!waiting.length) return { published: [] };
  const ids = waiting.map((w) => w.listing_id);
  const { data: listings, error } = await db.from("listings").select("id, address, city, state, zipcode, deleted_at").in("id", ids);
  if (error) throw error;
  const byId = new Map((listings ?? []).map((l) => [l.id, l]));
  const gone = ids.filter((id) => !byId.get(id) || byId.get(id).deleted_at);
  if (gone.length) await cancelWaiting(db, landlordId, gone, now);
  const alive = ids.filter((id) => !gone.includes(id));
  if (!alive.length) return { published: [] };

  const gate = await deps.checkGate(landlordId, alive);
  if (!gate.allowed && gate.missing.some((m) => m !== "agreement")) return { published: [], blocked: gate.missing };
  const stillUncovered = new Set((gate.uncovered ?? []).map((u) => u.listingId));
  const published = [];
  for (const id of alive) {
    if (stillUncovered.has(id)) continue;
    try {
      await deps.publish(landlordId, id);
      const { error: doneError } = await db
        .from("payer_publish_requests")
        .update({ status: "published", resolved_at: now.toISOString() })
        .eq("landlord_id", landlordId)
        .eq("listing_id", id)
        .eq("status", "waiting");
      if (doneError) throw doneError;
      published.push(displayAddress(byId.get(id)));
    } catch (err) {
      console.error("billing: publishing a listing after the payer signed failed", err?.message);
    }
  }
  if (published.length && deps.notifyLive) {
    const link = await activePayerLink(db, landlordId);
    try {
      await deps.notifyLive({ landlordId, payerName: link?.signer_name ?? "Your payer", addresses: published });
    } catch (err) {
      console.error("billing: listing-live email failed", err?.message);
    }
  }
  return { published };
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
  const coveredList = [...covered.entries()].map(([listingId, row]) => ({ listingId, address: nameOf.get(listingId) ?? row.address }));
  const live = properties.filter((p) => p.live);
  const liveUncovered = live.filter((p) => !covered.has(p.listingId));
  const status = link.declined_at ? "declined" : waiting.length || liveUncovered.length || !state.valid ? "pending" : "signed";
  return {
    payer: { name: link.signer_name, email: link.signer_email, invitedAt: link.invited_at },
    status,
    signedAt: status === "signed" ? state.signed?.signed_at ?? null : null,
    // Nothing has been signed for this account yet: the landlord may still change who signs.
    canChange: !coveredList.length,
    covered: coveredList.sort((a, b) => a.address.localeCompare(b.address, "en", { numeric: true })),
    waiting: waiting.map((w) => ({ listingId: w.listing_id, address: nameOf.get(w.listing_id) ?? "Listing", since: w.created_at })),
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
  const out = [];
  for (const link of links) {
    const [{ state, properties, covered }, waiting] = await Promise.all([coverageFor(db, link.landlord_id, now), waitingRequests(db, link.landlord_id)]);
    const u = userById.get(link.landlord_id);
    const nameOf = new Map(properties.map((p) => [p.listingId, p.address]));
    const liveUncovered = properties.filter((p) => p.live && !covered.has(p.listingId));
    out.push({
      landlordId: link.landlord_id,
      accountName: u?.company_name?.trim() || u?.name || u?.email || "Landlord account",
      accountEmail: u?.email ?? null,
      since: link.created_at,
      covered: [...covered.entries()]
        .map(([listingId, row]) => ({ listingId, address: nameOf.get(listingId) ?? row.address }))
        .sort((a, b) => a.address.localeCompare(b.address, "en", { numeric: true })),
      waiting: [
        ...waiting.map((w) => ({ listingId: w.listing_id, address: nameOf.get(w.listing_id) ?? "Listing" })),
        ...liveUncovered.filter((p) => !waiting.some((w) => w.listing_id === p.listingId)).map((p) => ({ listingId: p.listingId, address: p.address })),
      ],
      // What signing for it now makes: the agreement itself, or an addendum to it.
      needs: !state.valid ? "agreement" : waiting.length || liveUncovered.length ? "addendum" : null,
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
export async function endPayerFor(db, documenso, { payerId, landlordId, now = new Date() }) {
  const link = await activePayerLink(db, landlordId);
  if (!link || link.payer_id !== payerId) throw new BillingError("not_payer", "You don't pay for that account.", 404);
  await cancelPayerDocuments(db, documenso, landlordId);
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
  const { error: waitError } = await db.from("payer_publish_requests").update({ status: "cancelled", resolved_at: nowIso }).eq("landlord_id", landlordId).eq("status", "waiting");
  if (waitError) throw waitError;
  const { error } = await db.from("billing_payers").update({ status: "ended", ended_reason: "voided by the payer", ended_at: nowIso }).eq("id", link.id);
  if (error) throw error;
  return { released };
}
