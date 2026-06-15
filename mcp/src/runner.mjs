/**
 * runner.mjs — executes the analyze-impact checklist against a running app.
 *
 * Takes the affected surfaces from analyzeImpact() and actually exercises them:
 *   - API endpoints: requests each route and judges the result by its auth level
 *     (public should respond; guarded routes should reject unauthenticated calls).
 *   - Pages: loads each affected page and flags server errors.
 *
 * v1 is unauthenticated: it verifies reachability, auth-guard correctness, and
 * page loads — no secrets required. Authenticated happy-path testing (log in,
 * submit, assert persisted) is a later increment.
 *
 * Uses Node's global fetch (Node 18+). Safe-by-default: mutating methods are sent
 * empty bodies so a working auth guard rejects them before any DB write.
 */

import { analyzeImpact } from "./impact.mjs";
import { getTestSession } from "./testauth.mjs";

const DEFAULT_BASE_URL = "http://localhost:3000";
const REQUEST_TIMEOUT_MS = 8000;

// Fill dynamic [segments] with a harmless placeholder so the URL is requestable.
function concretePath(path) {
  return path.replace(/\[([^\]]+)\]/g, "test");
}

async function request(url, method, cookie) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const opts = { method, redirect: "manual", signal: controller.signal, headers: {} };
  if (cookie) opts.headers.cookie = cookie;
  if (method !== "GET" && method !== "HEAD") {
    opts.headers["content-type"] = "application/json";
    opts.body = "{}"; // empty body: a working guard rejects before validation/writes
  }
  try {
    const res = await fetch(url, opts);
    return { status: res.status };
  } catch (err) {
    return { error: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// Judge an endpoint response against what its auth level implies.
function judgeEndpoint(auth, method, result) {
  if (result.error) return { verdict: "fail", note: `request failed (${result.error})` };
  const s = result.status;
  if (s >= 500) return { verdict: "fail", note: `server error ${s} — endpoint crashed` };

  const guarded = auth && auth !== "public";
  if (guarded) {
    if (s === 401 || s === 403) return { verdict: "pass", note: `auth guard active (${s})` };
    if (s >= 200 && s < 300)
      return { verdict: "fail", note: `⚠ SECURITY: ${method} returned ${s} unauthenticated — auth guard missing` };
    // 400/404/405/redirect: guard inconclusive but not crashing
    return { verdict: "warn", note: `responded ${s} (auth guard not clearly enforced)` };
  }
  // public
  if (s >= 200 && s < 500) return { verdict: "pass", note: `reachable (${s})` };
  return { verdict: "warn", note: `unexpected ${s}` };
}

// Judge an authenticated request to a guarded endpoint (we logged in as a test user).
function judgeAuthedEndpoint(result, sessionRole) {
  if (result.error) return { verdict: "fail", note: `authenticated request failed (${result.error})` };
  const s = result.status;
  if (s >= 500) return { verdict: "fail", note: `server error ${s} for logged-in user — endpoint broken` };
  if (s >= 200 && s < 400) return { verdict: "pass", note: `works for authenticated user (${s})` };
  if (s === 401) return { verdict: "fail", note: `401 even with session — auth not accepted (cookie expired / login failed?)` };
  if (s === 403) return { verdict: "warn", note: `403 — test user (role: ${sessionRole}) lacks access; rerun with a higher-role TEST account to verify` };
  if (s === 404) return { verdict: "warn", note: `404 (placeholder id for a dynamic route)` };
  return { verdict: "warn", note: `unexpected ${s}` };
}

function judgePage(result) {
  if (result.error) return { verdict: "fail", note: `request failed (${result.error})` };
  const s = result.status;
  if (s >= 500) return { verdict: "fail", note: `server error ${s}` };
  if (s >= 200 && s < 400) return { verdict: "pass", note: `loaded (${s})` };
  if (s === 401 || s === 403 || s === 404) return { verdict: "warn", note: `responded ${s}` };
  return { verdict: "warn", note: `unexpected ${s}` };
}

export async function runImpactTests({
  base = "staging",
  head,
  files,
  baseUrl = DEFAULT_BASE_URL,
  include = "all",
  allowMutations = false,
} = {}) {
  const impact = analyzeImpact({ base, head, files });
  if (impact.error) return { error: impact.error };

  const root = baseUrl.replace(/\/+$/, "");
  const results = { endpoints: [], pages: [] };

  // Optional authenticated layer: if test credentials are configured, log in so we
  // can verify guarded endpoints actually work for a real user — not just that they
  // reject anonymous calls. Authenticated MUTATIONS stay off unless explicitly allowed
  // (they would write to the live DB / send real emails).
  let session = null;
  const auth = { configured: false, ok: false, role: null, method: null, note: null };
  const sess = await getTestSession(root);
  if (sess) {
    auth.configured = true;
    if (sess.error) auth.note = sess.error;
    else { session = sess; auth.ok = true; auth.role = sess.role; auth.method = sess.method; }
  }

  // Collect endpoints to test: direct + runtime-called + indirect + schema-affected.
  const api = impact.affected.apiEndpoints;
  const endpointMap = new Map();
  for (const e of [...api.direct, ...(api.called ?? []).filter((x) => !x.unmatched), ...api.indirect, ...impact.affected.schemaRoutes]) {
    if (!endpointMap.has(e.path)) endpointMap.set(e.path, e);
  }

  if (include === "all" || include === "endpoints") {
    for (const e of endpointMap.values()) {
      const methods = e.methods?.length ? e.methods : ["GET"];
      const guarded = e.auth && e.auth !== "public";
      for (const method of methods) {
        const url = root + concretePath(e.path);

        // 1. Unauthenticated probe — confirms reachability + guard behavior.
        const res = await request(url, method);
        const judged = judgeEndpoint(e.auth, method, res);
        results.endpoints.push({ method, path: e.path, auth: e.auth ?? "?", mode: "anon", status: res.status ?? null, ...judged });

        // 2. Authenticated probe — only for guarded reads, only if logged in.
        if (session && guarded) {
          const isRead = method === "GET" || method === "HEAD";
          if (isRead) {
            const aRes = await request(url, method, session.cookie);
            const aJudged = judgeAuthedEndpoint(aRes, session.role);
            results.endpoints.push({ method, path: e.path, auth: e.auth, mode: "auth", status: aRes.status ?? null, ...aJudged });
          } else if (!allowMutations) {
            results.endpoints.push({
              method, path: e.path, auth: e.auth, mode: "auth", status: null,
              verdict: "skip", note: "authenticated mutation skipped (would write to live DB) — enable allowMutations only against a safe/snapshot DB",
            });
          }
        }
      }
    }
  }

  if (include === "all" || include === "pages") {
    const pages = [...impact.affected.pages.direct, ...impact.affected.pages.indirect];
    const seen = new Set();
    for (const p of pages) {
      if (seen.has(p.path)) continue;
      seen.add(p.path);
      const url = root + concretePath(p.path);
      const res = await request(url, "GET");
      const judged = judgePage(res);
      results.pages.push({ path: p.path, status: res.status ?? null, ...judged });
    }
  }

  const all = [...results.endpoints, ...results.pages];
  const summary = {
    total: all.length,
    pass: all.filter((r) => r.verdict === "pass").length,
    warn: all.filter((r) => r.verdict === "warn").length,
    fail: all.filter((r) => r.verdict === "fail").length,
    skip: all.filter((r) => r.verdict === "skip").length,
  };

  return { baseUrl: root, base: impact.base, head: impact.head, auth, summary, results, impact };
}

// ── Report formatting ─────────────────────────────────────────────────────────

const ICON = { pass: "✅", warn: "⚠️", fail: "❌", skip: "⏭️" };

export function formatTestReport(out) {
  if (out.error) return `## Impact Test Run — error\n\n${out.error}`;

  const { summary, results, auth } = out;
  let s = `## Impact Test Run\n`;
  s += `**Target:** ${out.baseUrl} · **Diff:** \`${out.base}\` → \`${out.head}\`\n`;

  // Auth status line
  if (!auth?.configured) {
    s += `**Auth:** unauthenticated only (no test credentials in .env.test.local)\n`;
  } else if (auth.ok) {
    s += `**Auth:** logged in via ${auth.method} as role \`${auth.role}\` ✓ (authenticated reads included)\n`;
  } else {
    s += `**Auth:** ⚠️ login failed — ${auth.note} (ran unauthenticated only)\n`;
  }

  s += `**Result:** ${summary.pass} passed · ${summary.warn} warnings · ${summary.fail} failed`;
  s += summary.skip ? ` · ${summary.skip} skipped (of ${summary.total})\n\n` : ` (of ${summary.total})\n\n`;

  if (summary.total === 0) {
    return s + `_No affected surfaces to test. (Is the app reachable at ${out.baseUrl}?)_`;
  }

  if (results.endpoints.length) {
    s += `### API endpoints\n`;
    for (const r of results.endpoints) {
      const tag = r.mode === "auth" ? " _(authed)_" : "";
      s += `${ICON[r.verdict]} \`${r.method} ${r.path}\`${tag} _[auth:${r.auth}]_ → ${r.note}\n`;
    }
    s += `\n`;
  }
  if (results.pages.length) {
    s += `### Pages\n`;
    for (const r of results.pages) {
      s += `${ICON[r.verdict]} \`${r.path}\` → ${r.note}\n`;
    }
    s += `\n`;
  }

  const fails = [...results.endpoints, ...results.pages].filter((r) => r.verdict === "fail");
  if (fails.length) {
    s += `### ❌ Needs attention\n`;
    for (const r of fails) s += `- \`${r.path}\`: ${r.note}\n`;
  } else if (summary.warn === 0) {
    s += `_All affected surfaces passed._`;
  }

  s += `\n\n_Note: v1 is unauthenticated — it verifies reachability, auth-guard correctness, and page loads. ` +
    `It does not yet log in and exercise authenticated happy-paths (e.g. submit the form, assert it saved)._`;

  return s;
}
