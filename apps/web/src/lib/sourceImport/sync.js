/*
 * The recurring source sync.
 *
 * Every published listing with a source URL has a monitor row saying when it
 * is next due. On each run the due ones are read the same way an import reads
 * them (readProperty), the snapshot is kept, and if anything about the units
 * or prices changed the snapshot is applied under the sync rules in apply.js.
 * What was applied and what was held is summarised in one digest email per
 * run; a read that failed outright gets its own email right away.
 *
 * The interval lives on the monitor (check_interval_days, default 7), so
 * moving a landlord, or everyone, to daily is a column update rather than a
 * deploy. The admin trigger runs one listing on demand regardless of when it
 * is due.
 */
import supabase from "@/lib/supabase";
import { getBaseUrl, sendSourceSyncDigestEmail, sendSourceSyncFailureEmail } from "@/lib/email";
import { sourceKindEnabled } from "@/lib/sourceSync/classify";
import { readProperty, DraftFetchError } from "./read.js";
import { applySnapshot } from "./apply.js";
import { fingerprint, summarize } from "./snapshot.js";

export const ALERT_TO = (process.env.SOURCE_SYNC_ALERT_EMAIL || "info@useproximity.org,o.wyatt@wustl.edu")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DEFAULT_INTERVAL_DAYS = 7;
const MAX_BACKOFF_DAYS = 14;

const plusDays = (days) => new Date(Date.now() + days * 86400000).toISOString();

/*
 * A published listing with a source URL and no monitor row gets one. The 36
 * prod listings whose source URLs were set by hand before any sync existed
 * are the case: nothing ever wrote their monitors.
 */
async function ensureMonitors() {
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

async function dueMonitors({ listingId, limit, force }) {
  let q = supabase
    .from("listing_source_monitors")
    .select("id, listing_id, source_url, source_kind, index_url, enabled, auto_apply, check_interval_days, next_check_at, consecutive_failures, muted_until, last_fingerprint, portal, listings!listing_id(id, title, address, published_at, deleted_at)")
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
 * Run the sync. Returns { checked, items } where items are the digest rows.
 *   listingId  one listing, on demand
 *   force      run it even if not due, muted, or still a draft
 */
export async function runSourceSync({ listingId = null, limit = 30, force = false, email = true } = {}) {
  await ensureMonitors();
  const monitors = await dueMonitors({ listingId, limit, force });
  const items = [];
  const baseUrl = getBaseUrl();

  for (const m of monitors) {
    const listing = m.listings;
    const label = listing.title ?? listing.address;
    const interval = m.check_interval_days || DEFAULT_INTERVAL_DAYS;
    const started = Date.now();
    try {
      const snapshot = await readProperty({
        pastedUrl: m.index_url ?? m.source_url,
        target: { name: listing.title ?? listing.address, address: listing.address, url: m.source_url, levelUrl: m.index_url },
        knownPortal: m.portal ?? null,
      });
      if (snapshot.portal) await supabase.from("listing_source_monitors").update({ portal: snapshot.portal }).eq("id", m.id);
      await keepSnapshot(m.id, { ok: true, snapshot });
      const fp = fingerprint(snapshot);
      const unchanged = !force && m.last_fingerprint === fp;
      let result = null;
      if (!unchanged) {
        result = await applySnapshot({ snapshot, listingId: listing.id, mode: "sync", monitorId: m.id, autoApply: m.auto_apply !== false, listingLabel: label });
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
      items.push({
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
      });
      console.log(`[source-sync] ${label}: ${status} (${snapshot.platform}, ${Math.round((Date.now() - started) / 1000)}s)`);
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
      items.push({ listingId: listing.id, listing: label, status: "failed", error: message, applied: [], held: [] });
      console.error(`[source-sync] ${label}: ${message}`);
      if (email) {
        try {
          await sendSourceSyncFailureEmail({ to: ALERT_TO, listing: label, listingId: listing.id, sourceUrl: m.source_url, error: message, failures, baseUrl });
        } catch (e) {
          console.error("[source-sync] failure email:", e?.message);
        }
      }
    }
  }

  // One digest per run, when there is anything to say.
  const worth = items.filter((i) => i.status !== "unchanged" && i.status !== "ok");
  if (email && worth.length) {
    try {
      await sendSourceSyncDigestEmail({ to: ALERT_TO, items, baseUrl });
    } catch (e) {
      console.error("[source-sync] digest email:", e?.message);
    }
  }
  return { checked: monitors.length, items };
}
