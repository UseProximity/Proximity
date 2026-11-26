/*
 * Seeding an agent from what the app already knows (PRD v3, milestone 1).
 *
 * Every live listing gets an agent row and a 'site_data' source. Then the
 * typed tables nothing in the app reads today become facts:
 *
 *   listing_fees           -> fees.fee.<type>, one fact per fee type, with
 *                             several rows of one type folded into one fact
 *   listing_pet_policies   -> policies.policy.pets
 *   listing_concessions    -> specials.special.<id>, active and unexpired only
 *   listings.last_verified -> core.verified, so Proxy can say when the
 *                             displayed details were last checked
 *   the description and lease notes -> facts read by the model, kept even
 *                             when the text later changes (readDescriptions)
 *
 * Each row's last_verified_source becomes an 'admin' source (the team's hand
 * curation, with the note it left), so every seeded fact says where it came
 * from. Rows with no note fall back to the site-data source.
 *
 * All of today's data counts as public data, not landlord-set (Wyatt,
 * 2026-10-26), so a later sync may update it without asking.
 *
 * Idempotent: running it again changes nothing unless the typed tables did.
 */
import supabase from "@/lib/supabase";
import { ensureAgent, ensureSiteDataSource, findOrCreateSource, setFact } from "./store";
import { feeSummary, specialSummary, shortDate, todayChicago, cleanText, slugify } from "./sections";

const fail = (where, error) => new Error(`${where}: ${error.message}`);

async function adminSource(cache, listingId, note, userId = null) {
  const label = cleanText(note || "").slice(0, 240);
  if (!label) return null;
  const key = `${label}|${userId ?? ""}`;
  if (!cache.has(key)) {
    cache.set(key, await findOrCreateSource({ listingId, kind: "admin", label, userId }));
  }
  return cache.get(key);
}

export async function seedListing(listingId, { cause = "seed", actorId = null } = {}) {
  const { data: listing, error } = await supabase
    .from("listings")
    .select("id, deleted_at, last_verified_at, last_verified_by, last_verified_source, updated_at")
    .eq("id", listingId)
    .maybeSingle();
  if (error) throw fail("listing", error);
  if (!listing || listing.deleted_at) return { skipped: "deleted" };

  const [{ data: fees, error: e1 }, { data: pets, error: e2 }, { data: specials, error: e3 }] = await Promise.all([
    supabase.from("listing_fees")
      .select("id, amount, basis, conditions, refundable, notes, updated_at, last_verified_at, last_verified_source, fee_types!fee_type_id(name)")
      .eq("listing_id", listingId),
    supabase.from("listing_pet_policies").select("policy_text, updated_at, last_verified_at, last_verified_source").eq("listing_id", listingId),
    supabase.from("listing_concessions")
      .select("id, listing_lease_id, description, amount, amount_type, conditions, valid_from, valid_until, active, updated_at, last_verified_at, last_verified_source")
      .eq("listing_id", listingId),
  ]);
  if (e1) throw fail("fees", e1);
  if (e2) throw fail("pet policies", e2);
  if (e3) throw fail("concessions", e3);

  await ensureAgent(listingId);
  const site = await ensureSiteDataSource(listingId);
  const admins = new Map();
  const counts = { written: 0, unchanged: 0, held: 0 };
  const tally = (r) => { if (r.held) counts.held++; else if (r.changed) counts.written++; else counts.unchanged++; };
  const sourceFor = async (note, userId = null) => (await adminSource(admins, listingId, note, userId)) ?? site;

  // When the team last checked the displayed details.
  if (listing.last_verified_at) {
    const src = await sourceFor(listing.last_verified_source, listing.last_verified_by);
    tally(await setFact({
      listingId, section: "core", fieldKey: "core.verified",
      value: { verified_at: listing.last_verified_at, verified_by: listing.last_verified_by ?? null },
      summary: `Listing details were checked by Proximity on ${shortDate(listing.last_verified_at)}`,
      sourceId: src.id, sourceRef: src.label ?? null, observedAt: listing.last_verified_at, cause, actorId,
    }));
  }

  // Fees, one fact per type.
  const byType = new Map();
  for (const f of fees ?? []) {
    const name = f.fee_types?.name;
    if (!name) continue;
    if (!byType.has(name)) byType.set(name, []);
    byType.get(name).push(f);
  }
  for (const [name, rows] of byType) {
    rows.sort((a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0));
    const items = rows.map((f) => ({
      amount: f.amount == null ? null : Number(f.amount), basis: f.basis ?? "flat",
      refundable: f.refundable ?? null, conditions: f.conditions ?? null, notes: f.notes ?? null,
    }));
    const latest = rows.reduce((m, f) => (f.last_verified_at && (!m || f.last_verified_at > m) ? f.last_verified_at : m), null);
    const note = rows.map((f) => f.last_verified_source).find(Boolean) ?? listing.last_verified_source;
    const src = await sourceFor(note);
    tally(await setFact({
      listingId, section: "fees", fieldKey: `fee.${name}`, value: { type: name, items },
      summary: feeSummary(name, items), sourceId: src.id, sourceRef: src.label ?? null,
      observedAt: latest ?? rows[0].updated_at, cause, actorId,
    }));
  }

  // Pet policy text.
  for (const p of pets ?? []) {
    const text = cleanText(p.policy_text || "");
    if (!text) continue;
    const src = await sourceFor(p.last_verified_source ?? listing.last_verified_source);
    tally(await setFact({
      listingId, section: "policies", fieldKey: "policy.pets", value: { text },
      summary: text.length > 400 ? text.slice(0, 397).replace(/\s+\S*$/, "") + "..." : text,
      sourceId: src.id, sourceRef: src.label ?? null, observedAt: p.last_verified_at ?? p.updated_at, cause, actorId,
    }));
  }

  // Specials: active and not yet expired. Expired ones are history, not facts.
  const today = todayChicago();
  for (const c of specials ?? []) {
    if (!c.active) continue;
    if (c.valid_until && c.valid_until < today) continue;
    const src = await sourceFor(c.last_verified_source ?? listing.last_verified_source);
    tally(await setFact({
      listingId, section: "specials", fieldKey: `special.${slugify(c.id.slice(0, 8))}`,
      value: {
        description: cleanText(c.description), amount: c.amount == null ? null : Number(c.amount),
        amount_type: c.amount_type ?? null, conditions: c.conditions ? cleanText(c.conditions) : null,
        concession_id: c.id,
      },
      summary: specialSummary(c), scopeLevel: c.listing_lease_id ? "lease" : "property",
      scopeId: c.listing_lease_id ?? null, sourceId: src.id, sourceRef: src.label ?? null,
      observedAt: c.last_verified_at ?? c.updated_at, validFrom: c.valid_from ?? null, validUntil: c.valid_until ?? null,
      cause, actorId,
    }));
  }

  // The description and each lease's note become knowledge too (Wyatt,
  // 2026-10-27). Read again only when the text changed (fingerprint on the
  // source), and never retired by a change: what was said stays until the
  // landlord deletes it.
  try {
    const desc = await readDescriptions({ listingId, cause, actorId });
    counts.written = (counts.written ?? 0) + (desc.written ?? 0);
  } catch (err) {
    console.error("[agents] description read failed:", err?.message ?? err);
  }

  await supabase.from("listing_agents").update({ seeded_at: new Date().toISOString() }).eq("listing_id", listingId);
  return counts;
}

async function readDescriptions({ listingId, cause, actorId }) {
  const [{ data: l }, { data: units }] = await Promise.all([
    supabase.from("listings").select("description").eq("id", listingId).maybeSingle(),
    supabase.from("listing_units").select("name, unit_leases(description, deleted_at)").eq("listing_id", listingId).is("deleted_at", null),
  ]);
  const parts = [];
  if (cleanText(l?.description ?? "")) parts.push(`Property description:\n${cleanText(l.description)}`);
  for (const u of units ?? []) {
    for (const ul of u.unit_leases ?? []) {
      if (!ul.deleted_at && cleanText(ul.description ?? "")) parts.push(`Note on a listing for ${u.name || "a unit"}:\n${cleanText(ul.description)}`);
    }
  }
  const text = parts.join("\n\n").slice(0, 12000);
  if (!text) return { written: 0 };
  const { createHash } = await import("crypto");
  const fingerprint = createHash("sha256").update(text).digest("hex");
  const source = await findOrCreateSource({ listingId, kind: "description", label: "Your listing description" });
  if (source.last_fingerprint === fingerprint) return { written: 0, unchanged: true };
  const { synthesizeKnowledge } = await import("./synthesize");
  const r = await synthesizeKnowledge({ listingId, text, sourceKind: "description", sourceId: source.id, sourceRef: "description", cause, actorId, noRetire: true });
  await supabase.from("listing_sources").update({ last_fingerprint: fingerprint, last_checked_at: new Date().toISOString(), last_status: "changed" }).eq("id", source.id);
  return r;
}

/*
 * Every live listing, a few at a time (each listing is several round trips,
 * and a serverless route has 300 seconds). Returns the totals and any listing
 * that failed. With onlyUnseeded, a second call picks up where a timed-out
 * one stopped.
 */
export async function seedAll({ onlyUnseeded = false, limit = null, concurrency = 8 } = {}) {
  const totals = { listings: 0, written: 0, unchanged: 0, held: 0, failed: [] };
  const { data, error } = await supabase
    .from("listings").select("id").is("deleted_at", null).order("created_at", { ascending: true }).limit(10000);
  if (error) throw fail("listings", error);
  let ids = (data ?? []).map((r) => r.id);
  if (onlyUnseeded && ids.length) {
    const { data: done } = await supabase
      .from("listing_agents").select("listing_id").not("seeded_at", "is", null).limit(10000);
    const seeded = new Set((done ?? []).map((r) => r.listing_id));
    ids = ids.filter((id) => !seeded.has(id));
  }
  if (limit) ids = ids.slice(0, limit);

  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const c = await seedListing(id);
        if (c.skipped) continue;
        totals.listings++; totals.written += c.written; totals.unchanged += c.unchanged; totals.held += c.held;
      } catch (err) {
        totals.failed.push({ listingId: id, error: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length || 1) }, worker));
  return totals;
}
