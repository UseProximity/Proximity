/*
 * The Jev pass over one run's shadow-scored changes (shadow.js, jev.js).
 * No database: shadowStore.js saves what it returns.
 */

import { rescoreWithJev, PAGE_READ_SOURCES } from "./shadow.js";
import { askJev, jevOn, questionsFor, expectedProbability, JEV_MODEL } from "./jev.js";
import { textHasAddress, unitWindow } from "./evidence.js";

// At most this many Jev calls per sync run (one per unit with changes).
export const JEV_CALLS_PER_RUN = 40;
// Calls in flight at once, and the most time the pass may take: it runs
// inside the sync, before anything is applied (PR 483 review).
const JEV_PARALLEL = 4;
export const JEV_BUDGET_MS = 60000;
// Evidence kept on a row for labelling and review, in characters.
const KEEP_TEXT = 2500;
// A whole page sent to Jev for a unit the site does not name, in characters.
const PAGE_ASK_CHARS = 24000;

/*
 * Ask Jev about every page-read change of a run: one call per unit, every
 * question about that unit together, against the text the unit was read
 * from. The right-building question is asked once, on the main page, only
 * when the code cannot find the listing's address there (Wyatt, 2026-11-24:
 * no Jev spend where code already knows). Never throws: a failed call marks
 * that unit's changes, which then wait for the next read.
 */
export async function jevPass({ rows, snapshot, state, ask = askJev, on = jevOn(), now = Date.now() }) {
  if (!on) return rows;
  const deadline = now + JEV_BUDGET_MS;
  const ev = snapshot?.evidence ?? null;
  const units = new Map((snapshot?.units ?? []).map((u) => [u.key, u]));
  const label = (key) => {
    const u = units.get(key);
    if (u?.name) return `the ${u.name} unit`;
    if (u) return `the ${u.bedrooms ?? "?"} bed, ${u.bathrooms ?? "?"} bath plan`;
    return "this unit";
  };
  let cost = 0;
  let calls = 0;

  // Right building: once per run, only when code cannot confirm it.
  let buildingPart = null;
  const building = state?.title ?? null;
  const address = state?.address ?? null;
  const pageText = ev?.page?.text ?? "";
  /*
   * Asked of the fullest page read, not the first: a first page that is a
   * cookie notice or a bare shell once scored Kirkwood Bluffs' own site 0.02
   * (2026-11-25). Too little text to judge by is not asked about at all.
   */
  const fullest = [...(ev?.pages ?? [])].sort((a, b) => b.text.length - a.text.length)[0]?.text?.slice(0, 8000) ?? pageText;
  if (fullest.length >= 600 && building && address && !ev?.addressSeen && !textHasAddress(fullest, address)) {
    try {
      const r = await ask(fullest, [{ type: "predicate", name: "building", instructions: `Is this text about ${building} at ${address}?` }]);
      calls += 1;
      cost += r.costUsd;
      const p = expectedProbability(r.answers.building, { kind: "predicate" });
      if (p != null) buildingPart = { part: "building", p, rightThing: true };
    } catch (err) {
      console.error(`[source-sync] Jev right-building for ${building}: ${err?.message ?? err}`);
    }
  }

  // Group the page-read changes by the unit they are about.
  const groups = new Map();
  const windows = new Map();
  const layoutAsk = new Set();
  const results = new Map(); // row index -> jev result
  const snapNames = (snapshot?.units ?? []).map((u) => u?.name).filter(Boolean);
  rows.forEach((row, i) => {
    if (!PAGE_READ_SOURCES.has(row.source) || row._in?.weekly || row.kind === "photos_added") return;
    if (row.kind === "lease_withdrawn") {
      // The withdrawn unit's own block, wherever a page still names it. A
      // unit no page names is off the website: code knows, Jev is not asked.
      const name = row._in?.unitName ?? null;
      // A duplicate, or a layout-named unit the site's named plans replaced:
      // code settled it, and the page still showing that layout proves nothing.
      if (row._in?.settled) {
        results.set(i, { status: "ok", model: "code", parts: [{ part: "listed", p: 0, invert: true, question: row._in.settledBy ?? `${name} is ${row._in.settled}` }] });
        return;
      }
      let w = name ? unitWindow(ev?.pages ?? [], { name }, snapNames.filter((n) => n !== name)) : null;
      if (!name || !(ev?.pages ?? []).length) return;
      if (!w && row._in.unitSiteNamed) {
        results.set(i, { status: "ok", model: "code", parts: [{ part: "listed", p: 0, invert: true, question: `${name} is named on none of the pages read` }] });
        return;
      }
      /*
       * A name the website never used ("4 Bed 2 Bath" on The ICON, whose
       * plans the site lists by size) proves nothing by its absence: Jev is
       * asked about the layout on the fullest page instead.
       */
      if (!w) {
        const fullest = [...(ev?.pages ?? [])].sort((a, b) => b.text.length - a.text.length)[0];
        w = { url: fullest.url, text: fullest.text.slice(0, PAGE_ASK_CHARS) };
        layoutAsk.add(i);
      }
      const key = layoutAsk.has(i) ? `gone-layout:${row._in.unitLayout ?? name}` : `gone:${name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
      windows.set(key, w);
      return;
    }
    const key = row.unit_key ?? "__page__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });

  /*
   * The order the units are asked about turns with the day, so on a listing
   * with more units than the call cap a different set waits each day rather
   * than the same last ones forever (PR 483 review).
   */
  const entries = [...groups];
  const turn = entries.length ? (Math.floor(now / 86400000) * JEV_CALLS_PER_RUN) % entries.length : 0;
  const ordered = [...entries.slice(turn), ...entries.slice(0, turn)];
  const work = [];
  for (const [key, idxs] of ordered) {
    const win = key === "__page__" ? ev?.page : windows.get(key) ?? ev?.units?.[key];
    const text = win?.text ?? "";
    const asks = idxs.flatMap((i) => questionsFor(rows[i], i, { unitLabel: rows[i].kind === "lease_withdrawn" ? (layoutAsk.has(i) && rows[i]._in.unitLayout ? `a ${rows[i]._in.unitLayout} plan` : `the ${rows[i]._in.unitName} unit`) : label(rows[i].unit_key) }).map((q) => ({ ...q, row: i })));
    if (!asks.length) continue;
    if (!text) {
      for (const i of idxs) results.set(i, { status: "no_text", model: JEV_MODEL, parts: [] });
      continue;
    }
    if (calls + work.length >= JEV_CALLS_PER_RUN) {
      for (const i of idxs) results.set(i, { status: "failed", model: JEV_MODEL, parts: [], error: "call cap for this run" });
      continue;
    }
    work.push({ idxs, asks, text, win });
  }
  const askOne = async ({ idxs, asks, text, win }) => {
    if (Date.now() > deadline) {
      for (const i of idxs) results.set(i, { status: "failed", model: JEV_MODEL, parts: [], error: "out of time for this run" });
      return;
    }
    try {
      const r = await ask(text, asks.map((a) => a.question));
      calls += 1;
      cost += r.costUsd;
      for (const i of idxs) results.set(i, { status: "ok", model: r.model, parts: [], text: text.slice(0, KEEP_TEXT), url: win?.url ?? null });
      for (const a of asks) {
        const ans = r.answers[a.question.name];
        results.get(a.row).parts.push({ part: a.part, p: expectedProbability(ans, a.expect), choice: ans?.choice ?? null, rough: !!a.expect.rough, invert: !!a.expect.invert, soft: !!a.expect.soft, question: a.question.instructions });
      }
    } catch (err) {
      for (const i of idxs) results.set(i, { status: "failed", model: JEV_MODEL, parts: [], error: String(err?.message ?? err).slice(0, 200) });
    }
  };
  for (let i = 0; i < work.length; i += JEV_PARALLEL) await Promise.all(work.slice(i, i + JEV_PARALLEL).map(askOne));
  if (calls) console.log(`[source-sync] Jev: ${calls} call${calls === 1 ? "" : "s"}, $${cost.toFixed(5)} for ${building ?? "a listing"}`);

  return rows.map((row, i) => {
    const res = results.get(i) ?? (buildingPart ? { status: "skipped", model: JEV_MODEL, parts: [] } : null);
    if (!res) return row;
    // A feed, portal or unit page is tied to the listing by its own address or
    // id, not by the page's words: the answer is kept on the row, not scored.
    const tiedByFeed = ["feed", "portal", "unit_page"].includes(row.source);
    const parts = buildingPart ? [...res.parts, tiedByFeed ? { ...buildingPart, rightThing: false, soft: true, note: "not scored for a feed" } : buildingPart] : res.parts;
    const out = rescoreWithJev(row, { ...res, parts });
    return { ...out, jev: { ...out.jev, text: res.text ?? null, url: res.url ?? null } };
  });
}
