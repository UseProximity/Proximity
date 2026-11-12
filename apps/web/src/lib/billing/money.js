/*
 * Money is integer cents everywhere in billing (Stripe's unit). Convert only at
 * the edges: formatCents for display, dollarsToCents for admin input.
 */

export function formatCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "$0.00";
  const abs = Math.abs(Math.round(n));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = String(abs % 100).padStart(2, "0");
  return `${n < 0 ? "-" : ""}$${dollars}.${rest}`;
}

// "12.50" or 12.5 -> 1250. Null for anything that is not a positive amount with
// at most two decimals, so a typo is rejected instead of rounded into a charge.
export function dollarsToCents(input) {
  const s = String(input ?? "").trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 ? cents : null;
}
