/*
 * The real email, storage and publishing behind payers.js, for the routes and
 * the signing webhook (Project B). payers.js holds the rules; this sends.
 */
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { mintPasswordSetupUrl } from "@/lib/auth/passwordReset";
import { publishProperty } from "@/lib/listings/publish";
import { getMrecForm, MREC_FORM_FILENAME } from "@/lib/users/mrecForm";
import { readAgreementFile } from "./agreementFiles.js";
import { getLiveVersion } from "./agreementVersions.js";
import { agreementState } from "./agreements.js";
import { loadLandlordProperties } from "./coverage.js";
import { checkListingGate } from "./listingGate.js";
import { canSignIn, releaseWaiting } from "./payers.js";
import { activePayerLink } from "./payerLinks.js";
import { sendPayeeSignedEmail, sendPayerInviteEmail, sendPayerRequestEmail } from "./billingEmails.js";

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
 */
export async function sendPayerInvite({ landlordId, payerId }) {
  const [landlord, payer, link] = await Promise.all([userRow(landlordId), userRow(payerId), activePayerLink(supabase, landlordId)]);
  if (!payer?.email || !link) return false;
  const state = await agreementState(supabase, landlordId);
  const properties = await loadLandlordProperties(supabase, landlordId);
  const addresses = properties.filter((p) => p.live).map((p) => p.address);
  const signUrl = `${getBaseUrl()}${BILLING_PATH}`;
  let setupUrl = null;
  if (!canSignIn(payer)) {
    const base = await mintPasswordSetupUrl(payerId);
    setupUrl = base ? `${base}&next=${encodeURIComponent(BILLING_PATH)}` : null;
  }
  const sent = await sendPayerInviteEmail(
    { id: payer.id, email: payer.email, name: link.signer_name || payer.name },
    { landlordName: landlordLabel(landlord), addresses, setupUrl, signUrl, existingAgreement: state.valid },
    await invitePdfs(payerId)
  );
  if (sent) await supabase.from("billing_payers").update({ invited_at: new Date().toISOString() }).eq("id", link.id);
  return sent;
}

// More listings now wait for the payer (the first of a new addendum).
export async function sendPayerRequest({ landlordId, addresses }) {
  const link = await activePayerLink(supabase, landlordId);
  if (!link) return false;
  const [landlord, payer] = await Promise.all([userRow(landlordId), userRow(link.payer_id)]);
  if (!payer?.email) return false;
  return sendPayerRequestEmail(
    { id: payer.id, email: payer.email, name: link.signer_name || payer.name },
    { landlordName: landlordLabel(landlord), addresses, signUrl: `${getBaseUrl()}${BILLING_PATH}` }
  );
}

const releaseDeps = {
  checkGate: (landlordId, listingIds) => checkListingGate(supabase, landlordId, { listingIds }),
  publish: (landlordId, listingId) => publishProperty(landlordId, false, listingId),
  notifyLive: async ({ landlordId, payerName, addresses }) => {
    const landlord = await userRow(landlordId);
    if (!landlord?.email) return;
    await sendPayeeSignedEmail(landlord, { payerName, addresses, billingUrl: `${getBaseUrl()}/dashboard/landlord?tab=billing` });
  },
};

// Publish what each account was waiting for, after the payer signed or added a payment method.
export async function releaseWaitingFor(landlordId) {
  return releaseWaiting(supabase, { landlordId, deps: releaseDeps });
}

/*
 * After a signature (agreementServices onSigned): every account it covered other
 * than the signer's own gets its waiting listings published and an email saying
 * the payer signed (with what went live).
 */
export async function afterPayerSigned({ signerId, accounts = {} }) {
  for (const landlordId of Object.keys(accounts)) {
    if (landlordId === signerId) continue;
    const { published } = await releaseWaitingFor(landlordId);
    if (!published.length) {
      const link = await activePayerLink(supabase, landlordId);
      await releaseDeps.notifyLive({ landlordId, payerName: link?.signer_name ?? "Your payer", addresses: [] }).catch(() => {});
    }
  }
}

// After a payer adds a payment method: the accounts they pay for may now go live.
export async function afterPayerMethodAdded(payerId) {
  const { data } = await supabase.from("billing_payers").select("landlord_id").eq("payer_id", payerId).eq("status", "active");
  for (const r of data ?? []) await releaseWaitingFor(r.landlord_id).catch((err) => console.error("billing: release after payment method failed", err?.message));
}
