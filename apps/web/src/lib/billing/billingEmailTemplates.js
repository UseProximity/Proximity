/*
 * The words of every billing email, as pure functions returning { subject, html }.
 * Sending (and the footer, which carries the postal address) is
 * billingEmails.js; keeping the copy here means it can be tested without a
 * mail transport.
 *
 * Landlord emails: contest outcome, failed payment, payment method needs
 * attention, overdue notice, launch enrollment, commission agreement to sign.
 * Team emails (to info@useproximity.org): contest submitted, failed payment,
 * chargeback, only payment method removed, overdue withdrawal, agreement declined.
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
  const why =
    state === "expiring"
      ? "expires at the end of this month"
      : state === "expired"
        ? "has expired"
        : "failed on the last payment";
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

// includeAgreement is false until the commission agreement is ready, so the email
// only asks for what a landlord can actually do yet.
export function enrollmentEmail({ name, deadline, includeAgreement = true, paymentsUrl }) {
  const ask = includeAgreement ? "add a payment method and sign the commission agreement" : "add a payment method";
  return {
    subject: "Set up payments on Proximity",
    html: wrap(`
      ${hello(name)}
      <p>Proximity now collects fees in the app instead of by external invoice. Please ${ask}${
        deadline ? ` by ${e(deadline)}` : ""
      }. A bank account (ACH) is the recommended option.</p>
      ${button(paymentsUrl, "Set up payments")}
      <p>Charges are reviewed before they are collected, and you can approve or contest each one from your payments page.</p>
    `),
  };
}

/*
 * Asking a landlord to sign the commission agreement (sent by an admin from the
 * dashboard). The PDF is attached so they can read it anywhere; signing happens
 * on their Payments tab. `resign` when a new version replaces one they signed.
 */
export function agreementRequestEmail({ name, versionLabel, signUrl, resign = false, deadline = null }) {
  const what = resign
    ? `We have updated the Proximity commission agreement${versionLabel ? ` (${e(versionLabel)})` : ""}. Please review and sign the new version`
    : `Please review and sign the Proximity commission agreement${versionLabel ? ` (${e(versionLabel)})` : ""}`;
  return {
    subject: resign ? "Please sign the updated Proximity commission agreement" : "Please sign your Proximity commission agreement",
    html: wrap(`
      ${hello(name)}
      <p>${what}${deadline ? ` by ${e(deadline)}` : ""}. It sets out the fee Proximity charges when it brings you a tenant. A copy is attached for your records.</p>
      ${button(signUrl, "Review and sign")}
      <p>You sign it in your Proximity landlord dashboard, under Payments. It takes about two minutes, and you can view your signed copy there at any time.</p>
      <p>Questions about the terms? Just reply to this email.</p>
    `),
  };
}

export function agreementDeclinedTeamEmail({ landlordName, landlordEmail, reason, kind = "master" }) {
  const what = kind === "amendment" ? "Exhibit A amendment" : "commission agreement";
  return {
    subject: `${kind === "amendment" ? "Exhibit A amendment" : "Commission agreement"} declined: ${landlordName || landlordEmail || "a landlord"}`,
    html: wrap(`
      <p>${e(landlordName || "A landlord")}${landlordEmail ? ` (${e(landlordEmail)})` : ""} declined to sign the ${what} in Documenso.</p>
      <p>Reason given: ${reason ? e(reason) : "none"}</p>
      <p>The properties it would have covered stay as drafts while the agreement is required. Reach out to them; they can sign again from their Payments tab, or ask for changes there.</p>
    `),
  };
}

// ── Agreement change requests ───────────────────────────────────────────────

const DOC_LABEL = { master: "the commission agreement", amendment: "an Exhibit A amendment" };
const quote = (s) =>
  `<blockquote style="margin:0 0 12px;padding-left:12px;border-left:3px solid #e5e7eb;white-space:pre-wrap">${e(s)}</blockquote>`;

// To the team: a landlord opened a request (`isReply` false) or added to one (true).
export function changeRequestTeamEmail({ landlordName, landlordEmail, documentKind, section, body, proposedText, hasFile, isReply, adminUrl }) {
  const who = landlordName || landlordEmail || "A landlord";
  return {
    subject: isReply
      ? `Agreement change request: ${who} replied`
      : `Agreement change request from ${who}`,
    html: wrap(`
      <p><strong>${e(who)}</strong>${landlordEmail ? ` (${e(landlordEmail)})` : ""} ${
        isReply ? "replied on their change request about" : "asked for changes to"
      } ${DOC_LABEL[documentKind] ?? DOC_LABEL.master}.</p>
      ${section ? `<p><strong>Section:</strong> ${e(section)}</p>` : ""}
      <p><strong>${isReply ? "Their message" : "What and why"}:</strong></p>
      ${quote(body)}
      ${proposedText ? `<p><strong>Proposed wording:</strong></p>${quote(proposedText)}` : ""}
      ${hasFile ? "<p>They attached a file. Open it from the admin dashboard.</p>" : ""}
      ${button(adminUrl, "Open in admin")}
    `),
  };
}

// To the team: requests that have waited for an answer.
export function changeRequestReminderEmail({ requests, adminUrl }) {
  const rows = requests
    .map(
      (r) =>
        `<li>${e(r.landlord?.name || r.landlord?.email || "A landlord")}${r.section ? `, section: ${e(r.section)}` : ""} (waiting since ${dateOnly(r.waitingSince)})</li>`
    )
    .join("");
  return {
    subject: `${requests.length} agreement change request${requests.length === 1 ? "" : "s"} waiting for an answer`,
    html: wrap(`
      <p>These landlords asked for changes to the commission agreement and have not heard back in 5 days or more:</p>
      <ul>${rows}</ul>
      ${button(adminUrl, "Answer in admin")}
    `),
  };
}

// To the landlord: the team replied, accepted or declined.
export function changeRequestUpdateEmail({ name, outcome, message, paymentsUrl }) {
  const lead = {
    replied: "We replied to your request to change the commission agreement.",
    accepted:
      "We agreed to your requested changes. We are preparing a version of the agreement for you, and you will be able to sign it in your Payments tab once it is ready.",
    declined:
      "We are not able to make the changes you asked for. You can still sign the standard agreement in your Payments tab, or reply with a new request.",
  }[outcome] ?? "There is an update on your request to change the commission agreement.";
  return {
    subject:
      outcome === "accepted"
        ? "Your commission agreement change request was accepted"
        : outcome === "declined"
          ? "About your commission agreement change request"
          : "We replied to your commission agreement change request",
    html: wrap(`
      ${hello(name)}
      <p>${lead}</p>
      ${message ? quote(message) : ""}
      ${button(paymentsUrl, "View in Proximity")}
    `),
  };
}
