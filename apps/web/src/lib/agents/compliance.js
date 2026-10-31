/*
 * Fair-housing screening of what landlords add to a listing's knowledge
 * (PRD v3: "Corrections are screened for fair-housing terms; flagged ones go
 * to admin"). The full policy is settled at launch; until then this catches
 * the plain cases: a stated preference or exclusion by a protected class,
 * and refusing housing vouchers (St. Louis City source-of-income
 * protection).
 *
 * Deterministic on purpose: a flag sends the change to an admin, it never
 * decides anything on its own.
 */

const PROTECTED = [
  // federal FHA classes, Missouri, St. Louis City
  "race", "color", "religion", "christian", "muslim", "jewish", "catholic", "hindu", "national origin", "immigrant", "foreign",
  "sex", "gender", "female only", "male only", "women only", "men only", "no men", "no women", "girls only", "boys only",
  "familial status", "no children", "no kids", "adults only", "no families", "pregnant",
  "disability", "disabled", "handicap", "wheelchair", "mental illness", "service animal", "emotional support",
  "sexual orientation", "gay", "lesbian", "transgender", "gender identity",
  "age", "seniors only", "elderly", "young professionals only", "students only", "no students",
  "marital status", "married couples only", "unmarried", "single mother",
  "section 8", "housing choice voucher", "vouchers", "source of income", "no government assistance", "no welfare",
  "citizenship", "social security number required", "ssn required", "english only",
  "ancestry", "ethnic", "ethnicity", "arab", "asian", "black", "white", "hispanic", "latino", "african",
];

const EXCLUDING = /\b(no|not|without|only|prefer(?:red|s)?|must be|exclusively|unless|except|required|do not accept|don't accept|not accept(?:ed|ing)?|refuse|won't rent|will not rent|ideal for|perfect for|suited to|welcome)\b/i;

/* Returns the matched terms, empty when the text is clean. */
export function fairHousingFlags(text) {
  const t = String(text ?? "").toLowerCase();
  if (!t) return [];
  const hits = [];
  for (const term of PROTECTED) {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const m = t.match(re);
    if (!m) continue;
    // Only when the sentence around it reads as a preference or exclusion;
    // "service animals are welcome" and "wheelchair accessible" are fine.
    const start = Math.max(0, m.index - 80);
    const window = t.slice(start, m.index + term.length + 80);
    if (/wheelchair accessible|ada accessible|accessible unit|service animals? (are|is) (welcome|allowed|accepted)|emotional support animals? (are|is) (welcome|allowed|accepted)/.test(window)) continue;
    if (EXCLUDING.test(window)) hits.push(term);
  }
  return [...new Set(hits)];
}
