/*
 * The words of every billing email, as pure functions returning { subject, html }.
 * Sending (and the footer, which carries the postal address) is
 * billingEmails.js; keeping the copy here means it can be tested without a
 * mail transport.
 *
 * Landlord emails: contest outcome, failed payment, payment method needs
 * attention, overdue notice, launch enrollment.
 * Team emails (to info@useproximity.org): contest submitted, failed payment,
 * chargeback, only payment method removed, overdue withdrawal.
 *
 * Every value that came from a person or Stripe goes through escapeHtml. The
 * admin note on a contest is internal and is never put in a landlord email.
 */
import { escapeHtml } from "../escapeHtml.js";
import { formatCents } from "./money.js";
import { triggerLabel } from "./invoicePlan.js";

const WRAP = 'font-family:sans-serif;max-width:560px;margin:0 auto;color:#111827;line-height:1.5';
const BUTTON =
  "display:inline-block;margin:16px 0;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600";

const e = escapeHtml;
const hello = (name) => `<p>Hi ${e(name || "there")},</p>`;
const button = (url, label) => `<a href="${e(url)}" style="${BUTTON}">${e(label)}</a>`;
const wrap = (inner) => `<div style="${WRAP}">${inner}</div>`;
const dateOnly = (d) => new Date(d).toISOString().slice(0, 10);

// The charge details shown wherever a charge is mentioned: amount, trigger,
// then the listing, lease and student it belongs to.
function chargeDetails(charge) {
  const rows = [
    ["Amount", formatCents(charge.amountCents)],
    ["Reason", triggerLabel(charge.triggerType)],
    charge.listingLabel ? ["Listing", charge.listingLabel] : null,
    charge.leaseLabel ? ["Lease", charge.leaseLabel] : null,
    charge.studentName ? ["Student", charge.studentName] : null,
  ].filter(Boolean);
  return `<table style="border-collapse:collapse;margin:12px 0">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 16px 2px 0;color:#6b7280">${e(k)}</td><td style="padding:2px 0">${e(v)}</td></tr>`
    )
    .join("")}</table>`;
}

export function contestSubmittedTeamEmail({ landlordName, landlordEmail, charge, reason, adminUrl }) {
  return {
    subject: `Charge contested by ${landlordName || landlordEmail}`,
    html: wrap(`
      <p><strong>${e(landlordName || "A landlord")}</strong> (${e(landlordEmail)}) contested a charge.</p>
      ${chargeDetails(charge)}
      <p><strong>Their reason:</strong></p>
      <blockquote style="margin:0 0 12px;padding-left:12px;border-left:3px solid #e5e7eb">${e(reason)}</blockquote>
      ${button(adminUrl, "Review in admin")}
    `),
  };
}

export function contestOutcomeEmail({ name, outcome, charge, paymentsUrl }) {
  const upheld = outcome === "approved";
  return {
    subject: upheld ? "Update on your contested charge" : "Your contested charge was removed",
    html: wrap(`
      ${hello(name)}
      ${
        upheld
          ? "<p>We reviewed the charge you contested and it stands. It is now approved and will be included in your next monthly invoice.</p>"
          : "<p>We reviewed the charge you contested and removed it. You will not be charged for it.</p>"
      }
      ${chargeDetails(charge)}
      <p>If you have questions, reply to this email.</p>
      ${button(paymentsUrl, "View payments")}
    `),
  };
}

export function paymentFailedEmail({ name, totalCents, retryUrl, reason }) {
  return {
    subject: "Your Proximity payment did not go through",
    html: wrap(`
      ${hello(name)}
      <p>We could not collect your Proximity invoice of <strong>${e(formatCents(totalCents))}</strong>.${
        reason ? ` The reason given was: ${e(reason)}.` : ""
      }</p>
      <p>We will not retry it automatically. Please update your payment method and pay the invoice to keep your listings visible to students.</p>
      ${button(retryUrl, "Pay now")}
    `),
  };
}

export function paymentFailedTeamEmail({ landlordName, landlordEmail, totalCents, reason }) {
  return {
    subject: `Invoice payment failed: ${landlordName || landlordEmail}`,
    html: wrap(`
      <p>An invoice payment failed for <strong>${e(landlordName || "a landlord")}</strong> (${e(landlordEmail)}).</p>
      <p>Amount: ${e(formatCents(totalCents))}${reason ? `<br/>Reason: ${e(reason)}` : ""}</p>
      <p>No automatic retry is scheduled. The landlord has been asked to update their payment method.</p>
    `),
  };
}

export function paymentMethodAttentionEmail({ name, state, description, paymentsUrl }) {
  const why = state === "expired" ? "has expired" : "failed on the last payment";
  return {
    subject: "Update your payment method on Proximity",
    html: wrap(`
      ${hello(name)}
      <p>The payment method on your account (${e(description)}) ${why}. Please add a new one so your invoices can be paid.</p>
      ${button(paymentsUrl, "Update payment method")}
    `),
  };
}

export function overdueEmail({ name, totalCents, invoiceDate, paymentsUrl }) {
  return {
    subject: "Your Proximity listings have been hidden",
    html: wrap(`
      ${hello(name)}
      <p>Your invoice of <strong>${e(formatCents(totalCents))}</strong> dated ${e(dateOnly(invoiceDate))} is more than 30 days overdue, so your leases have been hidden from students.</p>
      <p>Pay the invoice and let us know, and we will restore them.</p>
      ${button(paymentsUrl, "Pay now")}
    `),
  };
}

export function overdueTeamEmail({ landlordName, landlordEmail, totalCents, invoiceDate, withdrawnCount }) {
  return {
    subject: `Leases withdrawn for overdue invoice: ${landlordName || landlordEmail}`,
    html: wrap(`
      <p>Leases were withdrawn automatically for <strong>${e(landlordName || "a landlord")}</strong> (${e(landlordEmail)}).</p>
      <p>Invoice: ${e(formatCents(totalCents))}, dated ${e(dateOnly(invoiceDate))}, unpaid for more than 30 days.<br/>
         Leases withdrawn: ${e(withdrawnCount)}</p>
    `),
  };
}

export function chargebackTeamEmail({ landlordName, landlordEmail, amountCents, reason, invoiceId }) {
  return {
    subject: `Chargeback received: ${landlordName || landlordEmail}`,
    html: wrap(`
      <p>A chargeback (Stripe dispute) was opened against <strong>${e(landlordName || "a landlord")}</strong> (${e(landlordEmail)}).</p>
      <p>Amount: ${e(formatCents(amountCents))}${reason ? `<br/>Reason: ${e(reason)}` : ""}${
        invoiceId ? `<br/>Invoice: ${e(invoiceId)}` : ""
      }</p>
      <p>The invoice has been flagged. Respond to the dispute in the Stripe dashboard.</p>
    `),
  };
}

export function methodRemovedTeamEmail({ landlordName, landlordEmail, outstandingCents }) {
  return {
    subject: `Payment method removed: ${landlordName || landlordEmail}`,
    html: wrap(`
      <p><strong>${e(landlordName || "A landlord")}</strong> (${e(landlordEmail)}) removed their only payment method.</p>
      <p>Outstanding balance (approved, not yet invoiced): ${e(formatCents(outstandingCents))}</p>
      <p>Nothing has changed automatically.</p>
    `),
  };
}

export function enrollmentEmail({ name, deadline, paymentsUrl }) {
  return {
    subject: "Set up payments on Proximity",
    html: wrap(`
      ${hello(name)}
      <p>Proximity now collects fees in the app instead of by external invoice. Please add a payment method and sign the commission agreement${
        deadline ? ` by ${e(deadline)}` : ""
      }. A bank account (ACH) is the recommended option.</p>
      ${button(paymentsUrl, "Set up payments")}
      <p>Charges are reviewed before they are collected, and you can approve or contest each one from your payments page.</p>
    `),
  };
}
