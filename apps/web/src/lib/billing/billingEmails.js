/*
 * Sends the billing emails. Copy lives in billingEmailTemplates.js; this adds the
 * footer and hands each message to sendMailSafe, the one function every email
 * passes through. That is the outreach gate: off production it redirects to the
 * test inbox or suppresses the send, so staging never emails a real landlord or
 * the real team inbox.
 *
 * Best effort by design. A failed email must never fail the billing action that
 * triggered it (a contest, a webhook), so every sender catches and logs.
 */
import nodemailer from "nodemailer";
import { sendMailSafe } from "@/lib/outreach";
import { emailFooter } from "@/lib/email";
import { AGREEMENT_REQUEST_KIND, AUTOPAY_OFF_KIND, BILLING_TEAM_EMAIL, CHANGE_REQUEST_TEAM_EMAILS, INVOICE_ISSUED_KIND } from "./constants";
import * as t from "./billingEmailTemplates";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  // STARTTLS or nothing: never let a stripped EHLO send AUTH in cleartext.
  requireTLS: true,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const LANDLORD_REASON = "You are receiving this because you have a landlord account on Proximity.";
const TEAM_REASON = "Internal billing notification.";

// Resolves true when the email was handed to the mailer, false when it was skipped
// or failed (never throws). Most callers ignore the answer; the enrollment send
// counts it to report how many went out.
async function deliver({ kind, to, userId, reason, message, attachments, sandbox = false }) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn(`[billing email] ${kind}: email env vars not set, skipping.`);
    return false;
  }
  try {
    await sendMailSafe(transporter, {
      logAs: { kind, userId },
      from: `"Proximity" <${process.env.EMAIL_USER}>`,
      to,
      replyTo: BILLING_TEAM_EMAIL,
      subject: message.subject,
      html: `${message.html}${emailFooter({ reason })}`,
      ...(attachments?.length && { attachments }),
      // A review sandbox account is never emailed (lib/outreach.js).
      ...(sandbox && { sandbox: true }),
    });
    return true;
  } catch (err) {
    console.error(`[billing email] ${kind} failed:`, err?.message);
    return false;
  }
}

const toLandlord = (kind, landlord, message, attachments) =>
  deliver({ kind, to: landlord.email, userId: landlord.id, reason: LANDLORD_REASON, message, attachments });
const toTeam = (kind, message) =>
  deliver({ kind, to: BILLING_TEAM_EMAIL, reason: TEAM_REASON, message });

// Landlord-facing. `landlord` is { id, email, name }.
export const sendContestOutcomeEmail = (landlord, input) =>
  toLandlord("billing_contest_outcome", landlord, t.contestOutcomeEmail({ name: landlord.name, ...input }));
export const sendChargeCreatedEmail = (landlord, input) =>
  toLandlord("billing_charge_created", landlord, t.chargeCreatedEmail({ name: landlord.name, ...input }));
export const sendPaymentFailedEmail = (landlord, input) =>
  toLandlord("billing_payment_failed", landlord, t.paymentFailedEmail({ name: landlord.name, ...input }));
export const sendInvoicePaidEmail = (landlord, input) =>
  toLandlord("billing_invoice_paid", landlord, t.invoicePaidEmail({ name: landlord.name, ...input }));
export const sendChargeAdjustedEmail = (landlord, input) =>
  toLandlord("billing_charge_adjusted", landlord, t.chargeAdjustedEmail({ name: landlord.name, ...input }));
export const sendPaymentMethodAttentionEmail = (landlord, input) =>
  toLandlord("billing_method_attention", landlord, t.paymentMethodAttentionEmail({ name: landlord.name, ...input }));
export const sendOverdueEmail = (landlord, input) =>
  toLandlord("billing_overdue", landlord, t.overdueEmail({ name: landlord.name, ...input }));
// `pdf` is the agreement's bytes, attached as marketing-agreement.pdf when given.
export const sendAgreementRequestEmail = (landlord, input, pdf = null) =>
  toLandlord(
    AGREEMENT_REQUEST_KIND,
    landlord,
    t.agreementRequestEmail({ name: landlord.name, ...input }),
    pdf ? [{ filename: "proximity-marketing-agreement.pdf", content: Buffer.from(pdf), contentType: "application/pdf" }] : null
  );
export const sendEnrollmentEmail = (landlord, input) =>
  toLandlord("billing_enrollment", landlord, t.enrollmentEmail({ name: landlord.name, ...input }));

// To info@useproximity.org.
export const sendContestSubmittedTeamEmail = (input) =>
  toTeam("billing_contest_submitted", t.contestSubmittedTeamEmail(input));
export const sendPaymentFailedTeamEmail = (input) =>
  toTeam("billing_payment_failed_team", t.paymentFailedTeamEmail(input));
export const sendOverdueTeamEmail = (input) => toTeam("billing_overdue_team", t.overdueTeamEmail(input));
export const sendChargebackTeamEmail = (input) => toTeam("billing_chargeback_team", t.chargebackTeamEmail(input));
export const sendAgreementDeclinedTeamEmail = (input) =>
  toTeam("billing_agreement_declined_team", t.agreementDeclinedTeamEmail(input));
export const sendMethodRemovedTeamEmail = (input) =>
  toTeam("billing_method_removed_team", t.methodRemovedTeamEmail(input));

// Agreement change requests. The team emails go to CHANGE_REQUEST_TEAM_EMAILS.
const toChangeRequestTeam = (kind, message) =>
  deliver({ kind, to: CHANGE_REQUEST_TEAM_EMAILS.join(", "), reason: TEAM_REASON, message });
export const sendChangeRequestTeamEmail = (input) =>
  toChangeRequestTeam("billing_change_request_team", t.changeRequestTeamEmail(input));
export const sendChangeRequestReminderEmail = (input) =>
  toChangeRequestTeam("billing_change_request_reminder", t.changeRequestReminderEmail(input));
// `sandbox` true for a review sandbox account: recorded as suppressed, never sent.
export const sendChangeRequestUpdateEmail = (landlord, input, { sandbox = false } = {}) =>
  deliver({
    kind: "billing_change_request_update",
    to: landlord.email,
    userId: landlord.id,
    reason: LANDLORD_REASON,
    message: t.changeRequestUpdateEmail({ name: landlord.name, ...input }),
    sandbox,
  });

// Invoices and autopay. Each resolves true when handed to the mailer.
export const sendInvoiceIssuedEmail = (landlord, input) =>
  toLandlord(INVOICE_ISSUED_KIND, landlord, t.invoiceIssuedEmail({ name: landlord.name, ...input }));
export const sendAutopayMovedEmail = (landlord, input) =>
  toLandlord("billing_autopay_moved", landlord, t.autopayMovedEmail({ name: landlord.name, ...input }));
export const sendAutopayOffEmail = (landlord, input) =>
  toLandlord(AUTOPAY_OFF_KIND, landlord, t.autopayOffEmail({ name: landlord.name, ...input }));

// A payer for another landlord account (Project B). `attachments` are the agreement and the MREC form.
export const sendPayerInviteEmail = (payer, input, attachments = null) =>
  toLandlord("billing_payer_invite", payer, t.payerInviteEmail({ name: payer.name, ...input }), attachments);
export const sendPayerRequestEmail = (payer, input) =>
  toLandlord("billing_payer_request", payer, t.payerRequestEmail({ name: payer.name, ...input }));
export const sendPayerDocumentCancelledEmail = (payer, input) =>
  toLandlord("billing_payer_document_cancelled", payer, t.payerDocumentCancelledEmail({ name: payer.name, ...input }));
export const sendPayeeSignedEmail = (landlord, input) =>
  toLandlord("billing_payee_signed", landlord, t.payeeSignedEmail({ name: landlord.name, ...input }));
export const sendPayerRevokedEmail = (payer, input) =>
  toLandlord("billing_payer_revoked", payer, t.payerRevokedEmail({ name: payer.name, ...input }));
export const sendPayeeAssignedEmail = (landlord, input) =>
  toLandlord("billing_payee_assigned", landlord, t.payeeAssignedEmail({ name: landlord.name, ...input }));
