/*
 * Payment method states and how to show them. Only Stripe ids and display
 * fields are stored, never raw card or bank details.
 *
 *   verifying  a bank account waiting on verification (microdeposits take 1 to 2 days)
 *   active     usable
 *   expired    a card past its expiry month
 *   failed     the last payment with it failed
 *
 * Expired and Failed prompt the landlord to update their method.
 */

const BRAND_NAMES = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

// A card is good through the last day of its expiry month.
export function isCardExpired(expMonth, expYear, now = new Date()) {
  if (!expMonth || !expYear) return false;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return expYear < y || (expYear === y && expMonth < m);
}

// The status to show: the stored one, except a card that has expired since it
// was last synced reads as expired without waiting for a webhook.
export function effectiveStatus(method, now = new Date()) {
  if (method.status === "active" && method.type === "card" && isCardExpired(method.exp_month, method.exp_year, now)) {
    return "expired";
  }
  return method.status;
}

export function needsAttention(status) {
  return status === "expired" || status === "failed";
}

// "Visa ending 4242, expires 04/2028" or "Chase account ending 6789"
export function describeMethod(method) {
  if (method.type === "card") {
    const brand = BRAND_NAMES[method.brand] ?? "Card";
    const expiry =
      method.exp_month && method.exp_year
        ? `, expires ${String(method.exp_month).padStart(2, "0")}/${method.exp_year}`
        : "";
    return `${brand} ending ${method.last4}${expiry}`;
  }
  return `${method.bank_name || "Bank"} account ending ${method.last4}`;
}

// Whether a landlord has a method that clears the listing gate: an Active one.
// A bank account still Verifying does not count (default; the PRD leaves this open).
export function hasActivePaymentMethod(methods, now = new Date()) {
  return (methods ?? []).some((m) => !m.deleted_at && effectiveStatus(m, now) === "active");
}
