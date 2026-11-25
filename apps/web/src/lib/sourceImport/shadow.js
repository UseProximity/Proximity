/*
 * Shadow scoring (PRD stage 1). Every change a daily sync plans is also
 * scored the ledger's way (score.js) and saved next to what today's rules
 * did with it, in listing_sync_scores. Nothing here changes a listing: the
 * rows are what the admin borderline list, the before-and-after accuracy by
 * platform and the switch-over decision are built from.
 *
 * Until Jev is wired in (stage 2), read quality comes from what the reader
 * itself says: a starting-at price is capped, a guessed lease length or date
 * is marked inferred. So these scores are an upper bound on read quality.
 *
 * shadowRows is pure; saveShadowRows writes and never throws.
 */

import { TRUST, ROUGH_CAP, decide, fieldGroup, websiteFreshness } from "./score.js";
import { sameName, stableJson } from "./match.js";
import { sameValue } from "./learnRules.js";

/* The action a change is, for its bar. */
export function actionOf(c) {
  switch (c.kind) {
    case "lease_withdrawn":
      return "withdraw";
    case "lease_new":
    case "unit_new":
    case "unit_relisted":
      return "add";
    case "photos_added":
      return "photos";
    case "unit_updated":
      return "fill"; // the planner only fills a unit's blanks
    default: {
      const f = primaryField(c);
      const old = c.old && typeof c.old === "object" ? c.old[f] : c.old;
      return old == null || old === "" ? "fill" : "update";
    }
  }
}

/* The one field a change is scored on: rent when it moves a rent. */
export function primaryField(c) {
  if (c.kind === "property_updated") return "description";
  if (c.kind === "lease_withdrawn") return "unavailable";
  if (["lease_new", "unit_new", "unit_relisted", "photos_added"].includes(c.kind)) return "availability";
  const fields = String(c.field ?? "").split(",").filter(Boolean);
  if (fields.includes("rent")) return "rent";
  return fields[0] ?? "rent";
}

/*
 * The source a change came from and its trust. platform is the reader the
 * read used (snapshot.trace.reader); a unit the model read is Haiku's.
 */
export function sourceOf(c, snapUnit, snapshot) {
  const platform = String(snapshot?.trace?.reader ?? snapshot?.platform ?? "generic");
  if (c.detail?.fromUnitPage) return { source: "unit_page", trust: TRUST.feed, platform };
  if (snapUnit?.readBy === "recipe") return { source: "recipe", trust: TRUST.recipe, platform: `recipe${snapshot?.recipe?.platformKey ? `/${snapshot.recipe.platformKey}` : ""}` };
  if (snapUnit?.readBy === "pattern") return { source: "pattern", trust: TRUST.pattern, platform: "pattern" };
  // A change with no website unit behind it (a withdrawal) on a read code made.
  if (!snapUnit && snapshot?.trace?.codeOnly && /^(recipe|pattern)$/.test(platform)) return { source: platform, trust: platform === "recipe" ? TRUST.recipe : TRUST.pattern, platform };
  if (snapUnit?.fromModel || c.facts?.fromModel) return { source: "model", trust: TRUST.haiku, platform: `${platform}/model` };
  if (snapshot?.portal?.walked) return { source: "portal", trust: TRUST.feed, platform };
  if (/^(g5|sightmap|securecafe)/.test(platform)) return { source: "feed", trust: TRUST.feed, platform };
  if (platform === "generic") return { source: "pattern", trust: TRUST.pattern, platform };
  return { source: "structured", trust: TRUST.structured, platform };
}

const DAY = 86400000;
// Right thing for every claim of a read whose units jump by more than half.
export const UNIT_JUMP_RIGHT = 0.6;
// More new units than this in one read is the other-building sign (PR #418 review).
export const MAX_NEW_UNITS = 4;

/*
 * Whether an earlier run saw the website give this field a different value.
 *   priorValues  Map scope -> [{ field, value }] (shadowStore.js)
 * Field by field, whatever order the stored JSON keeps its keys in: a value
 * with several fields differs only where a field both name differs (PR 483
 * review: a reordered copy of the same offer counted as the website moving).
 */
export function saidOtherwiseBefore(priorValues, scope, field, value) {
  const seen = priorValues?.get?.(scope ?? "") ?? [];
  if (!seen.length) return false;
  const obj = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (obj(value)) {
    return Object.entries(value).some(([k, v]) => seen.some((p) => obj(p.value) && k in p.value && stableJson(p.value[k]) !== stableJson(v)));
  }
  return seen.some((p) => p.field === field && !obj(p.value) && stableJson(p.value) !== stableJson(value));
}

const LEASE_COL = { rent: "rent", rentIsPerPerson: "rent_is_per_person", leaseTermMonths: "lease_term_months", availableFrom: "available_from", apartments: "description" };
/* The lease's value now differs from what the sync last wrote, on a field this change moves. */
function leaseFieldsDiffer(lease, synced, changed) {
  for (const k of Object.keys(changed ?? {})) {
    const col = LEASE_COL[k];
    if (!col || !(col in synced)) continue;
    if (!sameValue(lease[col], synced[col])) return true;
  }
  return false;
}

/*
 * Score every change of one run.
 *   changes        the planned changes, after today's policy set c.verdict
 *   snapshot       the read
 *   state          the listing as loaded (units, leases)
 *   learnings      learn.js: synced (what the sync last wrote)
 *   landlordEdits  Map scope id ("<lease id>", "<unit id>", "property:<f>") -> ISO time of the edit
 *   syncBlanks     lease ids the sync itself left blank
 *   priorRuns      Map change key -> runs in a row it was planned before this one
 *   holdReason     today's run-level hold, if any
 * Returns rows for listing_sync_scores (no ids, no timestamps).
 */
export function shadowRows({ changes, snapshot, state, learnings, landlordEdits = new Map(), syncBlanks = new Set(), priorRuns = new Map(), priorRunsSeen = false, priorValues = new Map(), holdReason = null, now = Date.now() }) {
  const snapByKey = new Map((snapshot?.units ?? []).map((u) => [u.key, u]));
  const unitsById = new Map((state?.listing_units ?? []).map((u) => [u.id, u]));
  const leasesById = new Map((state?.listing_units ?? []).flatMap((u) => u.unit_leases ?? []).map((l) => [l.id, l]));
  const rows = [];
  const existingUnits = (state?.listing_units ?? []).length;
  const newUnits = (changes ?? []).filter((c) => c.kind === "unit_new").length;
  const runRight = newUnits > MAX_NEW_UNITS || newUnits > Math.max(1, existingUnits * 0.5) ? UNIT_JUMP_RIGHT : 1;
  for (const c of changes ?? []) {
    if (c.kind === "missing_unit") continue; // a note, not a change
    const leaseId = c.leaseId ?? c.detail?.leaseId ?? null;
    const unitId = c.unitId ?? c.detail?.unitId ?? null;
    const snapUnit = c.unitKey ? snapByKey.get(c.unitKey) : null;
    const field = primaryField(c);
    const action = actionOf(c);
    const from = sourceOf(c, snapUnit, snapshot);
    const { source, platform } = from;
    // A duplicate is settled by the listing's own records; a layout-named unit
    // the website's named plans replaced, by the read that named them.
    const settled = c.kind === "lease_withdrawn" ? (c.detail?.duplicateOf ? "duplicate" : c.detail?.supersededBy?.length ? "superseded" : null) : null;
    const trust = settled === "duplicate" ? Math.max(from.trust, TRUST.records) : from.trust;

    // Read quality: what the reader said about this fact (Jev from stage 2).
    let readQuality = 1;
    const rentType = c.facts?.rentExact === false || (c.kind === "lease_withdrawn" && c.facts?.rentsExact === false) ? "starting_at" : "exact";
    /*
     * A starting-at price where the sync last wrote one from the same website:
     * like for like, so it is neither capped nor refused (score.js: a
     * starting-at price can replace another). The sync's value counts as
     * starting-at when the site now shows this plan only as starting-at.
     */
    const roughForRough = fieldGroup(field) === "rent" && rentType !== "exact" && action === "update" && snapUnit && (snapUnit.offers ?? []).every((o) => o.rent == null || o.rentExact === false);
    if (fieldGroup(field) === "rent" && rentType !== "exact" && !roughForRough) readQuality = Math.min(readQuality, ROUGH_CAP);
    const offer = snapUnit?.offers?.find((o) => String(o.rent ?? "") === String(c.new?.rent ?? "")) ?? snapUnit?.offers?.[0];
    const inferred = (field === "leaseTermMonths" && !!offer?.termsInferred) || (field === "availableFrom" && offer && !offer.dateStated);
    // A unit missing from a read that did not see the whole list is not taken as let.
    if (action === "withdraw" && !settled && !snapshot?.unitListComplete && !c.detail?.fromUnitPage && !c.detail?.unitPageGone) readQuality = Math.min(readQuality, ROUGH_CAP);

    // Right thing: a unit matched by name (or its own page) is sure; by layout
    // only, less so; and a read that adds more than 4 units, or more than half
    // the listing again, is likely another building on the same website or a
    // misread (Coronado and Lindell Tower East, 11/4).
    const db = unitId ? unitsById.get(unitId) : null;
    let rightThing = runRight;
    if (db && snapUnit && !snapUnit.pinnedUnitId && !sameName(snapUnit.name, db.name)) rightThing *= 0.7;

    // Whose value stands today: the landlord's (fading) or the sync's. A
    // landlord's edit to a unit (its name, its size) speaks for the unit's
    // own fields, not for a new lease or photos on it (PR 483 review).
    const unitScoped = ["spec_mismatch", "unit_updated"].includes(c.kind);
    const scope = leaseId ?? (unitScoped ? unitId : null) ?? (c.kind === "property_updated" ? `property:description` : null);
    const editedAt = scope ? landlordEdits.get(scope) : null;
    const synced = leaseId ? learnings?.synced?.get(`lease:${leaseId}`) : null;
    const lease = leaseId ? leasesById.get(leaseId) : null;
    const syncMadeUnit = unitId ? learnings?.synced?.has(`unit:${unitId}`) : false;
    const landlordEdited =
      !!editedAt ||
      !!c.protected ||
      !!(c.detail?.landlordKept ?? []).length ||
      // A lease the landlord took down: the website showing it is not news.
      (c.kind === "unit_relisted" && !c.auto) ||
      // Specs on a unit the landlord made are the landlord's.
      (c.kind === "spec_mismatch" && !syncMadeUnit) ||
      /*
       * A lease the landlord changed after the sync wrote it. A lease with no
       * synced record is not taken as the landlord's: every lease from
       * before 11/11 has none. Landlord edits are known from their own
       * provenance (landlordEdits) instead.
       */
      (!!lease && !!synced && ["rent_change", "lease_updated"].includes(c.kind) && leaseFieldsDiffer(lease, synced, c.new));
    /*
     * Has the website moved since? Against what the sync last wrote when it
     * wrote this lease; otherwise against what earlier runs saw the website
     * say for this field: a different value before means it has moved. The
     * first time a value is seen proves nothing (the landlord may have just
     * edited away from it), so the landlord wins (Wyatt, 2026-11-24).
     */
    const key = changeKey(c);
    const movedSinceLandlord = !landlordEdited
      ? false
      : synced && c.new && typeof c.new === "object" && Object.keys(c.new).some((k) => LEASE_COL[k] in synced)
        ? Object.entries(c.new).some(([k, v]) => LEASE_COL[k] in synced && !sameValue(synced[LEASE_COL[k]], v))
        : saidOtherwiseBefore(priorValues, scope, field, c.new);
    // An edit of unknown age is taken as a year old.
    const daysSinceEdit = editedAt ? Math.max(0, (now - new Date(editedAt).getTime()) / DAY) : 365;
    const empty = action === "fill" || action === "add" || action === "photos";
    const blankByChoice = !!lease && lease.rent == null && !syncBlanks.has(leaseId) && landlordEdited;
    const current = empty
      ? { empty: true }
      : landlordEdited
        ? { by: "landlord", daysSinceEdit, blankByChoice, rentType: "exact" }
        : { by: "sync", score: TRUST.pattern, rentType: roughForRough ? rentType : "exact" };

    const freshness = websiteFreshness({ landlordEdited, movedSinceLandlord });
    const readsInRow = 1 + (priorRuns.get(key) ?? 0);
    let verdict = decide({ action, field, rentType, inferred, readsInRow, claim: { trust, readQuality, rightThing, freshness } }, current);
    // Descriptions and specials change on the weekly read only (Wyatt, 2026-11-24).
    if (c.kind === "property_updated") verdict = { ...verdict, apply: false, borderline: false, reason: "descriptions and specials change on the weekly read, not the daily sync" };
    // The listing gate (billing, agreement) and units owned elsewhere stand whatever the score.
    // So does the hold on a unit that may be a new one renamed: neither side is acted on until the landlord settles it.
    const blocked = (c.gated && c.kind !== "unit_new") || c.elsewhere || c.lookalike ? c.note ?? "blocked by the listing gate" : null;
    if (blocked) verdict = { ...verdict, apply: false, borderline: false, reason: blocked };

    rows.push({
      _i: (changes ?? []).indexOf(c),
      change_key: key,
      kind: c.kind,
      unit_key: c.unitKey ?? null,
      unit_id: unitId,
      lease_id: leaseId,
      field,
      action,
      old_value: c.old ?? null,
      new_value: c.new ?? null,
      source,
      platform,
      trust,
      read_quality: round(readQuality),
      right_thing: rightThing,
      freshness,
      score: round(verdict.score),
      current_score: round(verdict.current),
      need: round(verdict.need),
      bar: verdict.bar,
      reads_in_row: readsInRow,
      ledger_apply: !!verdict.apply,
      ledger_hidden: !!verdict.hidden,
      ledger_reason: verdict.reason ?? null,
      borderline: !!verdict.borderline,
      policy_apply: holdReason ? false : !!c.verdict?.apply,
      policy_reason: holdReason ? `run held: ${holdReason}` : c.verdict?.reason ?? null,
      landlord_edited: landlordEdited,
      // What decide() was given, so a Jev pass can score it again (never stored).
      _in: { action, field, rentType, roughForRough: !!roughForRough, settled, settledBy: c.note ?? null, onlyUnit: c.facts?.rentOnlyUnit === true, inferred, readsInRow, claim: { trust, readQuality, rightThing, freshness }, current, weekly: c.kind === "property_updated", blocked, unitName: db?.name ?? snapUnit?.name ?? null,
        // Whether the website itself has used this unit's name (the sync made it, or an alias was learned).
        unitSiteNamed: !!db && (String(learnings?.synced?.get(`unit:${db.id}`)?.siteKey ?? "").startsWith("n:") || [...(learnings?.aliases?.values?.() ?? [])].includes(db.id)),
        unitLayout: db ? [db.bedrooms != null ? `${Number(db.bedrooms) === 0 ? "studio" : `${db.bedrooms} bed`}` : null, db.bathrooms != null ? `${db.bathrooms} bath` : null, Number(db.area) > 0 ? `${Number(db.area).toLocaleString("en-US")} sq ft` : null].filter(Boolean).join(", ") : null },
    });
  }
  return rows;
}

const round = (n) => Math.round(Number(n) * 1000) / 1000;

/*
 * Sources whose facts Jev checks against the page text. A feed, portal or
 * unit page is taken as read (1.0), and so is structured data (embedded JSON
 * such as RentCafe's), which is not in the visible text Jev reads.
 */
export const PAGE_READ_SOURCES = new Set(["model", "pattern", "recipe", "portalSite"]);

/*
 * Score a row again with Jev's answers (jev.js).
 *   jev  { status: "ok" | "failed" | "no_text" | "skipped", parts: [{ part, p, choice, rough, rightThing }], model, error }
 * Read quality is the lowest probability Jev gives a fact code read; a
 * starting-at or range price, or (for a basis change) an unstated basis, caps
 * it at ROUGH_CAP; the right-building answer scales right thing. A page-read
 * change Jev could not check waits for the next read (PRD).
 */
export function rescoreWithJev(row, jev) {
  const inp = row._in;
  const stored = { status: jev.status, model: jev.model ?? null, parts: jev.parts ?? [], error: jev.error ?? null };
  if (!inp) return { ...row, jev: stored };
  const pageRead = PAGE_READ_SOURCES.has(row.source);
  let readQuality = inp.claim.readQuality;
  let rightThing = inp.claim.rightThing;
  let rentType = inp.rentType;
  for (const part of jev.parts ?? []) {
    if (part.p == null) continue;
    if (part.rightThing) {
      rightThing *= part.p;
      continue;
    }
    if (!pageRead) continue;
    if (part.rough) {
      if (part.part === "rentType" && part.choice && part.choice !== "exact") {
        rentType = part.choice;
        if (!inp.roughForRough) readQuality = Math.min(readQuality, ROUGH_CAP);
      }
      if (part.part === "basis" && part.choice === "not_stated" && inp.field === "rentIsPerPerson") readQuality = Math.min(readQuality, ROUGH_CAP);
      continue;
    }
    // A new lease's date or lengths the text does not state do not sink its price.
    if (part.soft) continue;
    readQuality = Math.min(readQuality, part.invert ? 1 - part.p : part.p);
  }
  const claim = { ...inp.claim, readQuality, rightThing };
  let verdict = decide({ ...inp, rentType, claim }, inp.current);
  if (pageRead && jev.status !== "ok" && jev.status !== "skipped") {
    verdict = { ...verdict, apply: false, borderline: false, reason: jev.status === "no_text" ? "Jev had no page text to check this against; it waits for the next read" : "Jev could not check this read; it waits for the next read" };
  }
  if (inp.weekly) verdict = { ...verdict, apply: false, borderline: false, reason: "descriptions and specials change on the weekly read, not the daily sync" };
  if (inp.blocked) verdict = { ...verdict, apply: false, borderline: false, reason: inp.blocked };
  return {
    ...row,
    read_quality: round(readQuality),
    right_thing: round(rightThing),
    score: round(verdict.score),
    current_score: round(verdict.current),
    need: round(verdict.need),
    ledger_apply: !!verdict.apply,
    ledger_hidden: !!verdict.hidden,
    ledger_reason: verdict.reason ?? null,
    borderline: !!verdict.borderline,
    jev: stored,
  };
}

/* The same change across runs: kind, unit, lease, field and new value. */
export function changeKey(c) {
  const lease = c.leaseId ?? c.detail?.leaseId ?? "";
  return `${c.kind}|${c.unitKey ?? ""}|${lease}|${c.field ?? ""}|${JSON.stringify(c.new ?? null)}`;
}
