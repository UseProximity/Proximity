/**
 * ledger.mjs — stateful bug ledger for the incremental release check.
 *
 * The release PR check (staging → main) runs on every push to the release
 * branch. Statelessly it would re-test the whole release each time. This module
 * makes it incremental and memory-keeping:
 *
 *   - State (the bug ledger + the last commit we tested) is persisted inside the
 *     sticky PR comment as a hidden JSON block — no external storage needed.
 *   - Each run only re-tests the surfaces that changed since `lastTestedSha`.
 *   - reconcile() folds this run's test results into the prior ledger: failures
 *     become tracked bugs, a previously-failing surface that now passes is marked
 *     fixed, and a fixed surface that fails again is reopened (regression).
 *   - Open bugs that weren't re-tested this run are carried forward unchanged, so
 *     a release stays blocked until they're actually fixed.
 *
 * A "surface result" is one judged probe from runner.mjs, tagged with the role
 * whose run produced it. Bugs are keyed by role + method + path + mode so the
 * same endpoint tested anonymously vs. authenticated, or as landlord vs. student,
 * are tracked independently.
 */

// Distinct from the visible comment marker `<!-- release-pr-check -->` (which also
// ends in `-->`): this one has no space and a `:state` suffix, so the extractor
// can't confuse the two.
const STATE_BEGIN = "<!--release-pr-check:state";
const STATE_END = "-->";

export const STATE_VERSION = 1;

// ── Keys & labels ─────────────────────────────────────────────────────────────

export function resultKey(role, r) {
  const kind = r.kind || (r.method ? "api" : "page");
  const method = r.method || "GET";
  const mode = r.mode || "anon";
  return `${role}|${kind}|${method}|${r.path}|${mode}`;
}

function resultLabel(role, r) {
  const method = r.method || "GET";
  const modeTag = r.mode === "auth" ? ", authed" : "";
  return `\`${method} ${r.path}\` (${role}${modeTag})`;
}

// ── Serialize / parse the hidden state block ──────────────────────────────────

export function serializeStateBlock(state) {
  return `${STATE_BEGIN}\n${JSON.stringify(state)}\n${STATE_END}`;
}

// Pull the state JSON out of an existing comment body. Returns null if absent or
// unparseable (treated as a fresh start).
export function parseStateFromComment(body) {
  if (!body) return null;
  const start = body.indexOf(STATE_BEGIN);
  if (start === -1) return null;
  const end = body.indexOf(STATE_END, start + STATE_BEGIN.length);
  if (end === -1) return null;
  const json = body.slice(start + STATE_BEGIN.length, end).trim();
  try {
    const state = JSON.parse(json);
    return state && typeof state === "object" ? state : null;
  } catch {
    return null;
  }
}

// ── Reconciliation ────────────────────────────────────────────────────────────

// Normalize per-role runner output into a flat, role-tagged result list.
export function flattenRunResults(role, runnerOut) {
  const out = [];
  for (const e of runnerOut?.results?.endpoints ?? []) {
    out.push({ role, kind: "api", method: e.method, path: e.path, mode: e.mode || "anon", verdict: e.verdict, note: e.note });
  }
  for (const p of runnerOut?.results?.pages ?? []) {
    out.push({ role, kind: "page", method: "GET", path: p.path, mode: "anon", verdict: p.verdict, note: p.note });
  }
  return out;
}

/**
 * Fold this run's results into the prior ledger.
 *
 * @param prevState   parsed prior state, or null on first run
 * @param results     flat array of role-tagged surface results from this run
 * @param meta        { runNumber, headSha, headShort, lastTestedSha, incremental }
 * @returns { state, summary } where summary buckets the changes for narration.
 */
export function reconcile(prevState, results, meta) {
  const { runNumber, headSha, headShort, incremental } = meta;
  const prevBugs = Array.isArray(prevState?.bugs) ? prevState.bugs : [];
  const byId = new Map(prevBugs.map((b) => [b.id, { ...b }]));

  const newBugs = [];
  const fixed = [];
  const reopened = [];
  const stillOpen = [];
  const testedIds = new Set();

  let tested = 0;
  let warned = 0;

  for (const r of results) {
    // A skipped probe (e.g. an authenticated mutation we won't run) tells us
    // nothing — don't let it flip a bug's state or count as a real test.
    if (r.verdict === "skip") continue;
    tested++;
    if (r.verdict === "warn") warned++;

    const id = resultKey(r.role, r);
    testedIds.add(id);
    const existing = byId.get(id);
    const failing = r.verdict === "fail";

    if (failing) {
      if (existing && existing.status === "open") {
        existing.lastRun = runNumber;
        existing.lastSha = headShort;
        existing.note = r.note;
        stillOpen.push(existing);
      } else if (existing && existing.status === "fixed") {
        existing.status = "open";
        existing.reopenedRun = runNumber;
        existing.reopenedSha = headShort;
        existing.lastRun = runNumber;
        existing.lastSha = headShort;
        existing.note = r.note;
        delete existing.fixedRun;
        delete existing.fixedSha;
        reopened.push(existing);
      } else {
        const bug = {
          id,
          label: resultLabel(r.role, r),
          path: r.path,
          method: r.method || "GET",
          role: r.role,
          mode: r.mode || "anon",
          status: "open",
          firstRun: runNumber,
          firstSha: headShort,
          lastRun: runNumber,
          lastSha: headShort,
          note: r.note,
        };
        byId.set(id, bug);
        newBugs.push(bug);
      }
    } else if (existing && existing.status === "open") {
      // pass or warn on a surface we were tracking as broken → fixed.
      existing.status = "fixed";
      existing.fixedRun = runNumber;
      existing.fixedSha = headShort;
      existing.fixedNote = r.note;
      fixed.push(existing);
    }
  }

  const bugs = [...byId.values()];
  const openBugs = bugs.filter((b) => b.status === "open");
  // Open bugs we did NOT re-test this run (their area wasn't touched) — carried
  // forward as-is, still blocking the release.
  const carriedOpen = openBugs.filter((b) => !testedIds.has(b.id));

  const state = {
    v: STATE_VERSION,
    runNumber,
    firstSha: prevState?.firstSha || headShort,
    lastTestedSha: headSha,
    incremental: !!incremental,
    bugs,
  };

  const summary = {
    runNumber,
    incremental: !!incremental,
    tested,
    warned,
    newBugs,
    fixed,
    reopened,
    stillOpen,
    carriedOpen,
    openBugs,
    openCount: openBugs.length,
  };

  return { state, summary };
}

// ── Markdown for the PR comment ───────────────────────────────────────────────

function bugLine(b) {
  const age = b.firstRun === b.lastRun ? `run ${b.firstRun}` : `run ${b.firstRun}`;
  return `${b.label} — _${b.note || "failing"}_ (open since ${age})`;
}

export function formatLedger(summary, meta) {
  const { runNumber, incremental, tested, newBugs, fixed, reopened, stillOpen, carriedOpen, openCount } = summary;
  const { headShort, lastShort } = meta;

  let s = `## 🐞 Bug ledger — run ${runNumber}\n`;
  if (runNumber === 1 || !incremental) {
    s += `_First review of this release — tested the full set of affected surfaces (${tested} probe${tested === 1 ? "" : "s"})._\n\n`;
  } else {
    s += `_Incremental run: only surfaces changed since \`${lastShort}\` were re-tested (${tested} probe${tested === 1 ? "" : "s"} at \`${headShort}\`). Untouched surfaces keep their prior status._\n\n`;
  }

  if (fixed.length) {
    s += `### ✅ Fixed this run\n`;
    for (const b of fixed) s += `- ${b.label} — was: _${b.note || "failing"}_; now passing.\n`;
    s += `\n`;
  }
  if (reopened.length) {
    s += `### 🔁 Regressed (fixed earlier, failing again)\n`;
    for (const b of reopened) s += `- ${b.label} — _${b.note}_\n`;
    s += `\n`;
  }
  if (newBugs.length) {
    s += `### ❌ New bugs found\n`;
    for (const b of newBugs) s += `- ${b.label} — _${b.note}_\n`;
    s += `\n`;
  }
  if (stillOpen.length) {
    s += `### ❌ Still open (re-tested, still failing)\n`;
    for (const b of stillOpen) s += `- ${bugLine(b)}\n`;
    s += `\n`;
  }
  if (carriedOpen.length) {
    s += `### ⏸️ Still open (not touched this run — carried forward)\n`;
    for (const b of carriedOpen) s += `- ${bugLine(b)}\n`;
    s += `\n`;
  }

  if (openCount === 0) {
    s += newBugs.length || stillOpen.length || carriedOpen.length
      ? ``
      : `✅ **No open bugs.** ${fixed.length ? "Everything previously flagged is now fixed." : "Nothing flagged across this release."}\n`;
  } else {
    s += `**${openCount} open bug${openCount === 1 ? "" : "s"} blocking this release.** The check stays red until they're fixed (or re-tested as resolved once a commit touches their area).\n`;
  }

  return s;
}
