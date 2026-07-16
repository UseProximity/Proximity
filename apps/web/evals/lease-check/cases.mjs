/*
 * Edge-case suite for Lease Check. Each case builds a synthetic document (or set of
 * documents) with KNOWN ground truth and returns case-specific assertions. The runner
 * additionally applies universal assertions (see run.mjs): no em dashes in stored
 * text, no address leak into summary/flags, no PII in quotes, and (for text PDFs)
 * every quote must actually appear in the source (hallucination guard).
 *
 * Scope note: the cheaper-comps feature was removed, so this suite no longer extracts
 * or asserts a rent number. It covers flag quality, privacy, hallucination resistance,
 * and image robustness. Assertion shape: { label, pass, detail?, soft? }. A `soft`
 * assertion that fails is a WARN, not a hard failure — used where the correct behavior
 * is a range (e.g. a blurry image may be read OR marked unreadable).
 */
import { makePdf, makeLeaseImage } from "./generators.mjs";

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
const flagText = (a) =>
  (a.flags || []).map((f) => `${f.title} ${f.explanation} ${f.question}`).join(" ␟ ").toLowerCase();
const mentions = (a, ...words) => {
  const t = flagText(a);
  return words.some((w) => t.includes(w.toLowerCase()));
};
const readIt = (a) => !!a.summary && (a.flags || []).length > 0;

export const CASES = [
  {
    id: "flags_core",
    category: "flags",
    async build() {
      const lines = [...HEADER, "", ...RISKY, ...SIGNATURES];
      return { documents: [makePdf(lines)], sourceText: lines.join("\n"), address: ADDRESS };
    },
    check(a) {
      return [
        { label: "flags joint-and-several liability", pass: mentions(a, "jointly", "roommate", "each other", "full rent", "everyone") },
        { label: "flags subletting ban", pass: mentions(a, "sublet", "subletting") },
        { label: "flags automatic renewal / notice deadline", pass: mentions(a, "renew", "auto-renew", "automatically", "90 day", "ninety", "notice") },
      ];
    },
  },
  {
    id: "pii_redaction",
    category: "privacy",
    async build() {
      const lines = [...HEADER, "",
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
    id: "green_terms",
    category: "severity",
    async build() {
      const lines = [
        "RESIDENTIAL LEASE AGREEMENT", "",
        "Premises: 6633 Clemens Ave, St. Louis, MO 63130 (studio, one tenant)",
        "Term: twelve (12) months, August 1 2026 to July 31 2027.", "",
        "3. RENT. Landlord pays all utilities.", "",
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
  {
    id: "image_clean",
    category: "image",
    async build() {
      const lines = [...HEADER, "", ...RISKY, ...SIGNATURES];
      return { documents: [await makeLeaseImage(lines, { jpegQ: 80 })], sourceText: null, address: ADDRESS };
    },
    check(a) {
      return [
        { label: "reads a clean photo (summary + at least one flag)", pass: readIt(a) },
        { label: "flags joint-and-several from image", pass: mentions(a, "jointly", "roommate", "full rent", "everyone"), soft: true },
      ];
    },
  },
  {
    id: "image_blurry",
    category: "image",
    async build() {
      const lines = [...HEADER, "", ...RISKY, ...SIGNATURES];
      return { documents: [await makeLeaseImage(lines, { blur: 2.6, jpegQ: 30 })], sourceText: null, address: ADDRESS };
    },
    check(a) {
      return [
        { label: "blurry photo: either reads it OR reports unreadable (never crashes/empties)",
          pass: readIt(a) || (a.unreadablePages || []).length > 0 || !!a.summary,
          detail: `flags=${(a.flags || []).length}, unreadable=${JSON.stringify(a.unreadablePages)}` },
      ];
    },
  },
  {
    id: "image_low_res",
    category: "image",
    async build() {
      const lines = [...HEADER, "", ...RISKY, ...SIGNATURES];
      return { documents: [await makeLeaseImage(lines, { shrink: 0.28, jpegQ: 40 })], sourceText: null, address: ADDRESS };
    },
    check(a) {
      return [
        { label: "low-res photo: reads it OR reports unreadable (never crashes/empties)",
          pass: readIt(a) || (a.unreadablePages || []).length > 0 || !!a.summary,
          detail: `flags=${(a.flags || []).length}, unreadable=${JSON.stringify(a.unreadablePages)}` },
      ];
    },
  },
  {
    id: "image_cut_off",
    category: "image",
    async build() {
      const lines = [...HEADER, "", ...RISKY, ...SIGNATURES];
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
      const page1 = [...HEADER, "", ...RISKY];
      const page2 = ["(continued)", ...SIGNATURES];
      return {
        documents: [await makeLeaseImage(page1, { jpegQ: 75 }), await makeLeaseImage(page2, { jpegQ: 75 })],
        sourceText: null, address: ADDRESS,
      };
    },
    check(a) {
      return [
        { label: "combines 2 photos into one analysis (summary + flags)", pass: readIt(a) },
        { label: "flags a risk from page 1 (liability/sublet/renewal)",
          pass: mentions(a, "jointly", "sublet", "renew", "roommate"), soft: true },
      ];
    },
  },
];
