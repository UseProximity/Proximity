/*
 * The billing rules that are numbers, in one place. Each comes from the In-App
 * Payments PRD, so changing one is a product decision, not a code cleanup.
 */

// Days a confirmed charge sits in Pending before it is approved automatically.
// The clock starts when it enters Pending, not when it was created.
export const REVIEW_DAYS = 7;

// An Approved total under this is not invoiced; the charges roll to next month.
export const MIN_INVOICE_CENTS = 500;

// An invoice unpaid for more than this many days after its due date withdraws
// the landlord's leases (invoices from before due dates count from the invoice
// date). Never counted from a charge date, because charges under the minimum can
// wait months.
export const OVERDUE_DAYS = 30;

// The monthly run happens on the first Monday of the month in this zone.
export const BILLING_TIME_ZONE = "America/Chicago";

// Where contests, failures, chargebacks and overdue notices go.
export const BILLING_TEAM_EMAIL = "info@useproximity.org";

// The sent_emails kind of the "please sign the commission agreement" email. The admin
// dashboard reads the latest one per landlord to show when they were last asked.
export const AGREEMENT_REQUEST_KIND = "billing_agreement_request";

export const CHARGE_STATUSES = [
  "unconfirmed",
  "pending",
  "approved",
  "invoiced",
  "paid",
  "contested",
  "voided",
];

export const DAY_MS = 24 * 60 * 60 * 1000;

// ── Invoices and autopay (decisions of 2026-11-04) ──────────────────────────

// Invoices are sent for the landlord to pay (Stripe send_invoice), due this many
// days after they are sent. The overdue clock (OVERDUE_DAYS) starts at the due date.
export const INVOICE_DUE_DAYS = 30;

// Autopay charges an invoice this many business days after it is sent (America/
// Chicago, skipping weekends and US Federal Reserve holidays), so the landlord
// has notice of the amount and date first.
export const AUTOPAY_BUSINESS_DAYS = 5;

// Autopay is switched off after this many failed autopay charges in a row.
export const AUTOPAY_MAX_FAILURES = 2;

// The sent_emails kinds of the invoice and autopay emails.
export const INVOICE_ISSUED_KIND = "billing_invoice_issued";
export const AUTOPAY_OFF_KIND = "billing_autopay_off";
