/*
 * Background import jobs.
 *
 * Continue on the picker creates one draft listing per ticked property and
 * one job per draft (createImportBatch). A runner then takes jobs off the
 * queue one at a time (runPendingJobs): it reads the property's pages into a
 * snapshot, records where it was read from, and applies the snapshot to the
 * draft. The workspace polls the job rows and opens each draft in the editor
 * as its job finishes.
 *
 * The runner is started by the route that created the batch (after the
 * response is sent) and again by a cron every couple of minutes, so a job
 * never dies with a function timeout: whatever a run could not finish inside
 * its budget is still queued for the next one.
 *
 * A ticked property the landlord already has on Proximity is not given a
 * draft. Its job reads the site the same way and records every difference as
 * an open change for the landlord to accept on that tab.
 */
import { randomUUID } from "node:crypto";
import supabase from "@/lib/supabase";
import { markAlreadyListed } from "./alreadyListed.js";
import { getBaseUrl } from "@/lib/email";
import { findPropertyNameConflict } from "@/lib/listings/propertyName";
import { fetchAllWalkTimes } from "@/utils/walkTimes";
import { fetchAllDriveTimes } from "@/utils/driveTimes";
import { attachSourceUrl } from "@/lib/sourceSync/attach";
import { claimUnclaimedProperty } from "@/lib/listings/ownership";
import { readProperty, DraftFetchError } from "./read.js";
import { applySnapshot } from "./apply.js";
import { summarize } from "./snapshot.js";

// WashU's Danforth campus, the pin a draft gets when its address will not
// geocode. The listing is a draft, the editor shows the address, and the
// workspace tells the landlord to confirm it before publishing.
const CAMPUS = { latitude: 38.6488, longitude: -90.3108 };
// A running job that has not written a step for this long belongs to a
// function that died (Vercel stops a call at five minutes). Reads write a
// step every page, every quote batch and every model call, so six quiet
// minutes is a dead runner, not a slow site.
const STUCK_AFTER_MS = 6 * 60 * 1000;
// How long a queued job may wait with no runner before a poll starts one.
const IDLE_KICK_MS = 15 * 1000;
/*
 * Buildings of one batch read side by side. Most of a read is waiting on
 * rendered pages, portal quotes and the model, so three at once finish a
 * batch in about a third of the time; more than four would hammer one
 * landlord's site (every building of a batch is on it) and the render
 * service's concurrency limit. IMPORT_LANES tunes it, 1 to 6.
 */
export const IMPORT_LANES = Math.min(6, Math.max(1, Number(process.env.IMPORT_LANES) || 3));

/* Start `lanes` runners for a batch, each working one job and handing off. */
export function runLanes({ batchId = null, userId = null, lanes = IMPORT_LANES }) {
  return Promise.all(
    Array.from({ length: lanes }, () => runPendingJobs({ batchId, userId, maxJobs: 1, budgetMs: 270000 }).catch((e) => console.error("[source-import] runner:", e?.message)))
  );
}
const MAX_ATTEMPTS = 3;
export const MAX_TARGETS = 40;

const FRIENDLY = {
  bad_url: "That property's web address doesn't look valid.",
  unsupported_scheme: "That property's web address isn't a normal http(s) address.",
  private_address: "That web address can't be used here.",
  blocked: "The website's security settings blocked our reader.",
  unreachable: "We couldn't reach that page.",
  timeout: "The website took too long to answer.",
  dns_failed: "That website address doesn't resolve.",
};

async function geocode(address) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token || !address) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&limit=1&country=US`,
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json();
    const f = data.features?.[0];
    if (!f) return null;
    // A street-only address geocodes to a city centre with low relevance;
    // that pin is worse than the campus one, which at least says "unknown".
    if (typeof f.relevance === "number" && f.relevance < 0.6) return null;
    return { latitude: f.center[1], longitude: f.center[0], placeName: f.place_name ?? null };
  } catch {
    return null;
  }
}

/* A name that is free, or the name with the street behind it, or with a tag. */
async function freeTitle(name, address) {
  const street = address && address !== name ? address.split(",")[0].trim() : null;
  const candidates = [name, street ? `${name} (${street})` : null, `${name} ${Math.random().toString(36).slice(2, 6)}`].filter(Boolean);
  for (const t of candidates) {
    if (!(await findPropertyNameConflict(t, { schoolId: null }))) return t;
  }
  return candidates.at(-1);
}

async function createDraft({ userId, user, target }) {
  const name = String(target.name ?? "").trim().slice(0, 120) || String(target.address ?? "").trim().slice(0, 120) || "Imported property";
  const address = String(target.address ?? "").trim().slice(0, 200) || name;
  const geo = await geocode(address);
  const title = await freeTitle(name, address);
  const { data: listingId, error } = await supabase.rpc("rpc_create_listing", {
    p_user_id: userId,
    p_listing_data: {
      title,
      // The picker's address as written. Mapbox's place name says "United
      // States" and spells out the state; the site's fuller address, when it
      // has one, replaces this on apply.
      address,
      longitude: geo?.longitude ?? CAMPUS.longitude,
      latitude: geo?.latitude ?? CAMPUS.latitude,
      description: "",
      lease_type: "standard",
      home_type_id: null,
      lease_structure: null,
      sublease_friendly: false,
      twenty_one_plus: false,
      furnished: false,
      move_in_date: null,
      contact_email: user?.email ?? null,
      contact_phone: user?.phone ?? null,
      contact_name: user?.name ?? null,
      lease_availability: [],
      unavailable: false,
      deleted_at: null,
      draft: true,
    },
    p_amenities: {},
    p_utilities: {},
    p_walk_times: [],
    p_units: [],
    p_lease_availability: null,
    p_custom_amenities: [],
    p_claim_property: true,
  });
  if (error) throw new Error(`create draft: ${error.message}`);
  // The create RPC publishes by default; a draft is born hidden.
  await supabase.from("listings").update({ published_at: null }).eq("id", listingId);
  return { listingId, title, geocoded: !!geo };
}

/*
 * One job per ticked property. Returns { batchId, jobs }.
 * `user` is { name, email, phone } for the draft's contact details.
 */
export async function createImportBatch({ userId, user, pastedUrl, targets, batchId: requested = null }) {
  // The client may choose the id, so it can cancel the batch even if the
  // response creating it never arrives (they left the page mid-way).
  const batchId = typeof requested === "string" && /^[0-9a-f-]{36}$/i.test(requested) ? requested : randomUUID();
  const jobs = [];
  // Ownership is decided here, not by the browser (see alreadyListed.js).
  const checked = await markAlreadyListed(
    targets.slice(0, MAX_TARGETS).map((t) => ({ name: String(t.name ?? ""), address: String(t.address ?? ""), url: t.url ?? null, kind: "property" })),
    userId
  );
  for (const [n, given] of targets.slice(0, MAX_TARGETS).entries()) {
    const raw = { ...given, alreadyListed: checked[n]?.alreadyListed ?? null };
    const target = {
      name: String(raw.name ?? "").slice(0, 200),
      address: String(raw.address ?? "").slice(0, 200),
      url: typeof raw.url === "string" ? raw.url.slice(0, 500) : null,
      levelUrl: typeof raw.levelUrl === "string" ? raw.levelUrl.slice(0, 500) : null,
      pastedUrl,
      alreadyListed: raw.alreadyListed?.id
        ? { id: raw.alreadyListed.id, title: raw.alreadyListed.title ?? null, mine: raw.alreadyListed.mine ?? null, owner: raw.alreadyListed.owner ?? (raw.alreadyListed.mine ? "you" : "other") }
        : null,
    };
    let listingId = null;
    let created = null;
    if (target.alreadyListed?.owner === "none") {
      /*
       * Listed by Proximity with nobody behind it. Ticking it is the same
       * claim a landlord makes by adding units to it by hand (addListing):
       * the record becomes theirs, and the read is laid over it as proposed
       * changes. If the claim is refused (someone else holds a lease there),
       * it is treated as another landlord's.
       */
      const claimed = await claimUnclaimedProperty({ userId, listingId: target.alreadyListed.id });
      if (claimed) {
        listingId = target.alreadyListed.id;
        target.alreadyListed = { ...target.alreadyListed, mine: "owner", owner: "you", claimed: true };
      } else {
        target.alreadyListed = { ...target.alreadyListed, owner: "other" };
        target.skipped = "Already on Proximity under another landlord.";
      }
    } else if (target.alreadyListed?.mine) {
      listingId = target.alreadyListed.id;
    } else if (target.alreadyListed) {
      // Someone else's building: nothing to write to. Recorded so the tab can say so.
      target.skipped = "Already on Proximity under another landlord.";
    } else {
      created = await createDraft({ userId, user, target });
      listingId = created.listingId;
      target.needsAddress = !created.geocoded;
    }
    const { data: job, error } = await supabase
      .from("listing_import_jobs")
      .insert({
        batch_id: batchId,
        user_id: userId,
        listing_id: listingId,
        target,
        status: target.skipped ? "cancelled" : "queued",
        step: target.skipped ? target.skipped : "Waiting to read",
        error: null,
      })
      .select("id, listing_id, target, status, step")
      .single();
    if (error) throw new Error(`job: ${error.message}`);
    jobs.push(job);
  }
  return { batchId, jobs };
}

async function setStep(jobId, step, progress) {
  await supabase.from("listing_import_jobs").update({ step, ...(progress != null ? { progress } : {}), updated_at: new Date().toISOString() }).eq("id", jobId);
}

/* Walk and drive times for a draft created without them. Best-effort. */
async function measureTimes(listingId) {
  const { data: l } = await supabase.from("listings").select("latitude, longitude, listing_walk_times(id)").eq("id", listingId).maybeSingle();
  if (!l || (l.listing_walk_times ?? []).length) return;
  const { data: locations } = await supabase.from("locations").select("id, name");
  if (!locations?.length) return;
  const byName = (key) => locations.find((x) => x.name.toLowerCase() === key.toLowerCase());
  try {
    const { placeWalkMinutes, shuttleWalkMinutes } = await fetchAllWalkTimes(l.latitude, l.longitude);
    const rows = [];
    for (const [key, minutes] of Object.entries(placeWalkMinutes ?? {})) {
      const loc = byName(key);
      if (loc && minutes != null) rows.push({ listing_id: listingId, location_id: loc.id, minutes });
    }
    const shuttle = byName("shuttle_nearest");
    if (shuttle && shuttleWalkMinutes != null) rows.push({ listing_id: listingId, location_id: shuttle.id, minutes: shuttleWalkMinutes });
    if (rows.length) await supabase.from("listing_walk_times").insert(rows);
  } catch (err) {
    console.error("[source-import] walk times:", err?.message);
  }
  try {
    const { placeDriveMinutes } = await fetchAllDriveTimes(l.latitude, l.longitude);
    const rows = [];
    for (const [key, minutes] of Object.entries(placeDriveMinutes ?? {})) {
      const loc = byName(key);
      if (loc && minutes != null) rows.push({ listing_id: listingId, location_id: loc.id, minutes });
    }
    if (rows.length) await supabase.from("listing_drive_times").upsert(rows, { onConflict: "listing_id,location_id" });
  } catch (err) {
    console.error("[source-import] drive times:", err?.message);
  }
}

async function monitorIdFor(listingId) {
  const { data } = await supabase.from("listing_source_monitors").select("id").eq("listing_id", listingId).maybeSingle();
  return data?.id ?? null;
}

/* The landlord's own contact details, for a building they just claimed. */
async function contactFor(userId) {
  const { data } = await supabase.from("users").select("name, email, phone").eq("id", userId).maybeSingle();
  return data ?? null;
}

/* What an earlier read of this listing learned about its leasing portal. */
async function knownPortalFor(listingId) {
  const { data } = await supabase.from("listing_source_monitors").select("portal").eq("listing_id", listingId).maybeSingle();
  return data?.portal ?? null;
}

/* Run one job to completion. Never throws; the job row carries the outcome. */
export async function runJob(jobId) {
  const { data: job } = await supabase.from("listing_import_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job || job.status === "done" || job.status === "cancelled") return job;
  const started = Date.now();
  await supabase
    .from("listing_import_jobs")
    .update({ status: "running", attempts: job.attempts + 1, started_at: new Date().toISOString(), error: null, step: "Reading your website", progress: 5 })
    .eq("id", jobId);

  const target = job.target ?? {};
  const steps = ["Reading your website", "Opening", "Reading floor plans", "Reading live availability", "Reading unit pages", "Reading the leasing portal", "Pricing", "Priced", "Filling in the details", "Sorting photos by unit", "Checking floor plan", "Saving"];
  const onStep = (text) => {
    const i = steps.findIndex((s) => text.startsWith(s));
    const progress = i >= 0 ? Math.round(10 + (i / steps.length) * 70) : null;
    setStep(jobId, text, progress).catch(() => {});
  };

  try {
    if (!job.listing_id) throw new Error("This property has nothing to import into.");
    const { data: listing } = await supabase.from("listings").select("id, title, address, published_at").eq("id", job.listing_id).maybeSingle();
    if (!listing) throw new Error("The draft for this property no longer exists.");

    const snapshot = await readProperty({
      pastedUrl: target.pastedUrl,
      target: { name: target.name, address: target.address, url: target.url, levelUrl: target.levelUrl },
      onStep,
      // A listing that was read before: price only the apartments that moved.
      knownPortal: await knownPortalFor(listing.id),
    });

    // Cancelled while the site was being read: write nothing.
    const { data: still } = await supabase.from("listing_import_jobs").select("status").eq("id", jobId).maybeSingle();
    if (still?.status === "cancelled") {
      console.log(`[source-import] job ${jobId} cancelled during the read; nothing applied`);
      return still;
    }
    await setStep(jobId, "Saving", 82);
    const attached = await attachSourceUrl({ listingId: listing.id, rawUrl: snapshot.sourceUrl, indexUrl: snapshot.indexUrl, userId: job.user_id, portal: snapshot.portal ?? null });
    const monitorId = attached.ok ? await monitorIdFor(listing.id) : null;
    const mode = listing.published_at ? "sync" : "import";
    const result = await applySnapshot({
      snapshot,
      listingId: listing.id,
      userId: job.user_id,
      mode,
      monitorId,
      // An existing listing is reviewed before anything changes.
      autoApply: mode === "import",
      listingLabel: listing.title ?? listing.address,
      takeover: target.alreadyListed?.claimed ? { contact: await contactFor(job.user_id) } : null,
    });

    if (mode === "import") {
      await setStep(jobId, "Measuring walk times", 92);
      await measureTimes(listing.id);
    }

    const summary = summarize(snapshot);
    await supabase
      .from("listing_import_jobs")
      .update({
        status: "done",
        step: mode === "import" ? "Ready to check" : `${result.held.length} proposed change${result.held.length === 1 ? "" : "s"}`,
        progress: 100,
        finished_at: new Date().toISOString(),
        result: {
          mode,
          platform: snapshot.platform,
          model: snapshot.model ?? null,
          confidence: snapshot.confidence,
          sourceUrl: snapshot.sourceUrl,
          summary,
          notes: snapshot.notes,
          applied: result.applied.length,
          held: result.held.length,
          holdReason: result.holdReason,
          seconds: Math.round((Date.now() - started) / 1000),
          // What was read and where it came from, for anyone debugging a read.
          trace: { ...(snapshot.trace ?? {}), photosStored: result.applied.filter((c) => c.kind === "photos_added" || c.kind === "unit_new").map((c) => c.note).filter(Boolean) },
        },
      })
      .eq("id", jobId);
    console.log(`[source-import] job ${jobId} done in ${Math.round((Date.now() - started) / 1000)}s: ${JSON.stringify(summary)}`);
  } catch (err) {
    const code = err instanceof DraftFetchError ? err.code : null;
    const message = (code && FRIENDLY[code]) || (code ? FRIENDLY.unreachable : err?.message) || "Something went wrong reading this property.";
    console.error(`[source-import] job ${jobId} failed:`, err?.message);
    await supabase
      .from("listing_import_jobs")
      .update({ status: "failed", step: "Couldn't read it", error: message.slice(0, 500), finished_at: new Date().toISOString() })
      .eq("id", jobId);
  }
  const { data: fresh } = await supabase.from("listing_import_jobs").select("*").eq("id", jobId).maybeSingle();
  return fresh;
}

/*
 * Take queued jobs in order until the time budget is spent. One at a time:
 * each read is a minute or two of fetches and model calls, and the render
 * services rate-limit bursts. Returns how many ran.
 */
export async function runPendingJobs({ batchId = null, userId = null, budgetMs = 240000, maxJobs = Infinity } = {}) {
  const started = Date.now();
  let ran = 0;
  for (;;) {
    if (ran >= maxJobs || Date.now() - started > budgetMs) {
      // Out of room in this call: a fresh call takes the rest, so a batch of
      // twelve buildings is twelve five-minute windows, not one.
      if (await hasQueued({ batchId, userId })) await chainRunner({ batchId });
      break;
    }
    let q = supabase.from("listing_import_jobs").select("id").eq("status", "queued").order("created_at", { ascending: true }).limit(1);
    if (batchId) q = q.eq("batch_id", batchId);
    if (userId) q = q.eq("user_id", userId);
    const { data } = await q;
    const next = data?.[0];
    if (!next) break;
    // Claim it. A second runner (the cron, say) that loses the race skips it.
    const { data: claimed } = await supabase
      .from("listing_import_jobs")
      .update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", next.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed?.length) continue;
    await runJob(next.id);
    ran += 1;
  }
  return ran;
}

async function hasQueued({ batchId = null, userId = null } = {}) {
  let q = supabase.from("listing_import_jobs").select("id").eq("status", "queued").limit(1);
  if (batchId) q = q.eq("batch_id", batchId);
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q;
  return !!data?.length;
}

/*
 * Ask a new function call to carry on with the queue. The run route answers
 * at once and does the work after the response, so this returns in well
 * under a second and the two calls never nest. Needs CRON_SECRET; without
 * it (or if the call fails) the next workspace poll or the cron picks the
 * queue up instead.
 */
export async function chainRunner({ batchId = null } = {}) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  try {
    const res = await fetch(`${getBaseUrl()}/api/landlord/import/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ batchId, chain: true }),
      signal: AbortSignal.timeout(15000),
    });
    console.log(`[source-import] runner handed the queue to a new call (${res.status})`);
    return res.ok;
  } catch (err) {
    console.error("[source-import] runner hand-off failed:", err?.message);
    return false;
  }
}

/*
 * The batch's poll keeps the queue alive: a job whose runner died goes back
 * to the queue, and a queue nobody is working gets a runner. Returns true
 * when a runner was started so the caller can hand it to after().
 */
export async function keepBatchMoving({ batchId, userId }) {
  await requeueStuck({ batchId });
  const { data: jobs } = await supabase.from("listing_import_jobs").select("status, updated_at, created_at").eq("batch_id", batchId).eq("user_id", userId);
  const queued = (jobs ?? []).filter((j) => j.status === "queued").length;
  const running = (jobs ?? []).filter((j) => j.status === "running").length;
  // Lanes short of the batch's count, with work waiting: top them up once
  // the queue has sat still a moment (a hand-off may be on its way).
  const missing = Math.min(queued, IMPORT_LANES - running);
  if (missing <= 0) return 0;
  const newest = Math.max(...(jobs ?? []).map((j) => new Date(j.updated_at ?? j.created_at).getTime()));
  return Date.now() - newest > IDLE_KICK_MS ? missing : 0;
}

/* Jobs a dead function left running: back to the queue, or failed for good. */
export async function requeueStuck({ batchId = null } = {}) {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  let q = supabase.from("listing_import_jobs").select("id, attempts").eq("status", "running").lt("updated_at", cutoff);
  if (batchId) q = q.eq("batch_id", batchId);
  const { data: stuck } = await q;
  for (const j of stuck ?? []) {
    if (j.attempts >= MAX_ATTEMPTS) {
      await supabase.from("listing_import_jobs").update({ status: "failed", step: "Couldn't read it", error: "The read kept timing out. Try again, or fill it in by hand." }).eq("id", j.id);
    } else {
      await supabase.from("listing_import_jobs").update({ status: "queued", step: "Waiting to read", started_at: null, updated_at: new Date().toISOString() }).eq("id", j.id);
    }
  }
  return (stuck ?? []).length;
}

/* The batch as the workspace sees it. */
export async function loadBatch({ batchId, userId }) {
  const { data: jobs } = await supabase
    .from("listing_import_jobs")
    .select("id, listing_id, target, status, step, progress, attempts, error, result, created_at, finished_at")
    .eq("batch_id", batchId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (!jobs?.length) return null;
  const ids = jobs.map((j) => j.listing_id).filter(Boolean);
  const { data: listings } = ids.length
    ? await supabase.from("listings").select("id, title, address, published_at, deleted_at").in("id", ids)
    : { data: [] };
  const byId = new Map((listings ?? []).map((l) => [l.id, l]));
  return {
    batchId,
    // How many buildings are read at once, for the workspace's progress line.
    lanes: IMPORT_LANES,
    pastedUrl: jobs[0]?.target?.pastedUrl ?? null,
    jobs: jobs.map((j) => {
      const l = byId.get(j.listing_id);
      return {
        ...j,
        listing: l ? { id: l.id, title: l.title, address: l.address, isDraft: l.published_at === null, deleted: !!l.deleted_at } : null,
      };
    }),
  };
}

/*
 * Stop a batch the landlord walked away from. Unfinished jobs (queued or
 * running) are cancelled and the drafts created for them deleted; a job
 * that already finished keeps its draft. `all` also deletes the finished
 * drafts (leaving page A before the workspace ever opened).
 */
export async function cancelBatch({ batchId, userId, all = false }) {
  const { data: jobs } = await supabase
    .from("listing_import_jobs")
    .select("id, status, listing_id, target")
    .eq("batch_id", batchId)
    .eq("user_id", userId);
  const doomed = (jobs ?? []).filter((j) => (all ? j.status !== "cancelled" : ["queued", "running"].includes(j.status)));
  if (!doomed.length) return { cancelled: 0, deleted: 0 };
  await supabase
    .from("listing_import_jobs")
    .update({ status: "cancelled", step: "Cancelled: you left the import", finished_at: new Date().toISOString() })
    .in("id", doomed.map((j) => j.id));
  // Only drafts this import created. A building that already existed (the
  // landlord's own, or one they claimed) is never deleted here.
  const draftIds = doomed.filter((j) => j.listing_id && !j.target?.alreadyListed).map((j) => j.listing_id);
  let deleted = 0;
  if (draftIds.length) {
    const { data } = await supabase
      .from("listings")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", draftIds)
      .is("published_at", null)
      .is("deleted_at", null)
      .select("id");
    deleted = data?.length ?? 0;
  }
  console.log(`[source-import] batch ${batchId} cancelled: ${doomed.length} jobs, ${deleted} drafts deleted`);
  return { cancelled: doomed.length, deleted };
}
