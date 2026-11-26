#!/usr/bin/env node
/*
 * Deterministic guardrail validator for SEO content drafts. No LLM involved.
 * Run after any edit to apps/web/src/content/washu/*.json (the /seo-draft
 * workflow MUST run it before showing Ben a review sheet; humans should too).
 *
 *   node scripts/seo-engine/validate.mjs [--base <git-ref>]
 *
 * Compares the working tree against --base (default: origin/staging) and
 * hard-fails (exit 1) on any violation:
 *   1. Edits outside the allowlisted paths (content JSONs, content drafts,
 *      review sheets, and dateModified-only changes to lib/washuPages.js)
 *   2. Any em dash in changed copy
 *   3. Dollar figures / percentages not in benchmark-allowlist.json and not
 *      present in the base version of the same file (no invented numbers,
 *      which also structurally forbids cross-landlord averages)
 *   4. Fair-housing deny-list phrasing (flagged for human triage)
 *   5. First-person / byline phrasing (neutral brand voice only)
 *   6. Roommate-matching language (Proximity does not match roommates)
 *   7. JSON validity + content schema (intro[], directAnswer 25-75 words,
 *      faqs[{q,a}], benchmarkNote)
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const baseIdx = process.argv.indexOf("--base");
const BASE = baseIdx > -1 ? process.argv[baseIdx + 1] : "origin/staging";

const CONTENT_RE = /^apps\/web\/src\/content\/washu\/[^/]+\.json$/;
const ALLOWED_RE = [
  CONTENT_RE,
  /^docs\/content-drafts\/[^/]+\.md$/,
  /^scripts\/seo-engine\/reports\/[^/]+\.md$/,
];
const REGISTRY = "apps/web/src/lib/washuPages.js";

const FAIR_HOUSING_DENY = [
  /\bsafe for (families|women|children|kids)\b/i,
  /\b(white|black|asian|hispanic|jewish|christian|muslim)\s+(neighborhood|area|families|students)\b/i,
  /\bno (kids|children|families)\b/i,
  /\bideal for (families|singles|christians|couples)\b/i,
  /\bavoid.{0,30}\b(immigrants|minorities)\b/i,
];
const VOICE_DENY = [
  { re: /\bBen Flicker\b/, why: "no byline on programmatic pages" },
  { re: /(^|[.!?]\s+)I\s/m, why: "no first person" },
  { re: /\broommate match/i, why: "Proximity does not match roommates" },
  { re: /\broommate finder\b/i, why: "Proximity does not match roommates" },
  { re: /\bfind (you )?a roommate\b/i, why: "Proximity does not match roommates" },
];

const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" });
const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

// 1. Path allowlist -----------------------------------------------------------
const changed = sh(`git diff --name-only ${BASE}`)
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

for (const file of changed) {
  if (ALLOWED_RE.some((re) => re.test(file))) continue;
  if (file === REGISTRY) {
    // Registry edits may ONLY touch dateModified values.
    const diff = sh(`git diff ${BASE} -- ${REGISTRY}`)
      .split("\n")
      .filter((l) => /^[+-][^+-]/.test(l));
    const offending = diff.filter((l) => !l.includes("dateModified"));
    if (offending.length) {
      fail(REGISTRY, `only dateModified changes are allowed; found: ${offending[0].trim()}`);
    }
    continue;
  }
  fail(file, "outside the content-draft path allowlist");
}

// 2-7. Content checks on changed JSON files -----------------------------------
const allowlist = JSON.parse(
  readFileSync(join(ROOT, "scripts/seo-engine/benchmark-allowlist.json"), "utf8")
);
const allowedFigures = new Set(
  Object.entries(allowlist)
    .filter(([k]) => !k.startsWith("_"))
    .flatMap(([, v]) => v)
);

const baseFileText = (file) => {
  try {
    return sh(`git show ${BASE}:${file}`);
  } catch {
    return "";
  }
};

const countWords = (s) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;

for (const file of changed.filter((f) => CONTENT_RE.test(f))) {
  let raw;
  try {
    raw = readFileSync(join(ROOT, file), "utf8");
  } catch {
    continue; // deleted file: allowlist already vetted the path
  }

  if (raw.includes("—")) fail(file, "contains an em dash");

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    fail(file, `invalid JSON: ${e.message}`);
    continue;
  }

  // Schema
  if (!Array.isArray(doc.intro) || !doc.intro.every((p) => typeof p === "string"))
    fail(file, "intro must be an array of strings");
  const daWords = countWords(doc.directAnswer);
  if (typeof doc.directAnswer !== "string" || daWords < 25 || daWords > 75)
    fail(file, `directAnswer must be 25-75 words (got ${daWords})`);
  if (
    !Array.isArray(doc.faqs) ||
    !doc.faqs.every((f) => typeof f?.q === "string" && typeof f?.a === "string")
  )
    fail(file, "faqs must be [{q, a}] strings");
  if (typeof doc.benchmarkNote !== "string" || !doc.benchmarkNote.length)
    fail(file, "benchmarkNote is required");

  // Numeric grounding: every $ figure / percentage must be allowlisted or
  // carried over from the base version of this same file.
  const base = baseFileText(file);
  const figures = raw.match(/\$[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?%/g) ?? [];
  for (const fig of new Set(figures)) {
    if (allowedFigures.has(fig)) continue;
    if (base.includes(fig)) continue;
    fail(
      file,
      `figure ${fig} is not in benchmark-allowlist.json and not in the ${BASE} version; cite-or-carry-over only`
    );
  }

  // Deny lists
  const text = JSON.stringify(doc);
  for (const re of FAIR_HOUSING_DENY) {
    const m = text.match(re);
    if (m) fail(file, `fair-housing screen matched "${m[0]}" (human triage required)`);
  }
  for (const { re, why } of VOICE_DENY) {
    const m = text.match(re);
    if (m) fail(file, `voice rule violation "${m[0].trim()}" (${why})`);
  }
}

// Verdict ---------------------------------------------------------------------
if (errors.length) {
  console.error(`VALIDATION FAILED (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `Validation passed: ${changed.length} changed file(s) vs ${BASE}, all guardrails clear.`
);
