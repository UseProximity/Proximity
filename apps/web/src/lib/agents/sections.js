/*
 * The vocabulary of the knowledge store: sections, scopes, the fee and policy
 * keys the app knows, and the small formatters that turn a structured value
 * into the one-line summary a student may be shown.
 *
 * Every fact belongs to one section:
 *   core       the displayed fields (rent, beds, availability). Their values
 *              live in the listing, unit and lease tables and are read live;
 *              a core fact only records where a value came from.
 *   fees       application, admin, deposits, pet fees, parking, utilities
 *   policies   pets, guarantors, subletting, smoking, lease terms, renewal
 *   specials   concessions and move-in deals, each with a valid-until date
 *   misc       anything else true about the building
 *
 * A field key is dotted inside its section (fee.application, policy.pets,
 * special.<slug>, misc.<slug>). Fees and policies use the keys below so the
 * same thing lands in the same place whoever wrote it; specials and misc take
 * free slugs.
 *
 * A fact applies at one scope: the property, one owner's offer (all of that
 * landlord's leases at the property), one unit type, or one lease. Leases
 * nobody owns yet (imported, unclaimed) form their own owner group, keyed by
 * UNCLAIMED_OWNER_ID, so Proxy can say "the unclaimed leases allow cats" and
 * never merge one owner's terms into another's.
 */

export const SECTIONS = ["core", "fees", "policies", "specials", "misc"];
export const SCOPES = ["property", "owner", "unit", "lease"];
export const UNCLAIMED_OWNER_ID = "00000000-0000-0000-0000-000000000000";

export const CONFIDENCES = ["high", "medium", "low"];

export const CAUSES = [
  "seed", "sync", "url_added", "landlord_chat", "landlord_answer",
  "dashboard", "admin", "document", "backfill", "revert",
];

/* fee_types.name -> the label students see. */
export const FEE_LABELS = {
  application: "Application fee",
  booking: "Booking fee",
  admin: "Admin fee",
  security_deposit: "Security deposit",
  pet_deposit: "Pet deposit",
  cleaning: "Cleaning fee",
  cleaning_credit: "Cleaning credit",
  parking: "Parking",
  pet_rent: "Pet rent",
  utility_admin: "Utility billing fee",
  storage: "Storage fee",
  amenity: "Amenity fee",
  late: "Late fee",
  lockout: "Lockout fee",
  late_termination: "Early termination fee",
  holdover: "Holdover fee",
  returned_check: "Returned check fee",
};

/* Fees charged every month rather than once. */
const MONTHLY_FEES = new Set(["pet_rent", "parking", "storage", "amenity"]);

export const POLICY_LABELS = {
  pets: "Pets",
  guarantors: "Guarantors",
  cosigners: "Cosigners",
  income: "Income requirement",
  subletting: "Subletting",
  smoking: "Smoking",
  lease_terms: "Lease terms",
  renewal: "Renewal",
  guests: "Guests",
  move_out: "Move-out",
  parking: "Parking",
  utilities: "Utilities",
  quiet_hours: "Quiet hours",
  furnishing: "Furnishing",
};

export function slugify(text, max = 48) {
  const s = String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, max)
    .replace(/-$/, "");
  return s || "item";
}

export function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const whole = Math.round(v) === v;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/* "Oct 8, 2026" in St. Louis time. */
export function shortDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

/* Today's date (YYYY-MM-DD) in St. Louis, for validity windows. */
export function todayChicago() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function basisWords(basis, monthly) {
  const b = String(basis ?? "flat");
  const parts = [];
  if (b === "per_person") parts.push("per person");
  else if (b === "per_unit") parts.push("per unit");
  else if (b !== "flat") parts.push(b.replace(/_/g, " "));
  if (monthly) parts.push("a month");
  return parts.join(" ");
}

/*
 * One fee item -> "Application fee: $60 per person, non-refundable. Charged
 * per applicant". Several items of the same type (deposit by bedroom count,
 * say) are joined with semicolons under one label.
 */
const DEPOSIT_FEES = new Set(["security_deposit", "pet_deposit", "booking"]);

export function feeSummary(name, items) {
  const label = FEE_LABELS[name] ?? `${String(name).replace(/_/g, " ")} fee`;
  const monthly = MONTHLY_FEES.has(name);
  const parts = (items ?? []).map((it) => {
    const bits = [];
    const amt = money(it.amount);
    if (amt) {
      const basis = basisWords(it.basis, monthly);
      bits.push(basis ? `${amt} ${basis}` : amt);
    }
    // "Refundable" matters on a deposit; "non-refundable" on an application
    // fee is noise, so it is said only where a student might expect money back.
    if (it.refundable === true) bits.push("refundable");
    else if (it.refundable === false && DEPOSIT_FEES.has(name)) bits.push("non-refundable");
    let s = bits.join(", ");
    const tail = [it.conditions, it.notes]
      .filter((t) => t && String(t).trim())
      .map((t) => String(t).trim().replace(/\.$/, ""))
      // Curated notes often just repeat the label ("Application fee").
      .filter((t) => t.toLowerCase() !== label.toLowerCase() && t.toLowerCase() !== `${label.toLowerCase()}, per month`);
    if (tail.length) s = s ? `${s}. ${tail.join(". ")}` : tail.join(". ");
    return s;
  }).filter(Boolean);
  const body = parts.join("; ");
  return body ? `${label}: ${body}` : label;
}

export function specialSummary(c) {
  const d = String(c.description ?? "").trim().replace(/\s+/g, " ");
  const until = c.valid_until ? ` Valid until ${shortDate(c.valid_until)}.` : "";
  const base = d.endsWith(".") ? d : `${d}.`;
  return (d ? base : "Move-in special.") + until;
}

/* No em dash ever reaches a student (repo rule). */
export function cleanText(value) {
  if (typeof value !== "string") return value;
  return value.replace(/—/g, ", ").replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim();
}
