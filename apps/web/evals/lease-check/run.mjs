/*
 * Lease Check eval runner.
 *
 * For every case in cases.mjs: build the synthetic document(s), send them through the
 * SAME claude-sonnet-5 structured-output call the app makes (src/lib/leaseCheck/
 * analyzeLease.js), apply the case's own assertions plus the universal ones, and print
 * a report. Full analyses are written to ./results/<timestamp>/ for inspection.
 *
 * Requires LEASE_SCANNER_KEY in the environment. Usage:
 *   cd apps/web && set -a && source .env.local && set +a && node scripts/lease-check-eval/run.mjs
 * Optional: node scripts/lease-check-eval/run.mjs rent_per_person image_blurry   (subset by id)
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CASES } from "./cases.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../..");
const require = createRequire(WEB + "/package.json");
const Anthropic = require("@anthropic-ai/sdk");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const { z } = require("zod");
const { LEASE_SYSTEM, LEASE_USER_PROMPT } = await import("file://" + WEB + "/src/lib/leaseCheck/prompt.js");

if (!process.env.LEASE_SCANNER_KEY) {
  console.error("LEASE_SCANNER_KEY not set. Run: set -a && source .env.local && set +a");
  process.exit(2);
}
const client = new Anthropic({ apiKey: process.env.LEASE_SCANNER_KEY });
const CONCURRENCY = 4; // keep under Anthropic rate limits

// ---- schema + em-dash strip: kept in lockstep with analyzeLease.js ----
const FlagSchema = z.object({
  severity: z.enum(["red", "yellow", "green"]),
  title: z.string(),
  explanation: z.string(),
  quote: z.string().nullable(),
  question: z.string(),
});
const LeaseAnalysisSchema = z.object({
  summary: z.string(), flags: z.array(FlagSchema), address: z.string().nullable(),
  landlordName: z.string().nullable(), unreadablePages: z.array(z.number()), overallConfidence: z.number(),
});
function stripEmDashes(v) {
  if (typeof v === "string") return v.replace(/\s*—\s*/g, ", ").replace(/—/g, "-");
  if (Array.isArray(v)) return v.map(stripEmDashes);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripEmDashes(x)]));
  return v;
}

async function analyze(documents) {
  const blocks = documents.map((d) =>
    d.kind === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: d.base64 } }
      : { type: "image", source: { type: "base64", media_type: d.mediaType, data: d.base64 } }
  );
  const response = await client.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 16000,
    output_config: { format: zodOutputFormat(LeaseAnalysisSchema) },
    messages: [{ role: "user", content: [...blocks, { type: "text", text: LEASE_USER_PROMPT }] }],
    system: [{ type: "text", text: LEASE_SYSTEM, cache_control: { type: "ephemeral" } }],
  });
  return { raw: response.parsed_output, analysis: response.parsed_output ? stripEmDashes(response.parsed_output) : null };
}

// ---- universal assertions ----
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const storedText = (a) =>
  [a.summary, ...(a.flags || []).flatMap((f) => [f.title, f.explanation, f.question, f.quote])].filter(Boolean).join(" ");

function quoteAppears(quote, source) {
  const ns = norm(source);
  const frags = quote.split(/\[address\]/i).map(norm).filter((f) => f.length > 8);
  return frags.length === 0 ? true : frags.every((f) => ns.includes(f));
}

function universalChecks(a, ctx) {
  const out = [];
  // 1. no em dash survives into stored text
  const hasEmDash = [a.summary, ...(a.flags || []).flatMap((f) => [f.title, f.explanation, f.question, f.quote])]
    .filter(Boolean).some((s) => s.includes("—"));
  out.push({ label: "no em dash in stored text", pass: !hasEmDash });

  // 2. hallucination guard: every quote appears in the source (text PDFs only)
  if (ctx.sourceText) {
    const bad = (a.flags || []).filter((f) => f.quote && !quoteAppears(f.quote, ctx.sourceText));
    out.push({ label: "every quote is real (appears in source)", pass: bad.length === 0,
      detail: bad.length ? `fabricated/altered: ${bad.map((f) => JSON.stringify(f.quote)).join(" | ")}` : "" });
  }

  // 3. address never leaks into stored fields
  if (ctx.address) {
    const t = storedText(a).toLowerCase();
    const leaks = [ctx.address.toLowerCase(), "clemens"].filter((s) => t.includes(s));
    out.push({ label: "address not stored in summary/flags", pass: leaks.length === 0,
      detail: leaks.length ? `leaked: ${leaks.join(", ")}` : "" });
  }

  // 4. PII never appears in any stored field
  if (ctx.pii) {
    const t = storedText(a);
    const digits = t.replace(/[^0-9]/g, "");
    const found = ctx.pii.filter((p) => t.includes(p) || digits.includes(p.replace(/[^0-9]/g, "")));
    out.push({ label: "no SSN/bank PII in stored text", pass: found.length === 0,
      detail: found.length ? `leaked: ${found.join(", ")}` : "" });
  }
  return out;
}

// ---- run one case ----
async function runCase(c) {
  const built = await c.build();
  const { analysis, raw } = await analyze(built.documents);
  if (!analysis) {
    return { id: c.id, category: c.category, fatal: "parsed_output was null (model output did not conform)", results: [] };
  }
  const ctx = { sourceText: built.sourceText, address: built.address, pii: built.pii };

  const results = [...c.check(analysis, ctx), ...universalChecks(analysis, ctx)];
  return { id: c.id, category: c.category, results, analysis, raw };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); }
      catch (e) { out[idx] = { id: items[idx].id, category: items[idx].category, fatal: String(e?.message || e), results: [] }; }
    }
  }));
  return out;
}

// ---- main ----
const filter = process.argv.slice(2);
const cases = filter.length ? CASES.filter((c) => filter.includes(c.id)) : CASES;
console.log(`Running ${cases.length} case(s) at concurrency ${CONCURRENCY}. Each is a real Sonnet call (~30-90s).\n`);

const started = Date.now();
const outcomes = await pool(cases, CONCURRENCY, runCase);

// results dir (timestamp passed in so the script stays deterministic)
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(HERE, "results", stamp);
fs.mkdirSync(outDir, { recursive: true });

let hardFails = 0, softWarns = 0, passes = 0;
const lines = [];
for (const o of outcomes) {
  if (o.fatal) {
    hardFails++;
    lines.push(`\n■ ${o.id} [${o.category}]  FATAL: ${o.fatal}`);
    continue;
  }
  fs.writeFileSync(path.join(outDir, `${o.id}.json`), JSON.stringify(o.analysis, null, 2));
  const caseHard = o.results.filter((r) => !r.pass && !r.soft);
  const caseSoft = o.results.filter((r) => !r.pass && r.soft);
  passes += o.results.filter((r) => r.pass).length;
  hardFails += caseHard.length;
  softWarns += caseSoft.length;
  const status = caseHard.length ? "FAIL" : caseSoft.length ? "WARN" : "PASS";
  lines.push(`\n${status === "PASS" ? "✓" : status === "WARN" ? "!" : "✗"} ${o.id} [${o.category}]  ${status}`);
  for (const r of o.results) {
    const mark = r.pass ? "  ✓" : r.soft ? "  ! (soft)" : "  ✗";
    lines.push(`${mark} ${r.label}${r.detail ? `  — ${r.detail}` : ""}`);
  }
}

console.log(lines.join("\n"));
console.log(`\n${"=".repeat(60)}`);
console.log(`checks passed: ${passes} | HARD FAILS: ${hardFails} | soft warns: ${softWarns}`);
console.log(`cases: ${outcomes.length} | wall time: ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`full analyses saved to: ${path.relative(WEB, outDir)}`);
console.log(hardFails === 0 ? "\nRESULT: GREEN (no hard failures)" : `\nRESULT: ${hardFails} HARD FAILURE(S) — inspect the JSON above`);
process.exit(hardFails === 0 ? 0 : 1);
