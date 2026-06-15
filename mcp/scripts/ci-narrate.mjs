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
  const diff = getDiff(data.base, data.head);

  const testReports =
    data.runs && data.runs.length
      ? data.runs.map((r) => `### Test run as role \`${r.role}\`\n\n${r.md}`).join("\n\n")
      : "_No live test runs were recorded._";

  const system = [
    "You are a senior engineer reviewing a release pull request from `staging` into `main` for Proximity,",
    "an off-campus housing marketplace (Next.js 15 App Router, Supabase, NextAuth). This PR is what ships to",
    "production. Your job is to help the author confirm nothing will break in prod.",
    "",
    "You are given: (1) a deterministic impact report listing every API endpoint and page downstream of the",
    "changed files, (2) the results of live tests run against the staging deployment (public routes must not",
    "crash; guarded routes must reject anonymous access and work for a logged-in user; mutations were NOT run),",
    "and (3) the diff. Ground every claim in those inputs — do not invent endpoints or behavior not present.",
    "",
    "Write GitHub-flavored markdown with exactly these sections:",
    "## What this PR changes — a tight, product-level summary (what a PM would understand), then key technical changes.",
    "## Production risk assessment — what could break in prod, ranked. Call out auth/permission changes, DB schema or",
    "query changes, outreach/email, and anything touching money or PII. Note where the live tests already give",
    "confidence and where they do NOT (e.g. mutations weren't exercised).",
    "## Test plan before merge — a concrete, numbered manual checklist tied to the affected surfaces. Be specific",
    "(which page/endpoint, which role, what to look for). Flag steps that need a human because automation skipped them.",
    "## Verdict — one of ✅ Looks safe / ⚠️ Merge with caution / ⛔ Do not merge, plus one sentence why.",
    "Be concise and skimmable. If the impact report shows no changes or errored, say so plainly.",
  ].join("\n");

  const userContent = [
    `# Impact report\n\n${data.impactMd}`,
    `# Live test results (staging: ${data.baseUrl})\n\n${testReports}`,
    `# Diff (\`${data.base}\`...\`${data.head}\`)\n\n\`\`\`diff\n${diff}\n\`\`\``,
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
