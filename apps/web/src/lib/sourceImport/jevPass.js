/*
 * The Jev pass over one run's shadow-scored changes (shadow.js, jev.js).
 * No database: shadowStore.js saves what it returns.
 */

import { rescoreWithJev, PAGE_READ_SOURCES } from "./shadow.js";
import { askJev, jevOn, questionsFor, expectedProbability, JEV_MODEL } from "./jev.js";
import { textHasAddress } from "./evidence.js";

// At most this many Jev calls per sync run (one per unit with changes).
export const JEV_CALLS_PER_RUN = 40;
// Evidence kept on a row for labelling and review, in characters.
const KEEP_TEXT = 2500;

/*
 * Ask Jev about every page-read change of a run: one call per unit, every
 * question about that unit together, against the text the unit was read
 * from. The right-building question is asked once, on the main page, only
 * when the code cannot find the listing's address there (Wyatt, 2026-11-24:
 * no Jev spend where code already knows). Never throws: a failed call marks
 * that unit's changes, which then wait for the next read.
 */
export async function jevPass({ rows, snapshot, state, ask = askJev, on = jevOn() }) {
  if (!on) return rows;
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
  if (pageText && building && address && !textHasAddress(pageText, address)) {
    try {
      const r = await ask(pageText, [{ type: "predicate", name: "building", instructions: `Is this text about ${building} at ${address}?` }]);
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
  rows.forEach((row, i) => {
    if (!PAGE_READ_SOURCES.has(row.source) || row._in?.weekly || row.kind === "photos_added") return;
    const key = row.kind === "lease_withdrawn" ? "__page__" : row.unit_key ?? "__page__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });

  const results = new Map(); // row index -> jev result
  for (const [key, idxs] of groups) {
    const text = key === "__page__" ? pageText : ev?.units?.[key]?.text ?? "";
    const asks = idxs.flatMap((i) => questionsFor(rows[i], i, { unitLabel: label(rows[i].unit_key) }).map((q) => ({ ...q, row: i })));
    if (!asks.length) continue;
    if (!text) {
      for (const i of idxs) results.set(i, { status: "no_text", model: JEV_MODEL, parts: [] });
      continue;
    }
    if (calls >= JEV_CALLS_PER_RUN) {
      for (const i of idxs) results.set(i, { status: "failed", model: JEV_MODEL, parts: [], error: "call cap for this run" });
      continue;
    }
    try {
      const r = await ask(text, asks.map((a) => a.question));
      calls += 1;
      cost += r.costUsd;
      for (const i of idxs) results.set(i, { status: "ok", model: r.model, parts: [], text: text.slice(0, KEEP_TEXT), url: key === "__page__" ? ev?.page?.url ?? null : ev?.units?.[key]?.url ?? null });
      for (const a of asks) {
        const ans = r.answers[a.question.name];
        results.get(a.row).parts.push({ part: a.part, p: expectedProbability(ans, a.expect), choice: ans?.choice ?? null, rough: !!a.expect.rough, invert: !!a.expect.invert, question: a.question.instructions });
      }
    } catch (err) {
      for (const i of idxs) results.set(i, { status: "failed", model: JEV_MODEL, parts: [], error: String(err?.message ?? err).slice(0, 200) });
    }
  }
  if (calls) console.log(`[source-sync] Jev: ${calls} call${calls === 1 ? "" : "s"}, $${cost.toFixed(5)} for ${building ?? "a listing"}`);

  return rows.map((row, i) => {
    const res = results.get(i) ?? (buildingPart ? { status: "skipped", model: JEV_MODEL, parts: [] } : null);
    if (!res) return row;
    const parts = buildingPart ? [...res.parts, buildingPart] : res.parts;
    const out = rescoreWithJev(row, { ...res, parts });
    return { ...out, jev: { ...out.jev, text: res.text ?? null, url: res.url ?? null } };
  });
}
