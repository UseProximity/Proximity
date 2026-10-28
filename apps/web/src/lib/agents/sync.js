/*
 * The daily per-agent sync (PRD v3, milestone 6).
 *
 * One daily run queues every due listing's sync as its own job in the
 * importer's job table; the 2-minute import-jobs cron runs them in lanes, so
 * agents run in parallel and fail independently. Each job re-reads only its
 * own listing's pages (lib/sourceImport/sync.js syncMonitor) and then reads
 * those pages into the listing's knowledge.
 *
 * "Sync now" queues the same job for one listing, capped per agent per day.
 * Adding a URL to a live listing queues a job that proposes rather than
 * applies: the displayed-field changes wait for the landlord (open events),
 * and the pages' fees, policies and specials go into knowledge at once.
 */
import { randomUUID } from "crypto";
import supabase from "@/lib/supabase";
import { ensureMonitors, dueMonitors, monitorFor, syncMonitor } from "@/lib/sourceImport/sync";
import { attachSourceUrl } from "@/lib/sourceSync/attach";
import { agentsEnabled } from "./flags";
import { ensureAgent, getAgent } from "./store";
import { PROXY_USER_ID } from "./threads";

export const MANUAL_SYNCS_PER_DAY = Number(process.env.AGENT_MANUAL_SYNCS_PER_DAY) || 3;

const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

/* Already queued or running for this listing? Then do not queue another. */
async function openSyncJob(listingId) {
  const { data } = await supabase.from("listing_import_jobs").select("id, status, batch_id").eq("listing_id", listingId)
    .in("status", ["queued", "running"]).limit(5);
  return (data ?? []).find((j) => j) ?? null;
}

export async function enqueueSync({ listingId, userId = null, batchId = null, propose = false, url = null, force = false }) {
  const m = url ? null : await monitorFor(listingId);
  if (!url && !m) return { error: "This listing has no website to sync from.", status: 409 };
  const existing = await openSyncJob(listingId);
  if (existing) return { job: existing, already: true };
  const { data: listing } = await supabase.from("listings").select("id, title, address").eq("id", listingId).maybeSingle();
  if (!listing) return { error: "Listing not found", status: 404 };
  const { data: job, error } = await supabase.from("listing_import_jobs").insert({
    batch_id: batchId ?? randomUUID(),
    user_id: userId ?? PROXY_USER_ID,
    listing_id: listingId,
    target: {
      sync: true, propose, force, name: listing.title, address: listing.address,
      url: url ?? m.source_url, levelUrl: url ? null : m.index_url, pastedUrl: url ?? m.index_url ?? m.source_url,
    },
    status: "queued", step: "Queued for sync", progress: 0,
  }).select("id, status, batch_id").single();
  if (error) return { error: error.message, status: 500 };
  return { job };
}

/* The daily batch: every due monitor becomes a job. Returns the counts. */
export async function runDailyBatch({ limit = 500 } = {}) {
  if (!agentsEnabled()) return { skipped: "agents off" };
  await ensureMonitors();
  const monitors = await dueMonitors({ limit });
  const batchId = randomUUID();
  let queued = 0;
  let already = 0;
  for (const m of monitors) {
    const r = await enqueueSync({ listingId: m.listing_id, batchId });
    if (r.job && !r.already) queued++;
    else if (r.already) already++;
  }
  return { due: monitors.length, queued, already, batchId };
}

/* "Sync now" from a landlord's or admin's dashboard. */
export async function manualSync({ listingId, userId, isAdmin = false }) {
  if (!agentsEnabled()) return { error: "Agents are not enabled yet.", status: 404 };
  const agent = await ensureAgent(listingId);
  // A sync already waiting or running: hand it back without spending a sync.
  const open = await openSyncJob(listingId);
  if (open) return { job: open, already: true };
  if (!isAdmin) {
    const day = todayKey();
    const used = agent.manual_sync_day === day ? agent.manual_syncs_today : 0;
    if (used >= MANUAL_SYNCS_PER_DAY) return { error: `You can sync ${MANUAL_SYNCS_PER_DAY} times a day. Try again tomorrow.`, status: 429 };
    await supabase.from("listing_agents").update({ manual_sync_day: day, manual_syncs_today: used + 1, last_manual_sync_at: new Date().toISOString() }).eq("listing_id", listingId);
  }
  return enqueueSync({ listingId, userId, force: true });
}

/*
 * A landlord adds a URL to a live listing. The URL is attached as the
 * listing's source (monitor + listings.source_url) and a proposing job is
 * queued; nothing displayed changes until the landlord confirms the open
 * events in the Agent tab.
 */
export async function addUrl({ listingId, url, userId }) {
  if (!agentsEnabled()) return { error: "Agents are not enabled yet.", status: 404 };
  const attached = await attachSourceUrl({ listingId, rawUrl: url, userId });
  if (!attached.ok) return { error: attached.reason === "bad_url" ? "That doesn't look like a website address." : "Could not attach that URL.", status: 400 };
  await ensureAgent(listingId);
  return enqueueSync({ listingId, userId, propose: true, force: true });
}

/* Runs inside the import job runner for a job whose target.sync is true. */
export async function runSyncJob(job, { onStep = () => {} } = {}) {
  const target = job.target ?? {};
  const m = await monitorFor(job.listing_id);
  if (!m) throw new Error("This listing has no website to sync from.");
  const item = await syncMonitor(m, {
    force: !!target.force, autoApply: target.propose ? false : null, onStep, email: false,
    actorId: job.user_id === PROXY_USER_ID ? null : job.user_id,
  });
  if (item.status === "failed") throw new Error(item.error);
  return item;
}

/*
 * How long this listing's syncs usually take, from its last few (Wyatt,
 * 2026-10-27): the median of their run times, or a default for a first run.
 */
async function syncEstimate(listingId, thorough) {
  const { data } = await supabase.from("listing_import_jobs").select("result").eq("listing_id", listingId).eq("status", "done")
    .not("result->seconds", "is", null).order("created_at", { ascending: false }).limit(5);
  const secs = (data ?? []).map((j) => Number(j.result?.seconds)).filter((n) => n > 0).sort((a, b) => a - b);
  if (!secs.length) return thorough ? 300 : 120;
  return secs[Math.floor(secs.length / 2)];
}

export async function agentSyncStatus(listingId) {
  const [agent, m, job] = await Promise.all([getAgent(listingId), monitorFor(listingId), openSyncJob(listingId)]);
  const { data: running } = job ? await supabase.from("listing_import_jobs").select("id, status, step, progress, created_at, updated_at").eq("id", job.id).maybeSingle() : { data: null };
  return {
    estimateSeconds: await syncEstimate(listingId, true),
    job: running ? { id: running.id, status: running.status, step: running.step, progress: running.progress, startedAt: running.created_at } : null,
    agent, hasSource: !!m, sourceUrl: m?.source_url ?? null, lastStatus: m?.last_status ?? null, lastCheckedAt: m?.last_checked_at ?? null, nextCheckAt: m?.next_check_at ?? null,
    failures: m?.consecutive_failures ?? 0, running: job ? { id: job.id, status: job.status } : null,
    manualLeft: agent ? Math.max(0, MANUAL_SYNCS_PER_DAY - (agent.manual_sync_day === todayKey() ? agent.manual_syncs_today : 0)) : MANUAL_SYNCS_PER_DAY,
  };
}
