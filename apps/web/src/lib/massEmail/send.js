/*
 * Sending one version of a mass email to the people an admin picked (Wyatt,
 * 2026-11-07).
 *
 *   sendTest   one copy to an address of the admin's (their own by default),
 *              rendered for a chosen person so the merge fields show real values.
 *              Not recorded as a recipient.
 *   sendBatch  the real thing: a mass_email_batches row, then one email and one
 *              mass_email_recipients row per person.
 *
 * Rules for a batch:
 *   - Each person is looked up again here, so a deleted, review sandbox or
 *     emailless account picked on a stale page is skipped, never emailed.
 *   - Someone this template already reached is skipped unless the admin asks to
 *     send again (allowRepeat), so pressing Send twice never doubles up.
 *   - No way to sign in (no password, Google or Apple) means the button becomes a
 *     14 day set-password link (lib/auth/passwordReset.js). An email with no
 *     button mints none: a new link cancels the earlier one, so a later email
 *     without a button used to break the link an earlier email sent.
 *   - An address that bounced or marked us as spam (email_suppressions) is
 *     skipped, never sent to again. So is one that unsubscribed
 *     (mass_email_unsubscribes, lib/massEmail/unsubscribe.js).
 *   - Every email carries that person's own unsubscribe link in the footer, the
 *     List-Unsubscribe headers for Gmail and Yahoo's button, and a plain-text part.
 *   - Someone this batch already reached is always skipped, even with
 *     allowRepeat: pressing Send again after a failure picks up where it stopped.
 *     With allowRepeat, someone this same version reached in the last
 *     REPEAT_GUARD_HOURS is skipped too (a retry whose batch the page lost).
 *   - turnProxyOn switches Proxy on for each recipient's live listings, after
 *     their email went out. Only landlords' listings, never a sandbox one.
 *   - At most MAX_PER_CALL people per call, so one request fits the function's
 *     time limit; the admin page calls again with the rest.
 *
 * Every email goes through sendMailSafe (via sendMassEmail), so off production it
 * goes to the tester's inbox or nowhere, never to the real person.
 *
 * `db` is the service-role client of THIS site's own database: sending is refused
 * on the other environment by the route (lib/billing/adminDb.js).
 */

import { getBaseUrl, MASS_EMAIL_ADDRESS, sendMassEmail } from "@/lib/email";
import { emailFooter, emailFooterText } from "@/lib/emailFooter";
import { escapeHtml } from "@/lib/escapeHtml";
import { mintPasswordSetupUrl } from "@/lib/auth/passwordReset";
import { readAgreementFile } from "@/lib/billing/agreementFiles";
import { getMrecForm, MREC_FORM_FILENAME } from "@/lib/users/mrecForm";
import { ensureAgent } from "@/lib/agents/store";
import { renderMassEmail, wantsSetupLink } from "./render";
import { DELIVERED, skipReason } from "./audience";
import { unsubscribedAmong, unsubscribeHeaders, unsubscribePageUrl } from "./unsubscribe";

export const MAX_PER_CALL = 60;
export const REPEAT_GUARD_HOURS = 6;

export class MassEmailError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function loadVersion(db, versionId) {
  const { data, error } = await db
    .from("mass_email_versions")
    .select("*, mass_email_templates!template_id(id, name, archived_at)")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new MassEmailError("not_found", "That email version was not found.", 404);
  return data;
}

/*
 * The files to attach, read once per send. Refuses when one is missing, so a
 * batch never goes out without the attachment the version promises.
 */
export async function loadAttachments(db, version, { read = readAgreementFile } = {}) {
  const out = [];
  for (const a of Array.isArray(version.attachments) ? version.attachments : []) {
    if (a?.kind === "mrec") {
      const form = await getMrecForm(db);
      if (!form) throw new MassEmailError("no_mrec_form", "Upload the MREC form (Billing > Landlords and agreements) before sending this email.");
      out.push({ filename: MREC_FORM_FILENAME, content: Buffer.from(await read(form.key)), contentType: "application/pdf" });
    } else if (a?.kind === "file" && a.key) {
      out.push({ filename: a.fileName || "attachment.pdf", content: Buffer.from(await read(a.key)), contentType: "application/pdf" });
    }
  }
  return out;
}

const PERSON_SELECT =
  "id, name, email, company_name, deleted_at, review_sandbox, is_system, password_hash, google_account, apple_account, roles!role_id(name)";

function usable(u) {
  return !!u && !u.deleted_at && !u.review_sandbox && !u.is_system && typeof u.email === "string" && u.email.includes("@");
}

// The footer line is admin-typed text, and emailFooter inserts it as HTML.
export const footerFor = (version, unsubscribeUrl = null) =>
  emailFooter({ reason: escapeHtml(version.footer_reason), commercial: version.commercial === true, unsubscribeUrl });

/*
 * What one person's email carries for unsubscribing: the footer (HTML and text)
 * with their own link, and the List-Unsubscribe headers.
 */
function personalFooter(version, email, baseUrl) {
  const unsubscribeUrl = unsubscribePageUrl(email, baseUrl);
  return {
    footerHtml: footerFor(version, unsubscribeUrl),
    footerText: emailFooterText({ reason: version.footer_reason, commercial: version.commercial === true, unsubscribeUrl }),
    headers: unsubscribeHeaders(email, baseUrl, MASS_EMAIL_ADDRESS),
  };
}

export async function sendTest(db, { version, to, previewUserId = null, req = null }) {
  let person = { name: null, email: to, company_name: null };
  if (previewUserId) {
    const { data } = await db.from("users").select(PERSON_SELECT).eq("id", previewUserId).maybeSingle();
    if (data) person = data;
  }
  const attachments = await loadAttachments(db, version);
  const baseUrl = getBaseUrl();
  // A test never mints a real set-password link: it shows where one would go.
  const setupUrl = previewUserId && person.id && wantsSetupLink(person, version, { baseUrl }) ? `${baseUrl}/reset-password?token=TEST-LINK-NOT-REAL` : null;
  // The unsubscribe link is for the test inbox, not the person it is filled in
  // as, so trying it never takes a real person off the list.
  const { footerHtml, footerText, headers } = personalFooter(version, to, baseUrl);
  const { subject, html, text } = renderMassEmail(
    version,
    { name: person.name, email: person.email, company: person.company_name },
    { baseUrl, setupUrl, footerHtml, footerText }
  );
  return sendMassEmail({ to, subject: `[Test] ${subject}`, html, text, headers, attachments, req });
}

// Live listings a landlord is linked to (published, not deleted, available, not sandbox).
async function liveListingIds(db, userId) {
  const { data, error } = await db
    .from("listing_landlords")
    .select("listing_id, listings!inner(id, published_at, deleted_at, unavailable, review_sandbox)")
    .eq("user_id", userId)
    .not("listings.published_at", "is", null)
    .is("listings.deleted_at", null)
    .eq("listings.unavailable", false);
  if (error) throw error;
  return [...new Set((data ?? []).filter((r) => !r.listings.review_sandbox).map((r) => r.listing_id))];
}

// Switches Proxy on for these listings. Returns how many were not on before.
export async function turnProxyOn(db, listingIds, { ensure = ensureAgent } = {}) {
  let changed = 0;
  for (const id of listingIds) {
    await ensure(id);
    const { data, error } = await db.from("listing_agents").update({ status: "on" }).eq("listing_id", id).neq("status", "on").select("listing_id");
    if (error) throw error;
    changed += (data ?? []).length;
  }
  return changed;
}

async function alreadyReached(db, templateId, userIds) {
  const { data, error } = await db
    .from("mass_email_recipients")
    .select("user_id")
    .eq("template_id", templateId)
    .in("user_id", userIds)
    .in("status", DELIVERED);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.user_id));
}

// Addresses that bounced or marked us as spam, of these emails (lower-cased).
export async function suppressedAmong(db, emails) {
  const list = [...new Set(emails.filter(Boolean).map((e) => e.trim().toLowerCase()))];
  if (!list.length) return new Set();
  const { data, error } = await db.from("email_suppressions").select("email").in("email", list);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.email));
}

// People this batch already reached, or (with allowRepeat) this version reached lately.
async function reachedBy(db, { batchId, versionId, userIds, since }) {
  const out = new Set();
  if (batchId) {
    const { data, error } = await db.from("mass_email_recipients").select("user_id").eq("batch_id", batchId).in("user_id", userIds).in("status", DELIVERED);
    if (error) throw error;
    for (const r of data ?? []) out.add(r.user_id);
  }
  if (since) {
    const { data, error } = await db
      .from("mass_email_recipients")
      .select("user_id")
      .eq("version_id", versionId)
      .in("user_id", userIds)
      .in("status", DELIVERED)
      .gte("created_at", since);
    if (error) throw error;
    for (const r of data ?? []) out.add(r.user_id);
  }
  return out;
}

/*
 * Resolves to { batchId, sent, failed, skipped: [{ id, reason }], remaining }.
 * `remaining` are ids not attempted because of MAX_PER_CALL.
 */
export async function sendBatch(db, { version, userIds, adminId, turnProxyOn: switchProxy = false, allowRepeat = false, batchId = null, req = null }) {
  const ids = [...new Set((userIds ?? []).filter((id) => typeof id === "string"))];
  if (!ids.length) throw new MassEmailError("no_recipients", "Pick at least one person.");
  if (version.mass_email_templates?.archived_at) throw new MassEmailError("archived", "This email is archived.");

  const now = ids.slice(0, MAX_PER_CALL);
  const remaining = ids.slice(MAX_PER_CALL);
  const attachments = await loadAttachments(db, version);

  const { data: people, error } = await db.from("users").select(PERSON_SELECT).in("id", now);
  if (error) throw error;
  const byId = new Map((people ?? []).map((u) => [u.id, u]));
  const reached = allowRepeat ? new Set() : await alreadyReached(db, version.template_id, now);
  const sentInBatch = await reachedBy(db, {
    batchId,
    versionId: version.id,
    userIds: now,
    since: allowRepeat ? new Date(Date.now() - REPEAT_GUARD_HOURS * 3600 * 1000).toISOString() : null,
  });
  const suppressed = await suppressedAmong(db, (people ?? []).map((u) => u.email));
  const unsubscribed = await unsubscribedAmong(db, (people ?? []).map((u) => u.email));

  // One batch row across the calls of one press of Send (the page passes it back),
  // created only once someone is actually emailed, so a press that skips everyone
  // leaves no empty batch behind.
  let batch = batchId;
  const ensureBatch = async () => {
    if (batch) return batch;
    const { data: row, error: e } = await db
      .from("mass_email_batches")
      .insert({ version_id: version.id, created_by: adminId ?? null, turn_proxy_on: switchProxy === true })
      .select("id")
      .single();
    if (e) throw e;
    batch = row.id;
    return batch;
  };

  const baseUrl = getBaseUrl();
  const result = { batchId: batch, sent: 0, failed: 0, skipped: [], remaining };

  for (const id of now) {
    const u = byId.get(id);
    if (!usable(u)) {
      result.skipped.push({ id, reason: "deleted, sandbox or no email address" });
      continue;
    }
    const skip = skipReason(u, { reached, sentInBatch, suppressed, unsubscribed, batchId, repeatGuardHours: REPEAT_GUARD_HOURS });
    if (skip) {
      result.skipped.push({ id, reason: skip });
      continue;
    }

    await ensureBatch();
    const setupUrl = wantsSetupLink(u, version, { baseUrl }) ? await mintPasswordSetupUrl(u.id, { db, baseUrl }) : null;
    const { footerHtml, footerText, headers } = personalFooter(version, u.email, baseUrl);
    const { subject, html, text } = renderMassEmail(
      version,
      { name: u.name, email: u.email, company: u.company_name },
      { baseUrl, setupUrl, footerHtml, footerText }
    );

    const row = {
      batch_id: batch,
      version_id: version.id,
      template_id: version.template_id,
      user_id: u.id,
      email: u.email,
      setup_link: !!setupUrl,
    };
    try {
      const out = await sendMassEmail({ to: u.email, subject, html, text, headers, attachments, userId: u.id, req });
      row.status = out.suppressed ? "suppressed" : out.redirected ? "redirected" : "sent";
      row.provider_message_id = out.providerMessageId;
      row.status_detail = out.provider === "gmail" ? "sent via Gmail" : null;
      result.sent += 1;
    } catch (err) {
      row.status = "failed";
      row.status_detail = String(err?.message ?? err).slice(0, 500);
      result.failed += 1;
    }

    if (switchProxy && row.status !== "failed" && u.roles?.name === "landlord") {
      try {
        row.proxy_listings = await turnProxyOn(db, await liveListingIds(db, u.id));
      } catch (err) {
        console.error(`[mass email] Proxy switch failed for ${u.id}:`, err?.message ?? err);
        row.status_detail = [row.status_detail, "Proxy could not be switched on"].filter(Boolean).join("; ");
      }
    }

    const { error: insertError } = await db.from("mass_email_recipients").insert(row);
    if (insertError) console.error("[mass email] recipient row failed:", insertError.message);
  }

  result.batchId = batch;
  if (batch) {
    const { count } = await db.from("mass_email_recipients").select("id", { count: "exact", head: true }).eq("batch_id", batch);
    await db.from("mass_email_batches").update({ recipient_count: count ?? 0 }).eq("id", batch);
  }
  return result;
}
