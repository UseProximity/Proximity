/*
 * The recurring source sync.
 *
 * Every published listing with a source URL has a monitor row saying when it
 * is next due. syncMonitor reads one the same way an import reads it
 * (readProperty), keeps the snapshot, and if anything about the units or
 * prices changed applies it under the sync rules in apply.js. Then the pages
 * go through Proxy's synthesis (lib/agents/pages.js) so fees, policies and
 * specials land in the listing's knowledge.
 *
 * Since the per-listing agents (PRD v3) the daily batch runs each listing as
 * its own job in the import lanes (lib/agents/sync.js); runSourceSync, which
 * reads listings one after another, remains for an admin's on-demand run and
 * for the unscheduled /api/cron/source-sync route.
 *
 * The interval lives on the monitor (check_interval_days, default 1 since
 * the agents), so moving a landlord to weekly is a column update.
 */
import supabase from "@/lib/supabase";
import { getBaseUrl, sendSourceSyncDigestEmail, sendSourceSyncFailureEmail } from "@/lib/email";
import { sourceKindEnabled } from "@/lib/sourceSync/classify";
import { readProperty, DraftFetchError } from "./read.js";
import { applySnapshot } from "./apply.js";
import { fingerprint, summarize } from "./snapshot.js";
import { synthesizePages, markStaleSources } from "@/lib/agents/pages";
import { ensureAgent } from "@/lib/agents/store";

export const ALERT_TO = (process.env.SOURCE_SYNC_ALERT_EMAIL || "info@useproximity.org,o.wyatt@wustl.edu")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const DEFAULT_INTERVAL_DAYS = 1;
const MAX_BACKOFF_DAYS = 14;

const plusDays = (days) => new Date(Date.now() + days * 86400000).toISOString();

/*
 * A published listing with a source URL and no monitor row gets one. The 36
 * prod listings whose source URLs were set by hand before any sync existed
 * are the case: nothing ever wrote their monitors.
 */
export async function ensureMonitors() {
  const { data: rows } = await supabase
    .from("listings")
    .select("id, source_url, source_kind, listing_source_monitors!listing_id(id)")
    .not("source_url", "is", null)
    .is("deleted_at", null)
    .not("published_at", "is", null);
  const missing = (rows ?? []).filter((l) => !(l.listing_source_monitors ?? []).length);
  if (!missing.length) return 0;
  const { error } = await supabase.from("listing_source_monitors").upsert(
    missing.map((l) => ({ listing_id: l.id, source_url: l.source_url, source_kind: l.source_kind ?? "own_site", enabled: true, auto_apply: true })),
    { onConflict: "listing_id" }
  );
  if (error) console.error("[source-sync] ensureMonitors:", error.message);
  else console.log(`[source-sync] created ${missing.length} monitor${missing.length === 1 ? "" : "s"} for listings with a source URL`);
  return missing.length;
}

const MONITOR_SELECT = "id, listing_id, source_url, source_kind, index_url, enabled, auto_apply, check_interval_days, next_check_at, consecutive_failures, muted_until, last_fingerprint, portal, listings!listing_id(id, title, address, published_at, deleted_at)";

export async function dueMonitors({ listingId = null, limit = 30, force = false } = {}) {
  let q = supabase
    .from("listing_source_monitors")
    .select(MONITOR_SELECT)
    .order("next_check_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (listingId) q = q.eq("listing_id", listingId);
  else {
    q = q.eq("enabled", true).or(`next_check_at.is.null,next_check_at.lte.${new Date().toISOString()}`);
  }
  const { data, error } = await q;
  if (error) throw new Error(`monitors: ${error.message}`);
  return (data ?? []).filter((m) => {
    const l = m.listings;
    if (!l || l.deleted_at) return false;
    if (!force) {
      if (l.published_at === null) return false; // drafts are never synced
      if (m.muted_until && new Date(m.muted_until) > new Date()) return false;
      if (!sourceKindEnabled(m.source_kind)) return false;
    }
    return true;
  });
}

export async function monitorFor(listingId) {
  const { data } = await supabase.from("listing_source_monitors").select(MONITOR_SELECT).eq("listing_id", listingId).maybeSingle();
  return data ?? null;
}

async function keepSnapshot(monitorId, { ok, snapshot = null, error = null }) {
  // The snapshot minus photo lists, which are long and not what a diff needs.
  const normalized = snapshot
    ? { ...snapshot, property: { ...snapshot.property, photos: snapshot.property.photos.length }, units: snapshot.units.map((u) => ({ ...u, photos: u.photos.length })) }
    : null;
  await supabase.from("listing_source_snapshots").insert({
    monitor_id: monitorId,
    ok,
    normalized,
    rollup: snapshot ? summarize(snapshot) : null,
    unit_count: snapshot?.units.length ?? null,
    error: error ? String(error).slice(0, 500) : null,
  });
}

/*
 * Sync one monitor. Returns the digest row for it. Never throws: a failure
 * is recorded on the monitor (with backoff) and returned as status "failed".
 *   force       read even if the fingerprint is unchanged
 *   autoApply   false records every structural change as open (the landlord
 *               reviews them) and applies nothing
 *   onStep      progress text, for a job
 *   knowledge   also read the pages into the listing's knowledge (default)
 */
export async function syncMonitor(m, { force = false, autoApply = null, onStep = () => {}, knowledge = true, email = true, actorId = null } = {}) {
  const listing = m.listings;
  const label = listing.title ?? listing.address;
  const interval = m.check_interval_days || DEFAULT_INTERVAL_DAYS;
  const started = Date.now();
  const baseUrl = getBaseUrl();
  try {
    await ensureAgent(listing.id);
    const snapshot = await readProperty({
      pastedUrl: m.index_url ?? m.source_url,
      target: { name: listing.title ?? listing.address, address: listing.address, url: m.source_url, levelUrl: m.index_url },
      knownPortal: m.portal ?? null,
      onStep,
    });
    if (snapshot.portal) await supabase.from("listing_source_monitors").update({ portal: snapshot.portal }).eq("id", m.id);
    await keepSnapshot(m.id, { ok: true, snapshot });
    const fp = fingerprint(snapshot);
    const unchanged = !force && m.last_fingerprint === fp;
    let result = null;
    if (!unchanged) {
      onStep("Saving");
      result = await applySnapshot({ snapshot, listingId: listing.id, mode: "sync", monitorId: m.id, autoApply: autoApply ?? m.auto_apply !== false, listingLabel: label, userId: actorId });
    }
    let pages = [];
    if (knowledge) {
      onStep("Reading the pages into knowledge");
      const flyers = snapshot.trace?.found?.flyers ?? [];
      // Every page this listing already knows (found by earlier whole-site reads), plus the start page and flyers.
      const { knownPageUrls } = await import("@/lib/agents/pages");
      const known = await knownPageUrls(listing.id).catch(() => []);
      pages = await synthesizePages({ listingId: listing.id, urls: [snapshot.sourceUrl ?? m.source_url, ...flyers, ...known], cause: "sync", actorId, force, maxPages: 50 });
    }
    const status = unchanged ? "unchanged" : result?.holdReason ? "suppressed" : result?.applied.length ? "changed" : "ok";
    await supabase
      .from("listing_source_monitors")
      .update({
        last_checked_at: new Date().toISOString(),
        last_extracted_at: new Date().toISOString(),
        last_status: status,
        last_error: null,
        consecutive_failures: 0,
        last_fingerprint: fp,
        next_check_at: plusDays(interval),
      })
      .eq("id", m.id);
    await supabase.from("listing_agents").update({ last_sync_at: new Date().toISOString() }).eq("listing_id", listing.id);
    const item = {
      listingId: listing.id,
      listing: label,
      status,
      platform: snapshot.platform,
      confidence: snapshot.confidence,
      seconds: Math.round((Date.now() - started) / 1000),
      applied: result?.applied ?? [],
      held: result?.held ?? [],
      holdReason: result?.holdReason ?? null,
      summary: summarize(snapshot),
      pages,
    };
    console.log(`[source-sync] ${label}: ${status} (${snapshot.platform}, ${item.seconds}s, ${pages.filter((p) => p.written).length} page${pages.length === 1 ? "" : "s"} with new knowledge)`);
    return item;
  } catch (err) {
    const code = err instanceof DraftFetchError ? err.code : null;
    const failures = (m.consecutive_failures ?? 0) + 1;
    const message = code ? `fetch failed (${code})` : err?.message ?? "sync failed";
    await keepSnapshot(m.id, { ok: false, error: message });
    await supabase
      .from("listing_source_monitors")
      .update({
        last_checked_at: new Date().toISOString(),
        last_status: code ? "fetch_failed" : "parse_failed",
        last_error: message.slice(0, 500),
        consecutive_failures: failures,
        next_check_at: plusDays(Math.min(interval * (failures + 1), MAX_BACKOFF_DAYS)),
      })
      .eq("id", m.id);
    // The monitored pages share the failure count; after a few in a row their
    // facts are stale. Other page sources (a link from an answer) are not touched.
    await supabase.from("listing_sources").update({ consecutive_failures: failures, last_status: code ? "fetch_failed" : "parse_failed", last_error: message.slice(0, 500), last_checked_at: new Date().toISOString() })
      .eq("listing_id", listing.id).eq("kind", "page").in("url", [m.source_url, m.index_url].filter(Boolean));
    const stale = await markStaleSources(listing.id);
    console.error(`[source-sync] ${label}: ${message}${stale ? ` (${stale} source${stale === 1 ? "" : "s"} now stale)` : ""}`);
    if (email) {
      try {
        await sendSourceSyncFailureEmail({ to: ALERT_TO, listing: label, listingId: listing.id, sourceUrl: m.source_url, error: message, failures, baseUrl });
      } catch (e) {
        console.error("[source-sync] failure email:", e?.message);
      }
    }
    return { listingId: listing.id, listing: label, status: "failed", error: message, failures, applied: [], held: [], pages: [] };
  }
}

/*
 * Run the sync inline, listing after listing. Returns { checked, items }.
 *   listingId  one listing, on demand
 *   force      run it even if not due, muted, or still a draft
 */
export async function runSourceSync({ listingId = null, limit = 30, force = false, email = true } = {}) {
  await ensureMonitors();
  const monitors = await dueMonitors({ listingId, limit, force });
  const items = [];
  for (const m of monitors) items.push(await syncMonitor(m, { force, email }));

  // One digest per run, when there is anything to say.
  const worth = items.filter((i) => i.status !== "unchanged" && i.status !== "ok");
  if (email && worth.length) {
    try {
      await sendSourceSyncDigestEmail({ to: ALERT_TO, items, baseUrl: getBaseUrl() });
    } catch (e) {
      console.error("[source-sync] digest email:", e?.message);
    }
  }
  return { checked: monitors.length, items };
}
