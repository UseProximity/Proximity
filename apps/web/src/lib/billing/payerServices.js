/*
 * The real email, storage and publishing behind payers.js, for the routes and
 * the signing webhook (Project B). payers.js holds the rules; this sends.
 */
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { mintPasswordSetupUrl } from "@/lib/auth/passwordReset";
import { getMrecForm, MREC_FORM_FILENAME } from "@/lib/users/mrecForm";
import { readAgreementFile } from "./agreementFiles.js";
import { getLiveVersion } from "./agreementVersions.js";
import { agreementState, coverageFor } from "./agreements.js";
import { displayAddress } from "./coverage.js";
import { approvedDrafts, approveWaiting, canSignIn, completeTakeover, settleSignedDocument, settleStaleDocuments, signerNeedsPaymentMethod, staleTakeoverLandlords } from "./payers.js";
import { activePayerLink, allLinks, billedTo, billingLinksFor, signerLinksFor } from "./payerLinks.js";
import { sendAuthorizedPayerAcceptedEmail, sendAuthorizedPayerAssignedEmail, sendAuthorizedPayerDeclinedEmail, sendAuthorizedPayerInviteEmail, sendAuthorizedPayerRemovedEmail, sendChargeCreatedEmail, sendPayeeAssignedEmail, sendPayeeSignedEmail, sendPayerDocumentCancelledEmail, sendPayerInviteEmail, sendPayerRequestEmail, sendPayerRevokedEmail } from "./billingEmails.js";

const BILLING_PATH = "/dashboard/landlord?tab=billing#marketing-agreement";

async function userRow(id) {
  const { data } = await supabase
    .from("users")
    .select("id, name, email, company_name, password_hash, google_account, apple_account")
    .eq("id", id)
    .maybeSingle();
  return data;
}

const landlordLabel = (u) => u?.company_name?.trim() || u?.name || "A landlord";

// The PDFs a payer reads before signing: the agreement they would sign, and the MREC form.
async function invitePdfs(payerId) {
  const out = [];
  try {
    const version = await getLiveVersion(supabase, { kind: "master", landlordId: payerId });
    if (version?.file_key) {
      out.push({ filename: "proximity-marketing-agreement.pdf", content: Buffer.from(await readAgreementFile(version.file_key)), contentType: "application/pdf" });
    }
  } catch (err) {
    console.error("billing: could not attach the agreement to a payer invite", err?.message);
  }
  try {
    const form = await getMrecForm(supabase);
    if (form?.key) out.push({ filename: MREC_FORM_FILENAME, content: Buffer.from(await readAgreementFile(form.key)), contentType: "application/pdf" });
  } catch (err) {
    console.error("billing: could not attach the MREC form to a payer invite", err?.message);
  }
  return out;
}

/*
 * Email the payer: who asked, for which properties, the two PDFs, and a way in.
 * An account that can't sign in yet gets a set-password link that lands on Billing.
 * `landlordIds`: several accounts assigned at once (an admin), in ONE email.
 */
export async function sendPayerInvite({ landlordId = null, landlordIds = null, payerId }) {
  const ids = [...new Set([...(landlordIds ?? []), landlordId].filter(Boolean))];
  const payer = await userRow(payerId);
  // Every link this signer has on these accounts: the whole account, or some of its listings.
  const links = (await Promise.all(ids.map((id) => signerLinksFor(supabase, id)))).flatMap((ls) => allLinks(ls).filter((l) => l.payer_id === payerId));
  if (!payer?.email || !links.length) return false;
  const accountIds = [...new Set(links.map((l) => l.landlord_id))];
  const landlords = await Promise.all(accountIds.map((id) => userRow(id)));
  const state = await agreementState(supabase, accountIds[0], new Date(), { holderId: payerId });
  const addresses = [];
  for (const id of accountIds) {
    // Only what this signer holds there: live listings of an account they sign
    // all of, and each listing named for them whether live or not.
    const { properties } = await coverageFor(supabase, id, new Date(), { holderId: payerId });
    const named = new Set(links.filter((l) => l.landlord_id === id && l.listing_id).map((l) => l.listing_id));
    addresses.push(...properties.filter((p) => p.live || named.has(p.listingId)).map((p) => p.address));
  }
  const names = landlords.map(landlordLabel);
  const landlordName = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const signUrl = `${getBaseUrl()}${BILLING_PATH}`;
  let setupUrl = null;
  if (!canSignIn(payer)) {
    const base = await mintPasswordSetupUrl(payerId);
    setupUrl = base ? `${base}&next=${encodeURIComponent(BILLING_PATH)}` : null;
  }
  const sent = await sendPayerInviteEmail(
    { id: payer.id, email: payer.email, name: links[0].signer_name || payer.name },
    { landlordName, addresses, setupUrl, signUrl, existingAgreement: state.valid },
    await invitePdfs(payerId)
  );
  if (sent) await supabase.from("billing_payers").update({ invited_at: new Date().toISOString() }).in("id", links.map((l) => l.id));
  return sent;
}

// To each landlord an admin assigned a payer to: who signs and pays now.
// `listingIds`: when they sign for those listings only.
export async function sendPayerAssigned({ landlordId, payerName, listingIds = [] }) {
  const landlord = await userRow(landlordId);
  if (!landlord?.email) return false;
  return sendPayeeAssignedEmail(landlord, { payerName, listings: await addressesFor(listingIds), billingUrl: `${getBaseUrl()}/dashboard/landlord?tab=billing` });
}

async function addressesFor(listingIds) {
  const ids = [...new Set((listingIds ?? []).filter(Boolean))];
  if (!ids.length) return [];
  const { data } = await supabase.from("listings").select("address, city, state, zipcode").in("id", ids);
  return (data ?? []).map(displayAddress);
}

// More listings now wait for the payer: one email per send (Wyatt, 2026-11-09).
// `link`: the signer to email (a listing's own signer); default the account's.
export async function sendPayerRequest({ landlordId, addresses, link: given = null }) {
  const link = given ?? (await activePayerLink(supabase, landlordId));
  if (!link) return false;
  const [landlord, payer] = await Promise.all([userRow(landlordId), userRow(link.payer_id)]);
  if (!payer?.email) return false;
  return sendPayerRequestEmail(
    { id: payer.id, email: payer.email, name: link.signer_name || payer.name },
    { landlordName: landlordLabel(landlord), addresses, signUrl: `${getBaseUrl()}${BILLING_PATH}` }
  );
}

// To the landlord: what their signer approved (ready to publish) and declined.
// `signerId`: the signer who signed (an account can have several, one per listing).
async function notifyApproved(landlordId, { approved = [], declined = [], withdrawn = [] }, { signerId = null } = {}) {
  const landlord = await userRow(landlordId);
  if (!landlord?.email) return;
  const links = await billingLinksFor(supabase, landlordId);
  const link = (signerId ? allLinks(links.signers).find((l) => l.payer_id === signerId) : null) ?? links.signers.account ?? allLinks(links.signers)[0] ?? null;
  const payerName = link?.signer_name ?? "Your authorized signer";
  // Held back by a payment method: of whoever is invoiced for what this signer holds.
  const billed = link ? billedTo({ landlordId, listingId: link.listing_id ?? null, ...links }) : null;
  const waitingOnPayment = billed ? await signerNeedsPaymentMethod(supabase, billed.userId) : false;
  await sendPayeeSignedEmail(landlord, { payerName, approved, declined, withdrawn, waitingOnPayment, billingUrl: `${getBaseUrl()}/dashboard/landlord?tab=billing` });
}

// Approve what each account was waiting for that is covered already (nothing to sign).
export async function releaseWaitingFor(landlordId) {
  const { approved } = await approveWaiting(supabase, { landlordId });
  if (approved.length) await notifyApproved(landlordId, { approved }).catch((err) => console.error("billing: approval email failed", err?.message));
  return approved;
}

/*
 * After a signature (agreementServices onSigned): only the accounts on that
 * document (Wyatt, 2026-11-09). Each listing on it is approved or declined, and
 * the landlord gets one email saying which, plus any live listing taken off.
 * Nothing is published: the landlord publishes what was approved.
 */
export async function afterPayerSigned({ signerId, kind, documentId, accounts = {}, withdrawn = [] }) {
  const results = documentId ? await settleSignedDocument(supabase, { kind, id: documentId, accounts: Object.keys(accounts) }) : {};
  for (const landlordId of Object.keys(results)) {
    if (landlordId === signerId) continue;
    const { approved, declined } = results[landlordId];
    // Live listings of this account taken off the site because the signer left them off.
    let gone = [];
    if (withdrawn.length) {
      const { data } = await supabase.from("listing_landlords").select("listing_id, listings!inner(address)").eq("user_id", landlordId).in("listing_id", withdrawn);
      gone = (data ?? []).map((r) => r.listings?.address).filter(Boolean);
    }
    if (!accounts[landlordId] && !approved.length && !declined.length && !gone.length) continue;
    await notifyApproved(landlordId, { approved, declined, withdrawn: gone }, { signerId }).catch((err) => console.error("billing: signed email failed", err?.message));
  }
}

// The daily safety net (cron): settle signatures whose follow-up never finished.
export async function settleStalePayerDocuments() {
  return settleStaleDocuments(supabase, { notify: (landlordId, r) => notifyApproved(landlordId, r) });
}

// After a payer adds a payment method: each account's approved drafts can now be published.
export async function afterPayerMethodAdded(payerId) {
  // Every account they sign or pay for: a missing method of either holds listings back.
  const { data } = await supabase.from("billing_payers").select("landlord_id").eq("payer_id", payerId).eq("status", "active");
  for (const r of new Map((data ?? []).map((x) => [x.landlord_id, x])).values()) {
    try {
      await approveWaiting(supabase, { landlordId: r.landlord_id });
      const ready = await approvedDrafts(supabase, r.landlord_id);
      if (ready.length) await notifyApproved(r.landlord_id, { approved: ready.map((x) => displayAddress(x.listings)) });
    } catch (err) {
      console.error("billing: ready-to-publish email after payment method failed", err?.message);
    }
  }
}

// The payer's document was cancelled because one account changed signer or ended:
// what they were signing for the other accounts has to be reopened.
export async function sendPayerDocumentCancelled({ payerId, otherAccounts = [], causeLandlordId, reason = "changed" }) {
  const payer = await userRow(payerId);
  if (!payer?.email || !otherAccounts.length) return false;
  const [cause, ...others] = await Promise.all([userRow(causeLandlordId), ...otherAccounts.map((id) => userRow(id))]);
  return sendPayerDocumentCancelledEmail(
    { id: payer.id, email: payer.email, name: payer.name },
    { causeName: landlordLabel(cause), accountNames: others.map(landlordLabel), reason, signUrl: `${getBaseUrl()}${BILLING_PATH}` }
  );
}

/*
 * Tell a signer the landlord revoked them (Wyatt, 2026-11-10). `ended` is what
 * endPayerFor answered. When a document they were signing for other accounts too
 * was cancelled with it, that one email says both.
 */
export async function sendPayerRevoked({ landlordId, ended, tookOver = false }) {
  if (!ended?.link) return false;
  if (ended.cancelled) return sendPayerDocumentCancelled({ ...ended.cancelled, causeLandlordId: landlordId, reason: "ended" });
  const [landlord, payer] = await Promise.all([userRow(landlordId), userRow(ended.link.payer_id)]);
  if (!payer?.email) return false;
  return sendPayerRevokedEmail(
    { id: payer.id, email: payer.email, name: ended.link.signer_name || payer.name },
    { landlordName: landlordLabel(landlord), released: ended.released ?? 0, tookOver, billingUrl: `${getBaseUrl()}${BILLING_PATH}` }
  );
}

/*
 * A landlord with an authorized signer signed their own agreement: the signer is
 * removed and told. Called after every signature of a landlord's own agreement
 * (the webhook and the popup's sync); a follow-up that failed is finished by the
 * daily billing-review-clock cron (finishStaleTakeovers).
 * Returns whether the signer was removed.
 */
export async function finishTakeover(landlordId, documenso) {
  const ended = await completeTakeover(supabase, documenso, landlordId);
  if (!ended) return false;
  await sendPayerRevoked({ landlordId, ended, tookOver: true }).catch((err) => console.error("billing: revoked email failed", err?.message));
  return true;
}

// The daily safety net: finish every takeover whose follow-up never ran.
export async function finishStaleTakeovers(documenso) {
  let finished = 0;
  for (const landlordId of await staleTakeoverLandlords(supabase)) {
    try {
      if (await finishTakeover(landlordId, documenso)) finished += 1;
    } catch (err) {
      console.error("billing: finishing a takeover failed", err?.message);
    }
  }
  return { finished };
}

// ── Authorized payer (Wyatt, 2026-11-25) ─────────────────────────────────────

const PAYER_PATH = "/dashboard/landlord?tab=billing#paying-for";
const billingUrl = () => `${getBaseUrl()}/dashboard/landlord?tab=billing`;

async function listingAddress(listingId) {
  return listingId ? (await addressesFor([listingId]))[0] ?? null : null;
}

/*
 * Email the person a landlord named as authorized payer: who asked, for what,
 * and a way in to accept or decline. An account that can't sign in yet gets a
 * set-password link that lands on Billing. `link` is the billing_payers row.
 */
export async function sendAuthorizedPayerInvite({ link }) {
  const [landlord, payer] = await Promise.all([userRow(link.landlord_id), userRow(link.payer_id)]);
  if (!payer?.email) return false;
  let setupUrl = null;
  if (!canSignIn(payer)) {
    const base = await mintPasswordSetupUrl(payer.id);
    setupUrl = base ? `${base}&next=${encodeURIComponent(PAYER_PATH)}` : null;
  }
  return sendAuthorizedPayerInviteEmail(
    { id: payer.id, email: payer.email, name: link.signer_name || payer.name },
    { landlordName: landlordLabel(landlord), listingAddress: await listingAddress(link.listing_id), setupUrl, acceptUrl: `${getBaseUrl()}${PAYER_PATH}` }
  );
}

// To the landlord: the person they named accepted (`accepted`) or declined.
export async function sendAuthorizedPayerAnswer({ link, accepted }) {
  const landlord = await userRow(link.landlord_id);
  if (!landlord?.email) return false;
  const input = { payerName: link.signer_name, listingAddress: await listingAddress(link.listing_id), billingUrl: billingUrl() };
  return accepted ? sendAuthorizedPayerAcceptedEmail(landlord, input) : sendAuthorizedPayerDeclinedEmail(landlord, input);
}

// To a payer who was removed (or whose invite was withdrawn before they accepted).
export async function sendAuthorizedPayerRemoved({ link }) {
  const [landlord, payer] = await Promise.all([userRow(link.landlord_id), userRow(link.payer_id)]);
  if (!payer?.email) return false;
  return sendAuthorizedPayerRemovedEmail(
    { id: payer.id, email: payer.email, name: link.signer_name || payer.name },
    { landlordName: landlordLabel(landlord), listingAddress: await listingAddress(link.listing_id), accepted: !!link.accepted_at, billingUrl: billingUrl() }
  );
}

// To a landlord an admin named an authorized payer for.
export async function sendAuthorizedPayerAssigned({ landlordId, payerName, listingIds = [] }) {
  const landlord = await userRow(landlordId);
  if (!landlord?.email) return false;
  return sendAuthorizedPayerAssignedEmail(landlord, { payerName, listings: await addressesFor(listingIds), billingUrl: billingUrl() });
}

/*
 * A new charge to review goes to the landlord AND, when an authorized payer is
 * billed for it, to that payer (Wyatt, 2026-11-25): either can approve or dispute
 * it. `view` is the admin charge view (with .landlord), `payerId` charges.payer_id.
 * Returns whether the landlord's copy was handed to the mailer.
 */
export async function sendChargeCreatedToAll({ view, payerId = null }) {
  const input = { charge: view, reviewEndsAt: view.reviewEndsAt, paymentsUrl: billingUrl() };
  let payer = null;
  let payerLink = null;
  if (payerId && payerId !== view.landlord.id) {
    const { payers } = await billingLinksFor(supabase, view.landlord.id);
    payerLink = allLinks(payers).find((l) => l.payer_id === payerId) ?? null;
    if (payerLink) payer = await userRow(payerId);
  }
  let emailed = false;
  if (view.landlord.email) {
    emailed = await sendChargeCreatedEmail({ id: view.landlord.id, email: view.landlord.email, name: view.landlord.name }, { ...input, billedTo: payerLink?.signer_name ?? null });
  }
  if (payer?.email) {
    await sendChargeCreatedEmail(
      { id: payer.id, email: payer.email, name: payerLink.signer_name || payer.name },
      { ...input, forAccount: view.landlord.company_name?.trim() || view.landlord.name || "a landlord" }
    ).catch((err) => console.error("billing: new charge email to the payer failed", err?.message));
  }
  return emailed;
}
