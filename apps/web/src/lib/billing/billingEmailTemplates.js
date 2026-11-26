/*
 * The words of every billing email, as pure functions returning { subject, html }.
 * Sending (and the footer, which carries the postal address) is
 * billingEmails.js; keeping the copy here means it can be tested without a
 * mail transport.
 *
 * Landlord emails: new charge to review, contest outcome, failed payment, payment received, refund
 * or credit, payment method needs attention, overdue notice, launch
 * enrollment, marketing agreement to sign.
 * Team emails (to info@useproximity.org): contest submitted, failed payment,
 * chargeback, only payment method removed, overdue withdrawal, agreement declined.
 *
 * Every value that came from a person or Stripe goes through escapeHtml. The
 * admin note on a contest is internal and is never put in a landlord email.
 */
import { escapeHtml } from "../escapeHtml.js";
import { formatCents } from "./money.js";
import { triggerLabel } from "./invoicePlan.js";
import { basisLabel } from "./chargeDisplay.js";

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

// `payer`: { name, email } when the account's authorized payer contested it
// (Wyatt, 2026-11-25), not the landlord. The charge is still on the landlord's account.
export function contestSubmittedTeamEmail({ landlordName, landlordEmail, charge, reason, adminUrl, payer = null }) {
  const account = `<strong>${e(landlordName || "A landlord")}</strong> (${e(landlordEmail)})`;
  return {
    subject: `Charge contested by ${payer ? payer.name || payer.email : landlordName || landlordEmail}`,
    html: wrap(`
      ${
        payer
          ? `<p><strong>${e(payer.name || "An authorized payer")}</strong> (${e(payer.email)}), the authorized payer billed for it, contested a charge on the account of ${account}.</p>`
          : `<p>${account} contested a charge.</p>`
      }
      ${chargeDetails(charge)}
      <p><strong>Their reason:</strong></p>
      <blockquote style="margin:0 0 12px;padding-left:12px;border-left:3px solid #e5e7eb">${e(reason)}</blockquote>
      ${button(adminUrl, "Review in admin")}
    `),
  };
}

// The outcome goes to the landlord and to the authorized payer billed for it
// (Wyatt, 2026-11-25), whichever of them contested it.
// `contestedBy`: the name of whoever contested, when it was not the reader.
// `invoicedTo`: the name of whoever is invoiced for it, when it is not the reader.
export function contestOutcomeEmail({ name, outcome, charge, paymentsUrl, contestedBy = null, invoicedTo = null }) {
  const upheld = outcome === "approved";
  const which = contestedBy ? `the charge ${e(contestedBy)} contested` : "the charge you contested";
  const invoice = invoicedTo ? `${e(invoicedTo)}'s next monthly invoice` : "your next monthly invoice";
  const nobodyPays = invoicedTo ? `${e(invoicedTo)} will not be charged for it.` : "You will not be charged for it.";
  return {
    subject: upheld ? (contestedBy ? "Update on a contested charge" : "Update on your contested charge") : contestedBy ? "A contested charge was removed" : "Your contested charge was removed",
    html: wrap(`
      ${hello(name)}
      ${
        upheld
          ? `<p>We reviewed ${which} and it stands. It is now approved and will be included in ${invoice}.</p>`
          : `<p>We reviewed ${which} and removed it. ${nobodyPays}</p>`
      }
      ${chargeDetails(charge)}
      <p>If you have questions, reply to this email.</p>
      ${button(paymentsUrl, "View payments")}
    `),
  };
}

/*
 * A charge an admin put on the landlord's account. Its review has started: the
 * landlord can approve or contest it until `reviewEndsAt`, after which it is
 * approved and goes on the next monthly invoice.
 */
// `forAccount`: the copy to an authorized payer (Wyatt, 2026-11-25), who is
// billed for a charge on that landlord's account and can review it too.
// `billedTo`: the landlord's copy when someone else is billed for it.
export function chargeCreatedEmail({ name, charge, reviewEndsAt, paymentsUrl, forAccount = null, billedTo = null }) {
  const basis = basisLabel(charge);
  const opening = forAccount
    ? `We added a charge for ${charge.listingLabel ? `${e(forAccount)}'s listing` : `${e(forAccount)}'s account`} on Proximity. You are their authorized payer, so it is billed to you.`
    : billedTo
      ? `We added a charge to your Proximity account. It is billed to ${e(billedTo)}, your authorized payer, who can review it too.`
      : "We added a charge to your Proximity account.";
  return {
    subject: `New Proximity charge to review: ${formatCents(charge.amountCents)}`,
    html: wrap(`
      ${hello(name)}
      <p>${opening}</p>
      ${chargeDetails(charge)}
      ${basis ? `<p style="color:#6b7280">${e(basis)}</p>` : ""}
      ${charge.description ? `<p>${e(charge.description)}</p>` : ""}
      <p>Please review it by <strong>${e(dateOnly(reviewEndsAt))}</strong>. If something is wrong, contest it before then and tell us why. If we hear nothing, it is approved on that date and included in your next monthly invoice.</p>
      ${button(paymentsUrl, "Review the charge")}
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

// The receipt: an invoice was paid (Pay now, autopay, or Stripe's invoice page).
/*
 * The receipt. `paidCents` is what was actually charged, and `creditCents` the
 * part of the invoice an earlier credit covered, so a $412 invoice with a $100
 * credit says $312 was charged, and one a credit covered in full says nothing was.
 */
export function invoicePaidEmail({ name, periodLabel, totalCents, paidCents = totalCents, creditCents = 0, methodDescription = null, paidAt, pdfUrl = null, paymentsUrl }) {
  const row = (label, value) =>
    `<tr><td style="padding:2px 16px 2px 0;color:#6b7280">${label}</td><td style="padding:2px 0">${e(value)}</td></tr>`;
  const coveredByCredit = paidCents <= 0 && creditCents > 0;
  const lead = coveredByCredit
    ? `Your Proximity invoice for ${e(periodLabel)} of <strong>${e(formatCents(totalCents))}</strong> was covered by your credit. Nothing was charged.`
    : creditCents > 0
    ? `Thank you. We received your payment of <strong>${e(formatCents(paidCents))}</strong> for your Proximity invoice for ${e(periodLabel)}. Your credit of ${e(formatCents(creditCents))} covered the rest.`
    : `Thank you. We received your payment of <strong>${e(formatCents(paidCents))}</strong> for your Proximity invoice for ${e(periodLabel)}.`;
  return {
    subject: coveredByCredit
      ? `Invoice covered by credit: ${formatCents(totalCents)} for ${periodLabel}`
      : `Payment received: ${formatCents(paidCents)} for ${periodLabel}`,
    html: wrap(`
      ${hello(name)}
      <p>${lead}</p>
      <table style="border-collapse:collapse;margin:12px 0">
        ${creditCents > 0 ? row("Invoice total", formatCents(totalCents)) + row("Credit used", formatCents(creditCents)) : ""}
        ${row(creditCents > 0 ? "Charged" : "Amount", formatCents(Math.max(paidCents, 0)))}
        ${methodDescription && !coveredByCredit ? row("Paid with", methodDescription) : ""}
        ${row("Date", longDate(paidAt))}
      </table>
      ${pdfUrl ? `<p><a href="${e(pdfUrl)}">Download the invoice (PDF)</a></p>` : ""}
      ${button(paymentsUrl, "View billing")}
      <p>Questions about a charge? Just reply to this email.</p>
    `),
  };
}

/*
 * A Paid charge was corrected: refunded to the landlord's payment method, or
 * credited against their next invoice. `reason` is what the admin wrote, which
 * the corrections screen says is sent to the landlord.
 */
export function chargeAdjustedEmail({ name, kind, amountCents, charge, reason = null, paymentsUrl }) {
  const refund = kind === "refund";
  return {
    subject: refund
      ? `Refund of ${formatCents(amountCents)} on your Proximity charge`
      : `Credit of ${formatCents(amountCents)} on your next Proximity invoice`,
    html: wrap(`
      ${hello(name)}
      <p>${
        refund
          ? `We refunded <strong>${e(formatCents(amountCents))}</strong> of a charge you paid. It goes back to the card or bank account you paid with, usually within 5 to 10 business days.`
          : `We added a credit of <strong>${e(formatCents(amountCents))}</strong> for a charge you paid. It comes off your next monthly invoice automatically.`
      }</p>
      ${chargeDetails(charge)}
      ${reason ? `<p><strong>Why:</strong> ${e(reason)}</p>` : ""}
      ${button(paymentsUrl, "View billing")}
      <p>Questions? Just reply to this email.</p>
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
        : // We do not record whether verification or a payment failed (Wyatt, 2026-11-06).
          "can't be used: it failed verification or a payment didn't go through";
  return {
    subject: "Update your payment method on Proximity",
    html: wrap(`
      ${hello(name)}
      <p>The payment method on your account (${e(description)}) ${why}. Please add a new one so your invoices can be paid.</p>
      ${button(paymentsUrl, "Update payment method")}
    `),
  };
}

export function overdueEmail({ name, totalCents, invoiceDate, dueDate = null, paymentsUrl }) {
  const when = dueDate ? `was due on ${e(dateOnly(dueDate))} and` : `dated ${e(dateOnly(invoiceDate))}`;
  return {
    subject: "Your Proximity listings have been hidden",
    html: wrap(`
      ${hello(name)}
      <p>Your invoice of <strong>${e(formatCents(totalCents))}</strong> ${when} is more than 30 days overdue, so your leases have been hidden from students.</p>
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
      <p>Invoice: ${e(formatCents(totalCents))}, dated ${e(dateOnly(invoiceDate))}, unpaid more than 30 days past its due date.<br/>
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

// includeAgreement is false until the marketing agreement is ready, so the email
// only asks for what a landlord can actually do yet.
export function enrollmentEmail({ name, deadline, includeAgreement = true, paymentsUrl }) {
  const ask = includeAgreement ? "add a payment method and sign the marketing agreement" : "add a payment method";
  return {
    subject: "Set up payments on Proximity",
    html: wrap(`
      ${hello(name)}
      <p>Proximity now collects fees in the app instead of by external invoice. Please ${ask}${
        deadline ? ` by ${e(deadline)}` : ""
      }. A bank account (ACH) is the recommended option.</p>
      ${button(paymentsUrl, "Set up billing")}
      <p>Charges are reviewed before they are collected, and you can approve or contest each one from the Billing tab of your dashboard.</p>
    `),
  };
}

/*
 * Asking a landlord to sign the marketing agreement (sent by an admin from the
 * dashboard). The PDF is attached so they can read it anywhere; signing happens
 * on their Billing tab. `resign` when a new version replaces one they signed.
 */
export function agreementRequestEmail({ name, versionLabel, signUrl, resign = false, deadline = null }) {
  const what = resign
    ? `We have updated the Proximity marketing agreement${versionLabel ? ` (${e(versionLabel)})` : ""}. Please review and sign the new version`
    : `Please review and sign the Proximity marketing agreement${versionLabel ? ` (${e(versionLabel)})` : ""}`;
  return {
    subject: resign ? "Please sign the updated Proximity marketing agreement" : "Please sign your Proximity marketing agreement",
    html: wrap(`
      ${hello(name)}
      <p>${what}${deadline ? ` by ${e(deadline)}` : ""}. It sets out the fee Proximity charges when it brings you a tenant. A copy is attached for your records.</p>
      ${button(signUrl, "Review and sign")}
      <p>You sign it in your Proximity landlord dashboard, under Billing. It takes about two minutes, and you can view your signed copy there at any time.</p>
      <p>Questions about the terms? Just reply to this email.</p>
    `),
  };
}

export function agreementDeclinedTeamEmail({ landlordName, landlordEmail, reason, kind = "master", changeRequest = null, adminUrl = null }) {
  const what = kind === "amendment" ? "Exhibit A amendment" : "marketing agreement";
  const request = changeRequest
    ? `<p>${changeRequest.opened ? "We opened a change request for them with this reason." : "We added this reason to the change request they already had open."} They were asked to add the section, their proposed wording and any files straight away. You will get another email if they do.</p>${adminUrl ? button(adminUrl, "Open Change requests") : ""}`
    : "<p>Reach out to them; they can sign again from their Billing tab, or ask for changes there.</p>";
  return {
    subject: `${kind === "amendment" ? "Exhibit A amendment" : "Marketing agreement"} declined: ${landlordName || landlordEmail || "a landlord"}`,
    html: wrap(`
      <p>${e(landlordName || "A landlord")}${landlordEmail ? ` (${e(landlordEmail)})` : ""} declined to sign the ${what} in Documenso.</p>
      <p>Reason given: ${reason ? e(reason) : "none"}</p>
      ${request}
      <p>The properties it would have covered stay as drafts while the agreement is required.</p>
    `),
  };
}

// ── Agreement change requests ───────────────────────────────────────────────

const DOC_LABEL = { master: "the marketing agreement", amendment: "an Exhibit A amendment" };
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
      <p>These landlords asked for changes to the marketing agreement and have not heard back in 5 days or more:</p>
      <ul>${rows}</ul>
      ${button(adminUrl, "Answer in admin")}
    `),
  };
}

// To the landlord: the team replied, accepted or declined.
export function changeRequestUpdateEmail({ name, outcome, message, paymentsUrl }) {
  const lead = {
    replied: "We replied to your request to change the marketing agreement.",
    accepted:
      "We agreed to your requested changes. We are preparing a version of the agreement for you, and you will be able to sign it in your Billing tab once it is ready.",
    declined:
      "We are not able to make the changes you asked for. You can still sign the standard agreement in your Billing tab, or reply with a new request.",
  }[outcome] ?? "There is an update on your request to change the marketing agreement.";
  return {
    subject:
      outcome === "accepted"
        ? "Your marketing agreement change request was accepted"
        : outcome === "declined"
          ? "About your marketing agreement change request"
          : "We replied to your marketing agreement change request",
    html: wrap(`
      ${hello(name)}
      <p>${lead}</p>
      ${message ? quote(message) : ""}
      ${button(paymentsUrl, "View in Proximity")}
    `),
  };
}

// ── Invoices and autopay (decisions of 2026-11-04) ──────────────────────────

const longDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "long", day: "numeric" });

/*
 * The monthly invoice: what is on it, when it is due, and Pay now. With autopay
 * on it says which method will be charged and on what date, which is the notice
 * the landlord gets before the debit. `payUrl` is their Billing tab;
 * `hostedUrl` is Stripe's invoice page, offered to pay another way.
 */
export function invoiceIssuedEmail({ name, periodLabel, lines = [], totalCents, dueDate, payUrl, hostedUrl = null, autopay = null }) {
  const rows = lines
    .map((l) => {
      const basis = basisLabel(l);
      return `<tr>
        <td style="padding:6px 12px 6px 0;border-top:1px solid #e5e7eb;vertical-align:top">${e(l.description)}${
          basis ? `<br/><span style="color:#6b7280;font-size:13px">${e(basis)}</span>` : ""
        }</td>
        <td style="padding:6px 0;border-top:1px solid #e5e7eb;text-align:right;vertical-align:top;white-space:nowrap">${e(formatCents(l.amountCents))}</td>
      </tr>`;
    })
    .join("");
  return {
    subject: `Your Proximity invoice for ${periodLabel}: ${formatCents(totalCents)}`,
    html: wrap(`
      ${hello(name)}
      <p>Here is your Proximity invoice for ${e(periodLabel)}. It is due by <strong>${e(longDate(dueDate))}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;margin:12px 0">${rows}
        <tr><td style="padding:8px 12px 0 0;border-top:2px solid #111827;font-weight:600">Total</td>
        <td style="padding:8px 0 0;border-top:2px solid #111827;text-align:right;font-weight:600">${e(formatCents(totalCents))}</td></tr>
      </table>
      ${
        autopay
          ? `<p><strong>Autopay is on.</strong> We will charge ${e(autopay.methodDescription)} for ${e(formatCents(totalCents))} on ${e(longDate(autopay.scheduledFor))}. To pay another way first, or to turn autopay off, open your Billing page before then.</p>`
          : "<p>Nothing is charged automatically. Pay it from your Billing page when you are ready.</p>"
      }
      ${button(payUrl, autopay ? "View invoice" : "Pay now")}
      ${hostedUrl ? `<p style="font-size:13px;color:#6b7280">You can also <a href="${e(hostedUrl)}">pay on Stripe's invoice page</a>, with a different card or bank account.</p>` : ""}
      <p>Questions about a charge? Just reply to this email.</p>
    `),
  };
}

// Autopay was switched off for a reason the landlord did not choose themselves.
// Autopay switched to another method: open invoices will be charged on it, on these dates.
export function autopayMovedEmail({ name, methodDescription, invoices = [], paymentsUrl }) {
  const items = invoices
    .map((i) => `<li>${e(formatCents(i.totalCents))} on ${e(longDate(i.scheduledFor))}</li>`)
    .join("");
  return {
    subject: "Autopay will charge your new payment method",
    html: wrap(`
      ${hello(name)}
      <p>You switched autopay to ${e(methodDescription)}. ${
        invoices.length === 1 ? "Your open invoice" : "Your open invoices"
      } will now be charged to it:</p>
      <ul>${items}</ul>
      <p>To pay another way first, or to turn autopay off, open your Billing page before then.</p>
      ${button(paymentsUrl, "View invoices")}
    `),
  };
}

export function autopayOffEmail({ name, reason, methodDescription = null, paymentsUrl }) {
  return {
    subject: "Autopay is off for your Proximity invoices",
    html: wrap(`
      ${hello(name)}
      <p>Autopay for your Proximity invoices is now off, because ${e(reason)}${
        methodDescription ? ` (${e(methodDescription)})` : ""
      }.</p>
      <p>Your next invoices will not be charged automatically. To turn autopay back on, choose a payment method on your Billing page.</p>
      ${button(paymentsUrl, "Choose a payment method")}
    `),
  };
}

/*
 * A landlord named this person to sign the marketing agreement and pay for their
 * account (Project B, Wyatt 2026-11-09). The agreement and the Missouri Broker
 * Disclosure Form are attached: the form is received BEFORE signing (§11(a)).
 * `setupUrl` when the account has no way to sign in yet (a set-password link),
 * else `signUrl` (their Billing page).
 */
// `listingsOnly`: named for the listings listed, not the whole account (Wyatt, 2026-11-25).
export function payerInviteEmail({ name, landlordName, addresses = [], setupUrl = null, signUrl, existingAgreement = false, listingsOnly = false }) {
  const one = addresses.length === 1;
  const forWhat = listingsOnly ? (one ? "one of their listings" : "some of their listings") : "their account";
  const theirs = listingsOnly ? (one ? "this property" : "these properties") : "their properties";
  const list = addresses.length
    ? `<ul>${addresses.slice(0, 20).map((a) => `<li>${e(a)}</li>`).join("")}${addresses.length > 20 ? `<li>and ${addresses.length - 20} more</li>` : ""}</ul>`
    : "";
  const ask = existingAgreement
    ? `add ${theirs} to your Proximity marketing agreement with a short addendum, and to pay Proximity's fees for ${listingsOnly && one ? "it" : "them"}`
    : `sign Proximity's marketing agreement for ${theirs} and to pay Proximity's fees for ${listingsOnly && one ? "it" : "them"}`;
  return {
    subject: `${landlordName} asked you to sign for their Proximity listings`,
    html: wrap(`
      ${hello(name)}
      <p>${e(landlordName)} lists rentals on Proximity, the off-campus housing site for WashU students, and named you as the authorized signer for ${forWhat}: the person who signs the marketing agreement and pays the invoices. They asked you to ${ask}.</p>
      ${list}
      <p>Two documents are attached: the marketing agreement, and the Missouri Broker Disclosure Form. Please read the disclosure form before you sign.</p>
      ${setupUrl ? button(setupUrl, "Set a password and review") : button(signUrl, "Review and sign")}
      <p>${setupUrl ? "You'll set a password for your Proximity billing account, then review and sign on your Billing page. The link works for 14 days." : "Log in to Proximity, then review and sign on your Billing page."} Nothing is charged until a student who found the property on Proximity signs a lease.</p>
      <p>Not the right person, or have questions about the terms? Just reply to this email.</p>
    `),
  };
}

// More of a landlord's listings are waiting for the payer's signature (one email per send).
export function payerRequestEmail({ name, landlordName, addresses = [], signUrl }) {
  return {
    subject: `${landlordName} added listings for you to sign`,
    html: wrap(`
      ${hello(name)}
      <p>${e(landlordName)} wants to publish ${addresses.length === 1 ? "a listing" : "listings"} on Proximity under your marketing agreement:</p>
      <ul>${addresses.slice(0, 20).map((a) => `<li>${e(a)}</li>`).join("")}</ul>
      <p>${addresses.length === 1 ? "It stays" : "They stay"} a draft until you approve ${addresses.length === 1 ? "it" : "them"} by signing a short addendum. If you are signing something for them already, that stays as it is: these go on the next one.</p>
      ${button(signUrl, "Review and sign")}
    `),
  };
}

// To the landlord: their authorized signer signed. What they approved (the
// landlord publishes it), what they declined, and any live listing taken off.
export function payeeSignedEmail({ name, payerName, approved = [], declined = [], withdrawn = [], waitingOnPayment = false, billingUrl }) {
  const list = (items) => `<ul>${items.slice(0, 30).map((a) => `<li>${e(a)}</li>`).join("")}</ul>`;
  const one = approved.length === 1;
  return {
    subject: approved.length ? `${payerName} approved ${one ? "your listing" : "your listings"}. Publish when you're ready` : `${payerName} signed your Proximity agreement`,
    html: wrap(`
      ${hello(name)}
      <p>${e(payerName)} signed${approved.length ? ` and approved ${one ? "this listing" : "these listings"}:` : " the Proximity marketing agreement for your account."}</p>
      ${approved.length ? list(approved) : ""}
      ${approved.length ? `<p>${one ? "It is" : "They are"} still ${one ? "a draft" : "drafts"}. ${waitingOnPayment ? `You can publish ${one ? "it" : "them"} once ${e(payerName)} adds a payment method.` : `Publish ${one ? "it" : "them"} from your drafts when you're ready.`}</p>` : ""}
      ${declined.length ? `<p>${e(payerName)} declined ${declined.length === 1 ? "this one" : "these"}, so ${declined.length === 1 ? "it stays a draft" : "they stay drafts"}:</p>${list(declined)}<p>You can send ${declined.length === 1 ? "it" : "them"} again from your Billing page.</p>` : ""}
      ${withdrawn.length ? `<p>${e(payerName)} also left ${withdrawn.length === 1 ? "this listing" : "these listings"} off, so ${withdrawn.length === 1 ? "it was" : "they were"} taken off the site:</p>${list(withdrawn)}` : ""}
      ${button(billingUrl, "View on Billing")}
    `),
  };
}

// To a payer: a document they were signing was cancelled because one account changed
// signer, ended it, or started signing their own agreement ("takeover").
const CANCEL_CAUSE = {
  ended: "no longer has you as their authorized signer",
  takeover: "is signing their own agreement",
  changed: "changed who signs for their account",
};

export function payerDocumentCancelledEmail({ name, causeName, accountNames = [], reason = "changed", signUrl }) {
  const others = accountNames.length === 1 ? accountNames[0] : `${accountNames.slice(0, -1).join(", ")} and ${accountNames.at(-1)}`;
  return {
    subject: "The agreement you were signing was cancelled",
    html: wrap(`
      ${hello(name)}
      <p>${e(causeName)} ${CANCEL_CAUSE[reason] ?? CANCEL_CAUSE.changed}, so the agreement you were signing for them${accountNames.length ? ` and ${e(others)}` : ""} was cancelled. A document can't be changed once it is sent for signature.</p>
      ${accountNames.length ? `<p>Nothing is lost for ${e(others)}: open your Billing page to sign for ${accountNames.length === 1 ? "them" : "those accounts"} again.</p>` : ""}
      ${button(signUrl, "Open Billing")}
      <p>Questions? Just reply to this email.</p>
    `),
  };
}

// To an authorized signer a landlord revoked (Wyatt, 2026-11-10). `tookOver`:
// the landlord signed their own agreement instead.
// `listingAddress`: they signed for that one listing only, and may still sign
// for others of the same landlord. `byAdmin`: Proximity ended it, not the landlord.
export function payerRevokedEmail({ name, landlordName, released = 0, tookOver = false, byAdmin = false, listingAddress = null, billingUrl }) {
  const count = `${released} ${released === 1 ? "property" : "properties"}`;
  const cause = tookOver
    ? `${e(landlordName)} signed their own Proximity marketing agreement`
    : byAdmin
      ? `Proximity removed you as the authorized signer for ${listingAddress ? `${e(landlordName)}'s listing at ${e(listingAddress)}` : e(landlordName)}`
      : `${e(landlordName)} removed you as the authorized signer for ${listingAddress ? `their listing at ${e(listingAddress)}` : "their account"} on Proximity`;
  const effect = listingAddress ? "you no longer sign or pay for that listing. Anything else you sign for them is unchanged" : "you no longer sign or pay for their listings";
  return {
    subject: listingAddress ? `You are no longer the authorized signer for ${listingAddress}` : `You are no longer the authorized signer for ${landlordName}`,
    html: wrap(`
      ${hello(name)}
      <p>${cause}, so ${effect}.${released ? ` ${listingAddress ? "It" : `Their ${count}`} came off your agreement.` : ""}</p>
      <p>Your agreement stays in force for everything else on it. Charges raised while their listings were on your agreement stay on your invoices; anything new is billed to them.</p>
      ${button(billingUrl, "Open Billing")}
      <p>Questions? Just reply to this email.</p>
    `),
  };
}

// To a landlord whose payer Proximity set up for them (an admin assigned it).
// `listings`: the addresses, when they sign for those listings only.
export function payeeAssignedEmail({ name, payerName, listings = [], billingUrl }) {
  const some = listings.length > 0;
  return {
    subject: `${payerName} is now the authorized signer for ${some ? (listings.length === 1 ? "one of your Proximity listings" : "some of your Proximity listings") : "your Proximity listings"}`,
    html: wrap(`
      ${hello(name)}
      <p>${e(payerName)} is now the authorized signer for ${some ? (listings.length === 1 ? "this listing" : "these listings") : "your account"}: they sign Proximity's marketing agreement for ${some ? (listings.length === 1 ? "it" : "them") : "your listings"} and receive the invoices, unless you name a separate authorized payer. We have emailed them the agreement to sign.</p>
      ${some ? `<ul>${listings.slice(0, 20).map((a) => `<li>${e(a)}</li>`).join("")}</ul>` : ""}
      <p>${some ? "Nothing changes for your other listings." : "You don't need to sign anything."} On your Billing page you can see when they have signed, which listings are covered, and each charge.</p>
      ${button(billingUrl, "Open Billing")}
      <p>Questions? Just reply to this email.</p>
    `),
  };
}

// ── Authorized payer (Wyatt, 2026-11-25) ─────────────────────────────────────

const forWhat = (landlordName, listingAddress) => (listingAddress ? `${e(landlordName)}'s listing at ${e(listingAddress)}` : `${e(landlordName)}'s listings`);

/*
 * A landlord named this person as the authorized payer for their account, or for
 * one listing. Nothing is billed to them until they accept. `setupUrl` when the
 * account has no way to sign in yet (a set-password link), else `acceptUrl`.
 */
export function authorizedPayerInviteEmail({ name, landlordName, listingAddress = null, setupUrl = null, acceptUrl }) {
  return {
    subject: `${landlordName} asked you to pay for their Proximity listings`,
    html: wrap(`
      ${hello(name)}
      <p>${e(landlordName)} lists rentals on Proximity, the off-campus housing site for WashU students, and named you as the authorized payer for ${forWhat(landlordName, listingAddress)}: the person who receives and pays Proximity's invoices for ${listingAddress ? "it" : "them"}.</p>
      <p>Nothing is billed to you unless you accept. If you accept, the charges made from then on are invoiced to you, you add the payment method, and you can review or dispute each charge before it is invoiced. Proximity only charges when a student who found the property on Proximity signs a lease.</p>
      ${setupUrl ? button(setupUrl, "Set a password and review") : button(acceptUrl, "Review the request")}
      <p>${setupUrl ? "You'll set a password for your Proximity billing account, then accept or decline on your Billing page. The link works for 14 days." : "Log in to Proximity, then accept or decline on your Billing page."}</p>
      <p>Not the right person, or have questions? Just reply to this email.</p>
    `),
  };
}

// To the landlord: the person they named accepted, and is billed from now on.
export function authorizedPayerAcceptedEmail({ name, payerName, listingAddress = null, billingUrl }) {
  return {
    subject: `${payerName} accepted: they now pay for ${listingAddress ? "your listing" : "your Proximity listings"}`,
    html: wrap(`
      ${hello(name)}
      <p>${e(payerName)} accepted your request to be the authorized payer for ${listingAddress ? `your listing at ${e(listingAddress)}` : "your account"}. Charges made from now on are invoiced to them. Charges made before today stay with whoever they were billed to.</p>
      <p>You still see every charge on your Billing page and can dispute one during its review, as they can.</p>
      ${button(billingUrl, "Open Billing")}
    `),
  };
}

// To the landlord: the person they named declined. Nothing changed.
export function authorizedPayerDeclinedEmail({ name, payerName, listingAddress = null, billingUrl }) {
  return {
    subject: `${payerName} declined to pay for ${listingAddress ? "your listing" : "your Proximity listings"}`,
    html: wrap(`
      ${hello(name)}
      <p>${e(payerName)} declined your request to be the authorized payer for ${listingAddress ? `your listing at ${e(listingAddress)}` : "your account"}. Nothing changed: charges are billed as they were before.</p>
      <p>You can name someone else on your Billing page.</p>
      ${button(billingUrl, "Open Billing")}
    `),
  };
}

// To a payer the landlord (or Proximity) removed.
export function authorizedPayerRemovedEmail({ name, landlordName, listingAddress = null, accepted = true, billingUrl }) {
  return {
    subject: `You are no longer the authorized payer for ${landlordName}`,
    html: wrap(`
      ${hello(name)}
      <p>${e(landlordName)} ${accepted ? "removed you as the authorized payer" : "withdrew their request for you to be the authorized payer"} for ${forWhat(landlordName, listingAddress)} on Proximity.</p>
      ${accepted ? "<p>Nothing new is billed to you for it. Charges made while you were their payer stay on your invoices.</p>" : "<p>Nothing was billed to you.</p>"}
      ${accepted ? button(billingUrl, "Open Billing") : ""}
      <p>Questions? Just reply to this email.</p>
    `),
  };
}

// To a landlord whose authorized signer or payer deleted their Proximity account:
// the arrangement ended with it. `role` "signer" or "payer".
export function linkHolderGoneEmail({ name, personName, role = "payer", listingAddress = null, billingUrl }) {
  const what = listingAddress ? `your listing at ${e(listingAddress)}` : "your account";
  return {
    subject: `${personName} is no longer your authorized ${role}`,
    html: wrap(`
      ${hello(name)}
      <p>${e(personName)} deleted their Proximity account, so they are no longer the authorized ${role} for ${what}.</p>
      ${
        role === "signer"
          ? `<p>${listingAddress ? "That listing is" : "Your listings are"} no longer covered by their marketing agreement. Anything live stays on the site, but nothing new can be published until you sign the agreement yourself or name someone else.</p>`
          : "<p>Charges made from now on are billed to whoever signs for the listing, or to you. Charges made before today stay with whoever they were billed to.</p>"
      }
      ${button(billingUrl, "Open Billing")}
      <p>Questions? Just reply to this email.</p>
    `),
  };
}

// To a landlord whose authorized payer Proximity set up for them (an admin named it).
export function authorizedPayerAssignedEmail({ name, payerName, listings = [], billingUrl }) {
  const some = listings.length > 0;
  return {
    subject: `${payerName} was asked to pay for ${some ? "some of your Proximity listings" : "your Proximity listings"}`,
    html: wrap(`
      ${hello(name)}
      <p>We asked ${e(payerName)} to be the authorized payer for ${some ? (listings.length === 1 ? "this listing" : "these listings") : "your account"}: the person who receives and pays Proximity's invoices.</p>
      ${some ? `<ul>${listings.slice(0, 20).map((a) => `<li>${e(a)}</li>`).join("")}</ul>` : ""}
      <p>Nothing changes until they accept. Once they do, charges made from then on are invoiced to them. You can see their status, or remove them, on your Billing page.</p>
      ${button(billingUrl, "Open Billing")}
      <p>Questions? Just reply to this email.</p>
    `),
  };
}
