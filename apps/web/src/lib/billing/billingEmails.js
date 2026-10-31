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
import { BILLING_TEAM_EMAIL } from "./constants";
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

async function deliver({ kind, to, userId, reason, message }) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn(`[billing email] ${kind}: email env vars not set, skipping.`);
    return;
  }
  try {
    await sendMailSafe(transporter, {
      logAs: { kind, userId },
      from: `"Proximity" <${process.env.EMAIL_USER}>`,
      to,
      replyTo: BILLING_TEAM_EMAIL,
      subject: message.subject,
      html: `${message.html}${emailFooter({ reason })}`,
    });
  } catch (err) {
    console.error(`[billing email] ${kind} failed:`, err?.message);
  }
}

const toLandlord = (kind, landlord, message) =>
  deliver({ kind, to: landlord.email, userId: landlord.id, reason: LANDLORD_REASON, message });
const toTeam = (kind, message) =>
  deliver({ kind, to: BILLING_TEAM_EMAIL, reason: TEAM_REASON, message });

// Landlord-facing. `landlord` is { id, email, name }.
export const sendContestOutcomeEmail = (landlord, input) =>
  toLandlord("billing_contest_outcome", landlord, t.contestOutcomeEmail({ name: landlord.name, ...input }));
export const sendPaymentFailedEmail = (landlord, input) =>
  toLandlord("billing_payment_failed", landlord, t.paymentFailedEmail({ name: landlord.name, ...input }));
export const sendPaymentMethodAttentionEmail = (landlord, input) =>
  toLandlord("billing_method_attention", landlord, t.paymentMethodAttentionEmail({ name: landlord.name, ...input }));
export const sendOverdueEmail = (landlord, input) =>
  toLandlord("billing_overdue", landlord, t.overdueEmail({ name: landlord.name, ...input }));
export const sendEnrollmentEmail = (landlord, input) =>
  toLandlord("billing_enrollment", landlord, t.enrollmentEmail({ name: landlord.name, ...input }));

// To info@useproximity.org.
export const sendContestSubmittedTeamEmail = (input) =>
  toTeam("billing_contest_submitted", t.contestSubmittedTeamEmail(input));
export const sendPaymentFailedTeamEmail = (input) =>
  toTeam("billing_payment_failed_team", t.paymentFailedTeamEmail(input));
export const sendOverdueTeamEmail = (input) => toTeam("billing_overdue_team", t.overdueTeamEmail(input));
export const sendChargebackTeamEmail = (input) => toTeam("billing_chargeback_team", t.chargebackTeamEmail(input));
export const sendMethodRemovedTeamEmail = (input) =>
  toTeam("billing_method_removed_team", t.methodRemovedTeamEmail(input));
