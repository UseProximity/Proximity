/*
 * Edge-case suite for Lease Check. Each case builds a synthetic document (or set of
 * documents) with KNOWN ground truth and returns case-specific assertions. The runner
 * additionally applies universal assertions (see run.mjs): no em dashes in stored
 * text, no address leak into summary/flags, no PII in quotes, and (for text PDFs)
 * every quote must actually appear in the source (hallucination guard).
 *
 * Assertion shape: { label, pass: boolean, detail?: string, soft?: boolean }.
 * A `soft` assertion that fails is reported as a WARN, not a hard failure — used where
 * the correct behavior is a range (e.g. a blurry image may be read OR marked unreadable).
 */
import { makePdf, makeLeaseImage } from "./generators.mjs";

export function ppm({ rentAsStated, rentType, numTenants, leaseTermMonths }) {
  const n = Math.max(1, numTenants);
  switch (rentType) {
    case "per_month_per_tenant": return rentAsStated;
    case "per_month_all_tenants": return rentAsStated / n;
    case "total": return rentAsStated / Math.max(1, leaseTermMonths) / n;
    default: return null;
  }
}

const HEADER = [
  "RESIDENTIAL LEASE AGREEMENT",
  "",
  "Premises: 6633 Clemens Ave, St. Louis, MO 63130 (three bedrooms, one bath)",
  "Landlord: Gateway Loop Properties LLC  (leasing@gatewayloopstl.com)",
  "Term: twelve (12) months, beginning August 1, 2026 and ending July 31, 2027.",
  "",
  "2. OCCUPANCY. The Premises shall be occupied by three (3) Tenants only.",
];

const RISKY = [
  "7. LIABILITY. Each Tenant is jointly and severally liable for all obligations",
  "under this Lease, including the full amount of rent owed by all Tenants.",
  "8. SUBLETTING. Tenant shall not sublet the Premises or any part thereof.",
  "9. RENEWAL. This Lease renews automatically for a further twelve month term",
  "unless Tenant gives written notice at least ninety (90) days before expiry.",
];

const SIGNATURES = [
  "",
  "SIGNATURES",
  "Tenant 1: ______________________   Date: ________",
  "Tenant 2: ______________________   Date: ________",
  "Tenant 3: ______________________   Date: ________",
  "Landlord: ______________________   Date: ________",
];

const ADDRESS = "6633 Clemens Ave";
const near = (a, b, tol = 1) => a != null && b != null && Math.abs(a - b) <= tol;
const flagText = (a) =>
  (a.flags || []).map((f) => `${f.title} ${f.explanation} ${f.question}`).join(" ␟ ").toLowerCase();
const mentions = (a, ...words) => {
  const t = flagText(a);
  return words.some((w) => t.includes(w.toLowerCase()));
};

export const CASES = [
  {
    id: "rent_per_person",
    category: "rent",
    async build() {
      const lines = [...HEADER, "",
        "3. RENT. Each Tenant shall pay Landlord rent of $780.00 per Tenant per month,",
        "due on the first day of each calendar month.", "", ...RISKY, ...SIGNATURES];
      return { documents: [makePdf(lines)], sourceText: lines.join("\n"), address: ADDRESS };
    },
    check(a, { gateOpen, perPerson }) {
      return [
        { label: "comps gate open", pass: gateOpen },
        { label: "per-person == 780", pass: near(perPerson, 780), detail: `got ${perPerson}` },
        { label: "numTenants == 3", pass: a.rent?.numTenants === 3, detail: `got ${a.rent?.numTenants}` },
        { label: "bedrooms == 3", pass: a.bedrooms === 3, detail: `got ${a.bedrooms}` },
        { label: "flags joint-and-several liability", pass: mentions(a, "jointly", "roommate", "each other", "full rent") },
        { label: "flags subletting ban", pass: mentions(a, "sublet", "subletting") },
      ];
    },
  },
  {
    id: "rent_whole_term_total",
    category: "rent",
    async build() {
      const lines = [...HEADER, "",
        "3. RENT. The total rent for the entire Term of this Lease is $28,080.00,",
        "payable by Tenants in equal monthly installments due the first of each month.", "", ...RISKY, ...SIGNATURES];
      return { documents: [makePdf(lines)], sourceText: lines.join("\n"), address: ADDRESS };
    },
    check(a, { gateOpen, perPerson }) {
      return [
        { label: "comps gate open", pass: gateOpen },
        { label: "per-person == 780 (28080/12/3)", pass: near(perPerson, 780), detail: `got ${perPerson}` },
        { label: "rentType == total", pass: a.rent?.rentType === "total", detail: `got ${a.rent?.rentType}` },
        { label: "numTenants == 3", pass: a.rent?.numTenants === 3, detail: `got ${a.rent?.numTenants}` },
      ];
    },
  },
  {
    id: "rent_per_month_all_tenants",
    category: "rent",
    async build() {
      const lines = [...HEADER, "",
        "3. RENT. Tenants shall together pay Landlord $2,340.00 per month for the",
        "Premises, due on the first day of each calendar month.", "", ...RISKY, ...SIGNATURES];
      return { documents: [makePdf(lines)], sourceText: lines.join("\n"), address: ADDRESS };
    },
    check(a, { gateOpen, perPerson }) {
      return [
        { label: "comps gate open", pass: gateOpen },
        { label: "per-person == 780 (2340/3)", pass: near(perPerson, 780), detail: `got ${perPerson}` },
        { label: "numTenants == 3", pass: a.rent?.numTenants === 3, detail: `got ${a.rent?.numTenants}` },
      ];
    },
  },
  {
    id: "rent_ambiguous",
    category: "rent",
    async build() {
      const lines = [
        "RESIDENTIAL LEASE AGREEMENT", "",
        "Premises: 6633 Clemens Ave, St. Louis, MO 63130", "",
        "Term: twelve (12) months, beginning August 1, 2026.", "",
        "3. RENT. Tenant agrees to pay rent of $3,600.", "",
        "SIGNATURES", "Tenant: ______   Date: ____", "Tenant: ______   Date: ____",
      ];
      return { documents: [makePdf(lines)], sourceText: lines.join("\n"), address: ADDRESS };
    },
    check(a, { gateOpen }) {
      return [
        { label: "comps gate CLOSED (ambiguous rent must not drive comps)", pass: !gateOpen,
          detail: `rent=${JSON.stringify(a.rent)} bedrooms=${a.bedrooms}` },
      ];
    },
  },
  {
    id: "pii_redaction",
    category: "privacy",
    async build() {
      const lines = [...HEADER, "",
        "3. RENT. Each Tenant shall pay $780.00 per Tenant per month.",
        "",
        "12. GUARANTOR. Guarantor personally guarantees all rent. Guarantor SSN:",
        "123-45-6789; bank account for auto-debit: Account No. 000123456789.",
        "Guarantor is liable for the full lease amount if any Tenant defaults.",
        "", ...RISKY, ...SIGNATURES];
      return {
        documents: [makePdf(lines)], sourceText: lines.join("\n"), address: ADDRESS,
        pii: ["123-45-6789", "000123456789"],
      };
    },
    check(a) {
      return [
        { label: "flags the guarantor/co-signer clause", pass: mentions(a, "guarantor", "co-signer", "cosigner", "guarantee") },
      ];
    },
  },
  {
    id: "bedrooms_partial_lease",
    category: "comps-safety",
    async build() {
      const lines = [
        "RESIDENTIAL LEASE AGREEMENT", "",
        "Premises: 6633 Clemens Ave, St. Louis, MO 63130",
        "This is a four (4) bedroom house. Tenant leases 2 of the 4 bedrooms only;",
        "the remaining bedrooms are leased separately to other tenants.",
        "Term: twelve (12) months.", "",
        "3. RENT. Tenant pays $700.00 per bedroom per month for 2 bedrooms.", "",
        ...RISKY, ...SIGNATURES,
      ];
      return { documents: [makePdf(lines)], sourceText: lines.join("\n"), address: ADDRESS };
    },
    check(a) {
      return [
        { label: "bedrooms is 2 or null, NOT 4 (only 2 leased)", pass: a.bedrooms === 2 || a.bedrooms == null,
          detail: `got bedrooms=${a.bedrooms}` },
      ];
    },
  },
  {
    id: "green_terms",
    category: "severity",
    async build() {
      const lines = [
        "RESIDENTIAL LEASE AGREEMENT", "",
        "Premises: 6633 Clemens Ave, St. Louis, MO 63130 (studio, one tenant)",
        "Term: twelve (12) months, August 1 2026 to July 31 2027.", "",
        "3. RENT. Tenant pays $900.00 per month. Landlord pays all utilities.", "",
        "5. SUBLETTING. Tenant may sublet freely with no landlord approval required.",
        "6. DEPOSIT. Security deposit returned in full within 14 days of move-out,",
        "with an itemized statement of any deductions.",
        "7. RENEWAL. This Lease does NOT auto-renew; it simply ends on the end date.",
        "8. ENTRY. Landlord will give 48 hours written notice before entering.",
        "", "SIGNATURES", "Tenant: ______   Date: ____", "Landlord: ______   Date: ____",
      ];
      return { documents: [makePdf(lines)], sourceText: lines.join("\n"), address: ADDRESS };
    },
    check(a) {
      const greens = (a.flags || []).filter((f) => f.severity === "green").length;
      const reds = (a.flags || []).filter((f) => f.severity === "red").length;
      return [
        { label: "at least one green flag on genuinely good terms", pass: greens >= 1, detail: `greens=${greens}` },
        { label: "no red flags on tenant-friendly lease", pass: reds === 0, soft: true, detail: `reds=${reds}` },
      ];
    },
  },
  {
    id: "non_lease_document",
    category: "hallucination",
    async build() {
      const lines = [
        "CHOCOLATE CHIP COOKIES  Recipe", "",
        "Ingredients: 2 cups flour, 1 cup butter, 1 cup brown sugar, 2 eggs,",
        "1 tsp vanilla, 1 tsp baking soda, 2 cups chocolate chips.", "",
        "Method: Cream butter and sugar. Add eggs and vanilla. Mix in dry",
        "ingredients, then chips. Bake at 375F for 10 minutes. Makes 24 cookies.",
      ];
      return { documents: [makePdf(lines)], sourceText: lines.join("\n"), address: null };
    },
    check(a) {
      const reds = (a.flags || []).filter((f) => f.severity === "red").length;
      return [
        { label: "does NOT fabricate lease risks from a non-lease doc",
          pass: reds === 0 && !mentions(a, "jointly and severally", "sublet", "auto-renew", "security deposit"),
          detail: `flags=${(a.flags || []).length}, summary="${(a.summary || "").slice(0, 120)}"` },
        { label: "low overall confidence on out-of-domain input",
          pass: (a.overallConfidence ?? 1) <= 0.5, soft: true, detail: `confidence=${a.overallConfidence}` },
      ];
    },
  },
  {
    id: "image_clean",
    category: "image",
    async build() {
      const lines = [...HEADER, "",
        "3. RENT. Each Tenant shall pay $780.00 per Tenant per month.", "", ...RISKY, ...SIGNATURES];
      return { documents: [await makeLeaseImage(lines, { jpegQ: 80 })], sourceText: null, address: ADDRESS };
    },
    check(a, { gateOpen, perPerson }) {
      return [
        { label: "reads clean photo: comps gate open", pass: gateOpen, soft: true },
        { label: "per-person == 780 from image", pass: near(perPerson, 780), detail: `got ${perPerson}` },
      ];
    },
  },
  {
    id: "image_blurry",
    category: "image",
    async build() {
      const lines = [...HEADER, "",
        "3. RENT. Each Tenant shall pay $780.00 per Tenant per month.", "", ...RISKY, ...SIGNATURES];
      return { documents: [await makeLeaseImage(lines, { blur: 2.6, jpegQ: 30 })], sourceText: null, address: ADDRESS };
    },
    check(a, { perPerson }) {
      const readIt = a.rent && (a.rent.confidence ?? 0) >= 0.7;
      return [
        { label: "blurry: either reads 780 OR reports low confidence/unreadable (never a WRONG rent)",
          pass: readIt ? near(perPerson, 780) : true,
          detail: `perPerson=${perPerson}, conf=${a.rent?.confidence}, unreadable=${JSON.stringify(a.unreadablePages)}` },
      ];
    },
  },
  {
    id: "image_low_res",
    category: "image",
    async build() {
      const lines = [...HEADER, "",
        "3. RENT. Each Tenant shall pay $780.00 per Tenant per month.", "", ...RISKY, ...SIGNATURES];
      return { documents: [await makeLeaseImage(lines, { shrink: 0.28, jpegQ: 40 })], sourceText: null, address: ADDRESS };
    },
    check(a, { perPerson }) {
      const readIt = a.rent && (a.rent.confidence ?? 0) >= 0.7;
      return [
        { label: "low-res: either reads 780 OR low confidence (never a WRONG rent)",
          pass: readIt ? near(perPerson, 780) : true,
          detail: `perPerson=${perPerson}, conf=${a.rent?.confidence}` },
      ];
    },
  },
  {
    id: "image_cut_off",
    category: "image",
    async build() {
      // Top half keeps the rent line; the signature block (tenant count) is cropped away.
      const lines = [...HEADER, "",
        "3. RENT. Each Tenant shall pay $780.00 per Tenant per month.", "", ...RISKY, ...SIGNATURES];
      return { documents: [await makeLeaseImage(lines, { cropTop: 0.5, jpegQ: 60 })], sourceText: null, address: ADDRESS };
    },
    check(a) {
      return [
        { label: "cut-off page: does not crash / returns an analysis", pass: !!a.summary },
        { label: "does not claim high overall confidence on a half-missing page",
          pass: (a.overallConfidence ?? 1) < 0.9, soft: true, detail: `confidence=${a.overallConfidence}` },
      ];
    },
  },
  {
    id: "multi_photo",
    category: "image",
    async build() {
      const page1 = [...HEADER, "",
        "3. RENT. Each Tenant shall pay $780.00 per Tenant per month.", "", ...RISKY];
      const page2 = ["(continued)", ...SIGNATURES];
      return {
        documents: [await makeLeaseImage(page1, { jpegQ: 75 }), await makeLeaseImage(page2, { jpegQ: 75 })],
        sourceText: null, address: ADDRESS,
      };
    },
    check(a, { perPerson }) {
      return [
        { label: "combines 2 photos: per-person == 780", pass: near(perPerson, 780), soft: true, detail: `got ${perPerson}` },
        { label: "combines 2 photos: numTenants == 3", pass: a.rent?.numTenants === 3, soft: true, detail: `got ${a.rent?.numTenants}` },
      ];
    },
  },
  {
    id: "near_empty",
    category: "hallucination",
    async build() {
      return { documents: [makePdf(["LEASE", ""])], sourceText: "LEASE", address: null };
    },
    check(a) {
      const reds = (a.flags || []).filter((f) => f.severity === "red").length;
      return [
        { label: "near-empty doc: no fabricated flags", pass: (a.flags || []).length === 0 || reds === 0,
          detail: `flags=${(a.flags || []).length}` },
      ];
    },
  },
];
