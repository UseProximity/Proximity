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
    "user; mutations were NOT run), and (4) the diff tested this run. Ground every claim in those inputs — do not",
    "invent endpoints or behavior not present.",
    "",
    "Write GitHub-flavored markdown with exactly these sections:",
    "## What changed this run — for run 1, a product-level summary of the whole release; for later runs, what these",
    "new commits changed and why (e.g. 'fixes the bug flagged last run').",
    "## Bug status — report each tracked bug from the ledger as ✅ fixed, ❌ still open, 🔁 regressed, or ⏸️ open but not",
    "re-tested this run. Be explicit and tie each to its surface. If the ledger is empty, say so.",
    "## Production risk assessment — what could break in prod, ranked, limited to what this run touched. Call out",
    "auth/permission, DB schema/query, outreach/email, and anything touching money or PII. Note where live tests give",
    "confidence and where they do NOT (e.g. mutations weren't exercised).",
    "## Test plan before merge — a concrete, numbered manual checklist tied to the surfaces changed/affected this run.",
    "Be specific (which page/endpoint, which role, what to look for). Flag steps that need a human because automation skipped them.",
    "## Verdict — one of ✅ Looks safe / ⚠️ Merge with caution / ⛔ Do not merge, plus one sentence why. If any bug is",
    "still open, the verdict cannot be ✅.",
    "Be concise and skimmable. If the impact report shows no changes or errored, say so plainly.",
  ].join("\n");

  const userContent = [
    `# Run ${runNumber}${incremental ? ` (incremental since \`${data.lastShort}\`)` : " (first review)"}`,
    `# Bug ledger\n\n${data.ledgerMd}`,
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
