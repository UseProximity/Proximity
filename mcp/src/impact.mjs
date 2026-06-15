/**
 * impact.mjs — Affected-surface analyzer.
 *
 * Given a set of changed files (from git, or passed explicitly), works out which
 * testable surfaces are affected: API endpoints and app pages. It does this by
 * building a reverse-dependency graph of `src/` (who imports whom) and walking
 * outward from each changed file until it reaches a route or page.
 *
 * The point: turn "I changed src/lib/email.js" into "these 3 endpoints are
 * downstream — test them" so testing can be surgical instead of whole-app.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { readKnowledge } from "./resources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", ".."); // repo root (the checkout the MCP lives in)
const SRC = join(ROOT, "src");

// ── File walking ────────────────────────────────────────────────────────────

function walkSrc(dir, results = []) {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkSrc(full, results);
    else if (/\.(js|jsx)$/.test(entry)) results.push(full);
  }
  return results;
}

function read(path) {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

const rel = (abs) => relative(ROOT, abs).replace(/\\/g, "/");

// Drop SQL comments so table-name parsing doesn't pick up words like "the" from prose.
function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

// ── Import resolution ───────────────────────────────────────────────────────

// Resolve a bare specifier to an absolute file inside src/, or null if external.
function resolveSpecifier(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // node_module / bare import — not part of our graph

  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    join(base, "index.js"),
    join(base, "index.jsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function extractSpecifiers(content) {
  const specs = new Set();
  for (const m of content.matchAll(/from\s*["']([^"']+)["']/g)) specs.add(m[1]);
  for (const m of content.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1]);
  for (const m of content.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1]);
  return [...specs];
}

// Build reverse-dependency map: importedFile (rel) → Set of files (rel) that import it.
function buildReverseGraph() {
  const files = walkSrc(SRC);
  const reverse = new Map();
  for (const file of files) {
    const importer = rel(file);
    for (const spec of extractSpecifiers(read(file))) {
      const target = resolveSpecifier(spec, file);
      if (!target) continue;
      const dep = rel(target);
      if (!reverse.has(dep)) reverse.set(dep, new Set());
      reverse.get(dep).add(importer);
    }
  }
  return reverse;
}

// ── Surface classification ──────────────────────────────────────────────────

function classifySurface(relPath) {
  if (/^src\/app\/.*route\.js$/.test(relPath)) {
    const path = "/" + relPath.replace(/^src\/app\//, "").replace(/\/?route\.js$/, "");
    return { kind: "api", path: path.replace(/\/+$/, "") || "/" };
  }
  if (/^src\/app\/.*page\.js$/.test(relPath)) {
    const path = "/" + relPath.replace(/^src\/app\//, "").replace(/\/?page\.js$/, "");
    return { kind: "page", path: path.replace(/\/+$/, "") || "/" };
  }
  return null;
}

// ── Runtime API-call detection ──────────────────────────────────────────────
// Import edges miss a key relationship: a changed page/component that calls an
// endpoint at runtime via fetch("/api/..."). Detect those string literals and
// match them to known routes so the endpoints they hit get tested too.

function pathSegs(p) {
  return p.replace(/\/+$/, "").split("/").filter(Boolean);
}

// Does a called path correspond to this route path? Dynamic [segments] match anything.
// A shorter call matches a longer route only if the extra route segments are all dynamic
// (e.g. call "/api/x" hitting collection route "/api/x/[id]" after interpolation was stripped).
function callMatchesRoute(callPath, routePath) {
  const C = pathSegs(callPath);
  const R = pathSegs(routePath);
  if (C.length === R.length) return R.every((s, i) => s.startsWith("[") || s === C[i]);
  if (C.length < R.length) {
    for (let i = 0; i < C.length; i++) if (!(R[i].startsWith("[") || R[i] === C[i])) return false;
    for (let i = C.length; i < R.length; i++) if (!R[i].startsWith("[")) return false;
    return true;
  }
  return false;
}

// Extract "/api/..." paths from string/template literals (stops at quote or ${interpolation}).
function extractApiCalls(content) {
  const calls = new Set();
  for (const m of content.matchAll(/["'`](\/api\/[^"'`$]*)/g)) {
    const path = m[1].split("?")[0].split("#")[0].replace(/\/+$/, "");
    if (path.length > 1) calls.add(path);
  }
  return [...calls];
}

// A layout/template change affects every page nested under its directory.
function pagesUnderLayout(relPath) {
  const m = relPath.match(/^(src\/app\/.*?)\/?(layout|template)\.js$/);
  if (!m) return [];
  const dirAbs = join(ROOT, m[1]);
  return walkSrc(dirAbs)
    .map(rel)
    .filter((p) => /page\.js$/.test(p))
    .map((p) => ({ file: p, ...classifySurface(p) }));
}

// ── Knowledge enrichment ────────────────────────────────────────────────────

function loadRouteMeta() {
  try {
    const doc = JSON.parse(readKnowledge("api-routes.json"));
    const byFile = new Map();
    for (const r of doc.routes ?? []) byFile.set(r.file, r);
    return byFile;
  } catch { return new Map(); }
}

// ── Changed-file discovery ──────────────────────────────────────────────────

function git(args) {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf-8" }).trim();
}

function getChangedFiles({ base = "staging", head }) {
  const set = new Set();
  const add = (out) => out.split("\n").map((s) => s.trim()).filter(Boolean).forEach((f) => set.add(f));
  try {
    if (head) {
      // Comparing two refs explicitly (e.g. for a PR or a CI run).
      add(git(`diff --name-only ${base}...${head}`));
    } else {
      // Working-branch mode: committed changes since base + uncommitted + new files.
      add(git(`diff --name-only ${base}...HEAD`));
      add(git(`diff --name-only`));
      add(git(`diff --name-only --cached`));
      add(git(`ls-files --others --exclude-standard`));
    }
  } catch (err) {
    return { error: err.message.split("\n")[0], files: [] };
  }
  return { files: [...set] };
}

// ── Core analysis ───────────────────────────────────────────────────────────

// Walk outward from a changed file through importers until we hit surfaces.
function reachableSurfaces(startRel, reverse) {
  const surfaces = new Map(); // surface file → {surface, via}
  const seen = new Set([startRel]);
  const queue = [{ file: startRel, depth: 0 }];

  while (queue.length) {
    const { file, depth } = queue.shift();
    const surface = classifySurface(file);
    if (surface && file !== startRel) {
      if (!surfaces.has(file)) surfaces.set(file, { ...surface, file, depth });
      // A route/page is a terminal surface — don't walk past it.
      continue;
    }
    for (const next of pagesUnderLayout(file)) {
      if (!surfaces.has(next.file)) surfaces.set(next.file, { ...next, depth });
    }
    for (const importer of reverse.get(file) ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      queue.push({ file: importer, depth: depth + 1 });
    }
  }
  return [...surfaces.values()];
}

export function analyzeImpact({ base = "staging", head, files: explicitFiles } = {}) {
  let changed;
  if (Array.isArray(explicitFiles) && explicitFiles.length) {
    changed = { files: explicitFiles };
  } else {
    changed = getChangedFiles({ base, head });
    if (changed.error) {
      return { error: `git diff failed (${changed.error}). Is '${base}' a valid ref?`, base, head };
    }
  }

  const srcChanged = changed.files.filter((f) => f.startsWith("src/") && /\.(js|jsx)$/.test(f));
  const migrationChanged = changed.files.filter((f) => f.startsWith("supabase/migrations/"));
  const otherChanged = changed.files.filter((f) => !srcChanged.includes(f) && !migrationChanged.includes(f));

  const reverse = buildReverseGraph();
  const routeMeta = loadRouteMeta();

  const directApi = new Map();
  const directPage = new Map();
  const indirectApi = new Map();
  const indirectPage = new Map();
  const triggers = {}; // surfaceFile → list of changed files that reach it

  const addSurface = (s, viaFile, direct) => {
    const bucket =
      s.kind === "api" ? (direct ? directApi : indirectApi) : direct ? directPage : indirectPage;
    if (!bucket.has(s.file)) {
      const meta = s.kind === "api" ? routeMeta.get(s.file) : null;
      bucket.set(s.file, {
        path: s.path,
        file: s.file,
        ...(meta ? { methods: meta.methods, auth: meta.auth, tables: meta.tables } : {}),
      });
    }
    (triggers[s.file] ??= new Set()).add(viaFile);
  };

  for (const f of srcChanged) {
    const self = classifySurface(f);
    if (self) {
      addSurface({ ...self, file: f }, f, true);
    }
    // layout/template: its own nested pages are directly affected
    for (const p of pagesUnderLayout(f)) addSurface(p, f, true);
    // everything reachable by importers is indirectly affected
    for (const s of reachableSurfaces(f, reverse)) {
      const isDirect = s.file === f;
      if (!isDirect) addSurface(s, f, false);
    }
  }

  // Runtime endpoints: scan changed frontend files for fetch("/api/...") calls and
  // match them to known routes. Catches form→endpoint links that imports don't show.
  const calledApi = new Map();
  const routeList = [...routeMeta.values()];
  for (const f of srcChanged) {
    if (classifySurface(f)?.kind === "api") continue; // route files handled as direct
    for (const callPath of extractApiCalls(read(join(ROOT, f)))) {
      const matches = routeList.filter((r) => callMatchesRoute(callPath, r.path));
      for (const r of matches) {
        if (!calledApi.has(r.path)) {
          calledApi.set(r.path, { path: r.path, file: r.file, methods: r.methods, auth: r.auth, tables: r.tables });
        }
        (triggers[r.file] ??= new Set()).add(f);
      }
      if (!matches.length) {
        // Called path with no known route — surface it so it isn't silently dropped.
        const key = `?${callPath}`;
        if (!calledApi.has(key)) calledApi.set(key, { path: callPath, unmatched: true });
      }
    }
  }

  // Schema/migration changes: map affected tables → routes touching them.
  // SQL is parsed loosely, so guard against noise (aliases, CTE names, comment words):
  // accept DDL table names outright, but only accept other identifiers if they match a
  // known table (one that some route queries, or that's in the hand-maintained schema).
  const knownTables = new Set();
  for (const r of routeMeta.values()) for (const t of r.tables ?? []) knownTables.add(t);
  try {
    const schema = JSON.parse(readKnowledge("db-schema.json"));
    for (const t of schema?.supabase?.tables ?? []) if (t.table) knownTables.add(t.table);
  } catch { /* schema optional */ }

  const tablesTouched = new Set();
  for (const f of migrationChanged) {
    const sql = stripSqlComments(read(join(ROOT, f))).toLowerCase();
    // DDL — the actual schema change; trust these even for brand-new tables.
    for (const m of sql.matchAll(/\b(?:create|alter|drop)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?["']?([a-z_][a-z0-9_]*)["']?/g)) {
      tablesTouched.add(m[1]);
    }
    // DML references — only keep if they're a known real table.
    for (const m of sql.matchAll(/\b(?:into|update|from|join)\s+["']?([a-z_][a-z0-9_]*)["']?/g)) {
      if (knownTables.has(m[1])) tablesTouched.add(m[1]);
    }
  }
  const schemaAffectedRoutes = [];
  if (tablesTouched.size) {
    for (const r of routeMeta.values()) {
      if ((r.tables ?? []).some((t) => tablesTouched.has(t))) {
        schemaAffectedRoutes.push({ path: r.path, file: r.file, methods: r.methods, auth: r.auth, tables: r.tables });
      }
    }
  }

  const dedupeTriggers = Object.fromEntries(
    Object.entries(triggers).map(([k, v]) => [k, [...v]])
  );

  const totalPages = walkSrc(join(SRC, "app")).map(rel).filter((p) => /page\.js$/.test(p)).length;

  return {
    base,
    head: head ?? "(working tree)",
    totalPages,
    changedFiles: { src: srcChanged, migrations: migrationChanged, other: otherChanged },
    affected: {
      apiEndpoints: {
        direct: [...directApi.values()],
        indirect: [...indirectApi.values()],
        called: [...calledApi.values()],
      },
      pages: { direct: [...directPage.values()], indirect: [...indirectPage.values()] },
      schemaRoutes: schemaAffectedRoutes,
      tablesTouched: [...tablesTouched],
    },
    triggers: dedupeTriggers,
  };
}

// ── Report formatting ───────────────────────────────────────────────────────

function fmtEndpoint(e) {
  const methods = e.methods?.length ? e.methods.join("|") : "?";
  const auth = e.auth ? ` _[auth:${e.auth}]_` : "";
  const tables = e.tables?.length ? ` · tables: ${e.tables.join(", ")}` : "";
  return `  - \`${methods} ${e.path}\`${auth}${tables}`;
}

function fmtPage(p) {
  return `  - \`${p.path}\` (\`${p.file}\`)`;
}

export function formatImpactReport(result) {
  if (result.error) {
    return `## Impact Analysis — error\n\n${result.error}`;
  }

  const { changedFiles, affected } = result;
  const totalChanged =
    changedFiles.src.length + changedFiles.migrations.length + changedFiles.other.length;

  let out = `## Impact Analysis\n`;
  out += `**Base:** \`${result.base}\` → **Head:** \`${result.head}\`\n`;
  out += `**Changed files:** ${totalChanged} (${changedFiles.src.length} src, ${changedFiles.migrations.length} migration, ${changedFiles.other.length} other)\n\n`;

  if (totalChanged === 0) {
    return out + `_No changes detected against \`${result.base}\`. Nothing to test._`;
  }

  if (changedFiles.src.length) {
    out += `**Source files changed:**\n${changedFiles.src.map((f) => `  - \`${f}\``).join("\n")}\n\n`;
  }

  const { apiEndpoints, pages, schemaRoutes, tablesTouched } = affected;

  const called = apiEndpoints.called ?? [];
  const calledKnown = called.filter((e) => !e.unmatched);
  const calledUnknown = called.filter((e) => e.unmatched);

  out += `### 🔌 Affected API endpoints\n`;
  if (apiEndpoints.direct.length) {
    out += `**Directly changed:**\n${apiEndpoints.direct.map(fmtEndpoint).join("\n")}\n`;
  }
  if (calledKnown.length) {
    out += `**Called at runtime by changed UI (fetch):**\n${calledKnown.map(fmtEndpoint).join("\n")}\n`;
  }
  if (apiEndpoints.indirect.length) {
    out += `**Indirectly affected (via shared code):**\n${apiEndpoints.indirect.map(fmtEndpoint).join("\n")}\n`;
  }
  if (calledUnknown.length) {
    out += `**Called but not in route knowledge (verify these exist):**\n${calledUnknown.map((e) => `  - \`${e.path}\``).join("\n")}\n`;
  }
  if (!apiEndpoints.direct.length && !calledKnown.length && !apiEndpoints.indirect.length && !calledUnknown.length) out += `_None._\n`;

  // A change that reaches most pages is a root-level/shared component (Header,
  // Providers, root layout). Enumerating every page isn't actionable — collapse it.
  const FANOUT = { abs: 8, frac: 0.4 };
  const broadFanout =
    pages.indirect.length > FANOUT.abs || pages.indirect.length >= (result.totalPages ?? Infinity) * FANOUT.frac;

  out += `\n### 🖥️ Affected pages\n`;
  if (pages.direct.length) {
    out += `**Directly changed:**\n${pages.direct.map(fmtPage).join("\n")}\n`;
  }
  if (pages.indirect.length) {
    if (broadFanout) {
      out += `**Broadly shared — ${pages.indirect.length} pages affected via a root-level/shared component.** ` +
        `This is most of the app; rather than testing each page, smoke-test a representative sample:\n` +
        `${pages.indirect.slice(0, 4).map(fmtPage).join("\n")}\n  - …and ${pages.indirect.length - 4} more\n`;
    } else {
      out += `**Indirectly affected (via shared code):**\n${pages.indirect.map(fmtPage).join("\n")}\n`;
    }
  }
  if (!pages.direct.length && !pages.indirect.length) out += `_None._\n`;

  if (schemaRoutes.length || tablesTouched.length) {
    out += `\n### 🗄️ Schema impact\n`;
    out += `Tables touched by migrations: ${tablesTouched.map((t) => `\`${t}\``).join(", ") || "_none detected_"}\n`;
    if (schemaRoutes.length) {
      out += `Endpoints querying those tables:\n${schemaRoutes.map(fmtEndpoint).join("\n")}\n`;
    }
  }

  // Suggested test checklist
  const allApi = [...apiEndpoints.direct, ...calledKnown, ...apiEndpoints.indirect, ...schemaRoutes];
  const seenApi = new Set();
  const apiChecklist = allApi.filter((e) => (seenApi.has(e.path) ? false : seenApi.add(e.path)));
  // When fan-out is broad, only the directly-changed pages plus a small sample go
  // in the checklist — don't ask the user to test most of the app.
  const allPages = broadFanout
    ? [...pages.direct, ...pages.indirect.slice(0, 4)]
    : [...pages.direct, ...pages.indirect];
  const seenPg = new Set();
  const pageChecklist = allPages.filter((p) => (seenPg.has(p.path) ? false : seenPg.add(p.path)));

  out += `\n### ✅ Suggested test checklist\n`;
  if (!apiChecklist.length && !pageChecklist.length) {
    out += `_No testable surfaces reached. Change may be config/util-only — review manually._\n`;
  } else {
    for (const e of apiChecklist) {
      out += `- [ ] **API** \`${(e.methods?.join("|")) || "?"} ${e.path}\` → assert status + response shape${e.auth && e.auth !== "public" ? `; verify auth guard (${e.auth})` : ""}\n`;
    }
    for (const p of pageChecklist) {
      out += `- [ ] **Page** \`${p.path}\` → loads without error; key UI renders\n`;
    }
  }

  return out;
}
