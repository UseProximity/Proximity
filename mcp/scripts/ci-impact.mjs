/**
 * ci-impact.mjs — CI wrapper around the impact analyzer + test runner.
 *
 * Runs the same analyzeImpact() / runImpactTests() the `proximity` MCP exposes,
 * but headless and STATEFUL: it remembers what it already tested (via the bug
 * ledger persisted in the PR comment) so each push only re-tests the surfaces
 * that changed since the last reviewed commit.
 *
 *   - The cumulative `origin/main…HEAD` impact report is always shown (the full
 *     release picture for the reviewer).
 *   - Tests run against only the surfaces changed since `lastTestedSha` (the
 *     commit reviewed on the previous run). On the first run that's the whole
 *     release.
 *   - Results are folded into the prior ledger (see ledger.mjs): failures become
 *     tracked bugs; a previously-broken surface that now passes is marked fixed;
 *     open bugs not re-tested this run are carried forward and keep blocking.
 *
 * Reads config from the environment (set by the GitHub Action):
 *   STAGING_URL              — base URL to test against (required)
 *   IMPACT_BASE              — release base ref for the cumulative report (default: origin/main)
 *   IMPACT_HEAD              — head ref (default: HEAD)
 *   PREV_STATE_FILE          — path to the prior state JSON pulled from the last comment (optional)
 *   OUT_DIR                  — where to write reports (default: ci-out)
 *   TEST_<ROLE>_EMAIL / _PASSWORD / _ROLE  — credentials per role (optional)
 *
 * Writes into OUT_DIR:
 *   impact.md           — cumulative affected-surface report (full release)
 *   ledger.md           — bug ledger for this run (fixed / open / new)
 *   tests-<role>.md     — one test report per role that logged in (incremental scope)
 *   data.json           — structured bundle consumed by ci-narrate.mjs
 *   status.json         — { fail, warn } counts for the workflow's gate
 *   state-block.txt     — the hidden state block to embed in the new PR comment
 *
 * Always exits 0 (so narration + commenting still run); the workflow decides
 * whether to fail the check from status.json.
 */

import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { analyzeImpact, formatImpactReport } from "../src/impact.mjs";
import { runImpactTests, formatTestReport } from "../src/runner.mjs";
import {
  reconcile,
  flattenRunResults,
  formatLedger,
  serializeStateBlock,
} from "../src/ledger.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", ".."); // repo root

const baseUrl = process.env.STAGING_URL;
const releaseBase = process.env.IMPACT_BASE || "origin/main";
const head = process.env.IMPACT_HEAD || "HEAD";
const outDir = join(ROOT, process.env.OUT_DIR || "ci-out");
const prevStateFile = process.env.PREV_STATE_FILE || join(outDir, "prev-state.json");
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

function git(args) {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf-8" }).trim();
}

// Does this SHA exist in the current checkout? (A force-push/rebase can orphan
// the commit we last tested — fall back to a full run if so.)
function commitExists(sha) {
  if (!sha) return false;
  try {
    git(`cat-file -e ${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function loadPrevState() {
  try {
    const raw = readFileSync(prevStateFile, "utf-8").trim();
    if (!raw || raw === "null") return null;
    const state = JSON.parse(raw);
    return state && typeof state === "object" ? state : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!baseUrl) {
    console.error("ci-impact: STAGING_URL is not set — nothing to test against.");
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });

  const prevState = loadPrevState();
  const runNumber = (prevState?.runNumber || 0) + 1;
  const headSha = git(`rev-parse ${head}`);
  const headShort = headSha.slice(0, 7);

  // Decide the test scope. Incremental = diff since the commit we last reviewed,
  // as long as that commit is still reachable and there are new commits since.
  const lastTestedSha = prevState?.lastTestedSha;
  const lastShort = lastTestedSha ? lastTestedSha.slice(0, 7) : null;
  let testBase = releaseBase;
  let incremental = false;
  if (commitExists(lastTestedSha)) {
    if (lastTestedSha === headSha) {
      // Re-run with no new commits — test nothing new, just carry the ledger.
      testBase = headSha;
    } else {
      testBase = lastTestedSha;
    }
    incremental = true;
  }

  // 1) Cumulative affected-surface report (always the full release picture).
  const cumulative = analyzeImpact({ base: releaseBase, head });
  const impactMd = formatImpactReport(cumulative);
  writeFileSync(join(outDir, "impact.md"), impactMd);

  // 2) Exercise only the surfaces changed since the last reviewed commit, per role.
  const runs = [];
  const allResults = []; // role-tagged, flattened — fed to the ledger.

  if (cumulative.error) {
    console.error(`ci-impact: ${cumulative.error}`);
  } else {
    const rolesToRun = ROLES.length ? ROLES : [{ role: "anonymous" }];
    for (const r of rolesToRun) {
      if (r.email) writeTestEnv(r);
      const out = await runImpactTests({ base: testBase, head, baseUrl, allowMutations: false });
      const md = formatTestReport(out);
      writeFileSync(join(outDir, `tests-${r.role}.md`), md);
      runs.push({ role: r.role, summary: out.summary, auth: out.auth, md });
      allResults.push(...flattenRunResults(r.role, out));
    }
    if (existsSync(envFile)) rmSync(envFile);
  }

  // 3) Fold this run's results into the prior ledger.
  const { state, summary } = reconcile(prevState, allResults, {
    runNumber,
    headSha,
    headShort,
    incremental,
  });
  const ledgerMd = formatLedger(summary, { headShort, lastShort });
  writeFileSync(join(outDir, "ledger.md"), ledgerMd);
  writeFileSync(join(outDir, "state-block.txt"), serializeStateBlock(state));

  // 4) Gate: a release is red while ANY bug is open (whether or not it was
  //    re-tested this run). Warnings don't block.
  const fail = summary.openCount;
  const warn = summary.warned;

  // 5) Bundle for the narrator + a small status for the gate.
  writeFileSync(
    join(outDir, "data.json"),
    JSON.stringify(
      {
        runNumber,
        incremental,
        releaseBase,
        testBase: incremental ? testBase : releaseBase,
        head,
        headShort,
        lastShort,
        baseUrl,
        changedFiles: cumulative.changedFiles || null,
        impactError: cumulative.error || null,
        impactMd,
        ledgerMd,
        ledger: summary,
        runs,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(outDir, "status.json"), JSON.stringify({ fail, warn }));

  console.log(
    `ci-impact: run ${runNumber} (${incremental ? `incremental since ${lastShort}` : "full"}); ` +
      `${summary.tested} probes, ${summary.newBugs.length} new, ${summary.fixed.length} fixed, ${fail} open. Reports in ${outDir}`,
  );
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
