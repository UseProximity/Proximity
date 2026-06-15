/**
 * ci-impact.mjs — CI wrapper around the impact analyzer + test runner.
 *
 * Runs the same analyzeImpact() / runImpactTests() the `proximity` MCP exposes,
 * but headless: it analyzes the diff between a base ref and HEAD, then exercises
 * every affected surface against a running deployment (staging) — once per
 * configured test role (landlord, student) so guarded reads are verified for a
 * real user, not just "rejects anonymous". Mutations stay OFF.
 *
 * Reads config from the environment (set by the GitHub Action from repo
 * secrets/variables):
 *   STAGING_URL              — base URL to test against (required)
 *   IMPACT_BASE              — git ref to diff from (default: origin/main)
 *   IMPACT_HEAD              — git ref to diff to   (default: HEAD)
 *   OUT_DIR                  — where to write reports (default: ci-out)
 *   TEST_<ROLE>_EMAIL / _PASSWORD / _ROLE  — credentials per role (optional)
 *
 * Writes into OUT_DIR:
 *   impact.md           — the affected-surface report
 *   tests-<role>.md     — one test report per role that logged in
 *   data.json           — structured bundle consumed by ci-narrate.mjs
 *   status.json         — { fail, warn } counts for the workflow's gate
 *
 * Always exits 0 (so narration + commenting still run); the workflow decides
 * whether to fail the check from status.json.
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { analyzeImpact, formatImpactReport } from "../src/impact.mjs";
import { runImpactTests, formatTestReport } from "../src/runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", ".."); // repo root

const baseUrl = process.env.STAGING_URL;
const base = process.env.IMPACT_BASE || "origin/main";
const head = process.env.IMPACT_HEAD || "HEAD";
const outDir = join(ROOT, process.env.OUT_DIR || "ci-out");
const envFile = join(ROOT, ".env.test.local");

// The runner reads credentials from .env.test.local (one role at a time), so we
// write that file before each pass and remove it after. Add a role here and the
// workflow only needs the matching TEST_<ROLE>_* secrets/variables.
const ROLES = ["LANDLORD", "STUDENT"]
  .map((key) => ({
    key,
    email: process.env[`TEST_${key}_EMAIL`],
    password: process.env[`TEST_${key}_PASSWORD`],
    role: process.env[`TEST_${key}_ROLE`] || key.toLowerCase(),
  }))
  .filter((r) => r.email && r.password);

function writeTestEnv({ email, password, role }) {
  writeFileSync(envFile, `TEST_EMAIL=${email}\nTEST_PASSWORD=${password}\nTEST_ROLE=${role}\n`);
}

async function main() {
  if (!baseUrl) {
    console.error("ci-impact: STAGING_URL is not set — nothing to test against.");
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });

  // 1) Affected-surface analysis (no network).
  const impact = analyzeImpact({ base, head });
  const impactMd = formatImpactReport(impact);
  writeFileSync(join(outDir, "impact.md"), impactMd);

  // 2) Exercise the surfaces against staging, once per role.
  const runs = [];
  let fail = 0;
  let warn = 0;

  if (impact.error) {
    console.error(`ci-impact: ${impact.error}`);
  } else if (ROLES.length === 0) {
    // Still run unauthenticated-only so we at least probe reachability + guards.
    const out = await runImpactTests({ base, head, baseUrl, allowMutations: false });
    const md = formatTestReport(out);
    writeFileSync(join(outDir, "tests-anon.md"), md);
    runs.push({ role: "anonymous", summary: out.summary, auth: out.auth, md });
    fail += out.summary?.fail || 0;
    warn += out.summary?.warn || 0;
  } else {
    for (const r of ROLES) {
      writeTestEnv(r);
      const out = await runImpactTests({ base, head, baseUrl, allowMutations: false });
      const md = formatTestReport(out);
      writeFileSync(join(outDir, `tests-${r.role}.md`), md);
      runs.push({ role: r.role, summary: out.summary, auth: out.auth, md });
      fail += out.summary?.fail || 0;
      warn += out.summary?.warn || 0;
    }
    if (existsSync(envFile)) rmSync(envFile);
  }

  // 3) Bundle for the narrator + a small status for the gate.
  writeFileSync(
    join(outDir, "data.json"),
    JSON.stringify(
      {
        base,
        head,
        baseUrl,
        changedFiles: impact.changedFiles || null,
        impactError: impact.error || null,
        impactMd,
        runs,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(outDir, "status.json"), JSON.stringify({ fail, warn }));

  console.log(`ci-impact: ${runs.length} run(s); ${fail} fail, ${warn} warn. Reports in ${outDir}`);
}

main()
  .then(() => {
    // All work is done; exit explicitly so any lingering keep-alive sockets
    // from fetch() can't hold the event loop open and hang the CI step.
    process.exit(0);
  })
  .catch((err) => {
  console.error("ci-impact crashed:", err);
  // Don't block the comment — record the crash so the narrator can mention it.
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "status.json"), JSON.stringify({ fail: 1, warn: 0, crashed: String(err) }));
  } catch {}
  process.exit(0);
});
