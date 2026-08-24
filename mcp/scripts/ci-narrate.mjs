/**
 * ci-narrate.mjs — turns the impact bundle + the diff into a release reviewer's
 * write-up, using Claude (claude-opus-4-8).
 *
 * Reads OUT_DIR/data.json (from ci-impact.mjs) and the base→head diff, then asks
 * Claude for: a plain-English summary of what's shipping, a production-risk
 * assessment grounded in the affected-surface list + live test results, and a
 * concrete manual test plan. Output is markdown, written to OUT_DIR/narrative.md
 * and echoed to stdout.
 *
 * Zero-dependency on purpose (matches the rest of mcp/): talks to the Messages
 * API over fetch. Requires ANTHROPIC_API_KEY in the environment.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const outDir = join(ROOT, process.env.OUT_DIR || "ci-out");

const MODEL = "claude-opus-4-8";
const MAX_DIFF_CHARS = 60000; // keep the prompt well within limits

function getDiff(base, head) {
  try {
    const out = execSync(`git diff ${base}...${head}`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
    if (out.length > MAX_DIFF_CHARS) {
      return out.slice(0, MAX_DIFF_CHARS) + `\n\n…[diff truncated at ${MAX_DIFF_CHARS} chars]`;
    }
    return out;
  } catch (err) {
    return `(could not compute diff: ${err.message})`;
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ci-narrate: ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(join(outDir, "data.json"), "utf-8"));

  // Seeded test data and the intent behind the change. Both are optional so an
  // older checkout, or a seed step that failed, still produces a review.
  const readOptional = (name) => {
    try {
      return readFileSync(join(outDir, name), "utf-8").trim();
    } catch {
      return "";
    }
  };
  const fixturesRaw = readOptional("fixtures.json");
  const commitsMd = readOptional("commits.md");
  let fixtures = null;
  try {
    fixtures = fixturesRaw ? JSON.parse(fixturesRaw) : null;
  } catch {
    fixtures = null;
  }
  // Narrate the diff that was actually tested this run: incremental runs review
  // only what changed since the last reviewed commit; the first run is the whole release.
  const diffBase = data.incremental ? data.testBase : data.releaseBase;
  const diff = getDiff(diffBase, data.head);

  const testReports =
    data.runs && data.runs.length
      ? data.runs.map((r) => `### Test run as role \`${r.role}\`\n\n${r.md}`).join("\n\n")
      : "_No live test runs were recorded._";

  const runNumber = data.runNumber || 1;
  const incremental = !!data.incremental && runNumber > 1;
  const runContext = incremental
    ? `This is **run #${runNumber}** of an ongoing release review. Only the surfaces changed since the last ` +
      `reviewed commit (\`${data.lastShort}\`) were re-tested this run — earlier-verified surfaces are unchanged. ` +
      `Focus your write-up on what changed since then and on the bug ledger; do not re-litigate the whole release.`
    : `This is the **first review** of this release — the full set of affected surfaces was tested.`;

  const system = [
    "You are a senior engineer reviewing a release pull request from `staging` into `main` for Proximity,",
    "an off-campus housing marketplace (Next.js 15 App Router, Supabase, NextAuth). This PR is what ships to",
    "production. Your job is to help the author confirm nothing will break in prod.",
    "",
    "The release check is INCREMENTAL and keeps a persistent bug ledger across pushes: each run only re-tests the",
    "surfaces changed since the last reviewed commit, and tracks every problem it finds as new / still-open / fixed /",
    "regressed. " + runContext,
    "",
    "You are given: (1) a cumulative impact report listing every API endpoint and page downstream of the release's",
    "changed files, (2) the bug ledger for this run, (3) the results of live tests run this run against the staging",
    "deployment (public routes must not crash; guarded routes must reject anonymous access and work for a logged-in",
    "user; mutations were NOT run), (4) the diff tested this run, (5) the commit messages under review, and",
    "(6) a catalogue of TEST FIXTURES seeded fresh into the dev database for this run. Ground every claim in those",
    "inputs — do not invent endpoints or behavior not present.",
    "",
    "The commit messages tell you INTENT — what the author was trying to change and why. Use them to state what the",
    "new behavior should be, which a diff alone cannot tell you. Where you infer expected behavior rather than",
    "observing it in a test result, mark it `(inferred)` so the reader knows which claims are checked and which",
    "are your reading of the change.",
    "",
    "The fixtures are synthetic accounts and listings created for this review — they contain no real user data, and",
    "they all share the password given in the catalogue. Use them: name the exact account, its role, and what it is",
    "positioned to demonstrate. Never cite a real user, a real listing, or any id not present in the catalogue.",
    "",
    "Write GitHub-flavored markdown with exactly these sections:",
    "## What changed this run — for run 1, a product-level summary of the whole release; for later runs, what these",
    "new commits changed and why (e.g. 'fixes the bug flagged last run').",
    "## Bug status — report each tracked bug from the ledger as ✅ fixed, ❌ still open, 🔁 regressed, or ⏸️ open but not",
    "re-tested this run. Be explicit and tie each to its surface. If the ledger is empty, say so.",
    "## Production risk assessment — what could break in prod, ranked, limited to what this run touched. Call out",
    "auth/permission, DB schema/query, outreach/email, and anything touching money or PII. Note where live tests give",
    "confidence and where they do NOT (e.g. mutations weren't exercised).",
    "## Test plan before merge — a numbered manual checklist covering EVERY behavioral change in this run. One step",
    "per change; do not merge unrelated changes into a single step. Each step MUST have all five of these, as a short",
    "labelled block — a step missing any of them is not usable:",
    "  **Sign in as** — the exact fixture email and the password from the catalogue, plus what that account is",
    "    (e.g. `ci-fixture-sublet@proximity.test` / `testing-password-2026` — a landlord who holds an offering on",
    "    Apt 101 but does NOT own the property).",
    "  **Go to** — a full clickable URL against the staging base URL, using real ids from the fixture catalogue.",
    "  **Do** — the precise interaction (which control, which field, what value).",
    "  **Expect** — the observable result, in specifics: exact counts, labels, prices, or status codes. Not 'it works'.",
    "  **Broken if** — what the reader would see if the change regressed, so a failure is recognizable.",
    "Order the steps so the riskiest and least-automatable come first. Mark any step whose expectation you inferred",
    "from the diff or commit messages rather than from a test result with `(inferred)`. Where a change has no fixture",
    "that can exercise it, say so plainly instead of inventing data.",
    "Cover the negative cases too: a role that must be REFUSED is as important as one that must succeed.",
    "## Verdict — one of ✅ Looks safe / ⚠️ Merge with caution / ⛔ Do not merge, plus one sentence why. If any bug is",
    "still open, the verdict cannot be ✅.",
    "Be concise and skimmable. If the impact report shows no changes or errored, say so plainly.",
  ].join("\n");

  const fixtureBlock = fixtures
    ? `# Test fixtures seeded for this run\n\nStaging base URL: ${data.baseUrl}\n` +
      `Every account below uses the password \`${fixtures.password}\`. These are synthetic —\n` +
      `no real user data. Build your URLs from these ids.\n\n` +
      "```json\n" +
      JSON.stringify(fixtures, null, 2) +
      "\n```"
    : "# Test fixtures\n\nNone were seeded this run — write the plan without citing specific accounts or ids, and say so.";

  const userContent = [
    `# Run ${runNumber}${incremental ? ` (incremental since \`${data.lastShort}\`)` : " (first review)"}`,
    `# Bug ledger\n\n${data.ledgerMd}`,
    fixtureBlock,
    commitsMd
      ? `# Commit messages under review (intent behind the diff)\n\n${commitsMd}`
      : "# Commit messages\n\nUnavailable this run.",
    `# Cumulative impact report (full release)\n\n${data.impactMd}`,
    `# Live test results this run (staging: ${data.baseUrl})\n\n${testReports}`,
    `# Diff tested this run (\`${diffBase}\`...\`${data.head}\`)\n\n\`\`\`diff\n${diff}\n\`\`\``,
  ].join("\n\n---\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`ci-narrate: Anthropic API ${res.status}: ${body}`);
    const fallback = `## Release review unavailable\n\nClaude narration failed (HTTP ${res.status}). The impact report and live test results below are still valid.`;
    writeFileSync(join(outDir, "narrative.md"), fallback);
    console.log(fallback);
    return;
  }

  const json = await res.json();
  if (json.stop_reason === "refusal") {
    const fallback = "## Release review unavailable\n\nThe model declined to produce a write-up for this diff. See the impact report and test results below.";
    writeFileSync(join(outDir, "narrative.md"), fallback);
    console.log(fallback);
    return;
  }

  const text = (json.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const narrative = text || "_(no narrative produced)_";
  writeFileSync(join(outDir, "narrative.md"), narrative);
  console.log(narrative);
}

main().catch((err) => {
  console.error("ci-narrate crashed:", err);
  process.exit(1);
});
