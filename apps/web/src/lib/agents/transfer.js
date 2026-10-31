/*
 * Moving every existing listing into the agents' knowledge base (Wyatt,
 * 2026-10-31), the step before launch: seed each listing's agent from what
 * the app already stores (seed.js), read old landlord chats into it
 * (backfill.js), and report what each listing ended up with.
 *
 * The report is read-only and cheap, so it doubles as the dry run: before
 * anything is written it shows how many listings still need seeding, what
 * that will roughly cost, and which listings need a human (no contact, no
 * lease, nothing known). Seeding and backfilling run in batches the admin page
 * repeats until nothing remains; both skip finished work, so a stopped run
 * simply continues. Agents stay switched off for students throughout.
 */
import supabase from "@/lib/supabase";
import { seedListing } from "./seed";

// Reading a description into facts is one Sonnet call, roughly 1 cent.
const DESCRIPTION_CENTS = 1;

async function all(table, select, build = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(supabase.from(table).select(select)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function transferReport() {
  const [listings, agents, facts, units, leases, backfills] = await Promise.all([
    all("listings", "id, title, address, contact_email, description, source_url", (q) => q.not("published_at", "is", null).is("deleted_at", null)),
    all("listing_agents", "listing_id, status, seeded_at, sources_searched_at"),
    all("listing_facts", "listing_id", (q) => q.eq("is_current", true)),
    all("listing_units", "id, listing_id"),
    all("unit_leases", "unit_id, sublease, unavailable, owner_id, contact_email", (q) => q.is("deleted_at", null)),
    all("listing_sources", "listing_id", (q) => q.eq("kind", "chat_backfill")),
  ]);

  const agentBy = new Map(agents.map((a) => [a.listing_id, a]));
  const factCount = new Map();
  for (const f of facts) factCount.set(f.listing_id, (factCount.get(f.listing_id) ?? 0) + 1);
  const unitListing = new Map(units.map((u) => [u.id, u.listing_id]));
  const leaseInfo = new Map();
  for (const l of leases) {
    const id = unitListing.get(l.unit_id);
    if (!id) continue;
    const i = leaseInfo.get(id) ?? { total: 0, live: 0, sublease: 0, contact: 0 };
    i.total++;
    if (!l.unavailable) i.live++;
    if (l.sublease) i.sublease++;
    if (l.owner_id || l.contact_email) i.contact++;
    leaseInfo.set(id, i);
  }
  const chats = new Map();
  for (const s of backfills) chats.set(s.listing_id, (chats.get(s.listing_id) ?? 0) + 1);

  const rows = listings.map((l) => {
    const a = agentBy.get(l.id);
    const li = leaseInfo.get(l.id) ?? { total: 0, live: 0, sublease: 0, contact: 0 };
    const flags = [];
    if (!li.live) flags.push("no live lease");
    if (li.live && !li.contact && !l.contact_email) flags.push("no one to send questions to");
    if (a?.seeded_at && !factCount.get(l.id)) flags.push("seeded, nothing known");
    if (li.total && li.sublease === li.total) flags.push("sublease only");
    return {
      listingId: l.id,
      name: l.title || String(l.address ?? "").split(",")[0],
      seeded: !!a?.seeded_at,
      status: a?.status ?? "none",
      facts: factCount.get(l.id) ?? 0,
      leases: li.live,
      chatsRead: chats.get(l.id) ?? 0,
      sourcesSearched: !!a?.sources_searched_at,
      hasDescription: !!String(l.description ?? "").trim(),
      flags,
    };
  });

  const unseeded = rows.filter((r) => !r.seeded);
  const count = (f) => rows.filter((r) => r.flags.includes(f)).length;
  return {
    totals: {
      listings: rows.length,
      seeded: rows.length - unseeded.length,
      unseeded: unseeded.length,
      withFacts: rows.filter((r) => r.facts > 0).length,
      facts: facts.length,
      sourcesSearched: rows.filter((r) => r.sourcesSearched).length,
      estimatedSeedCostCents: unseeded.filter((r) => r.hasDescription).length * DESCRIPTION_CENTS,
      flagged: {
        noLiveLease: count("no live lease"),
        noContact: count("no one to send questions to"),
        nothingKnown: count("seeded, nothing known"),
        subleaseOnly: count("sublease only"),
      },
    },
    rows: rows.sort((a, b) => b.flags.length - a.flags.length || a.facts - b.facts),
  };
}

/*
 * One batch of a full seeding pass. `since` is when the pass started: every
 * published listing not seeded since then is (re)seeded, so a pass covers
 * listings seeded before description reading existed, and a stopped pass
 * continues where it was. Seeding is idempotent; a description already read
 * is not read (or paid for) again. `remaining` > 0: call again.
 */
export async function seedBatch({ since, limit = 15, concurrency = 5 } = {}) {
  const cutoff = since ? new Date(since).toISOString() : new Date(0).toISOString();
  const [listings, agents] = await Promise.all([
    all("listings", "id", (q) => q.not("published_at", "is", null).is("deleted_at", null).order("created_at", { ascending: true })),
    all("listing_agents", "listing_id, seeded_at"),
  ]);
  const seededAt = new Map(agents.map((a) => [a.listing_id, a.seeded_at]));
  const todo = listings.map((l) => l.id).filter((id) => !seededAt.get(id) || seededAt.get(id) < cutoff);
  const batch = todo.slice(0, limit);
  const out = { listings: 0, written: 0, unchanged: 0, held: 0, failed: [] };
  let next = 0;
  async function worker() {
    while (next < batch.length) {
      const id = batch[next++];
      try {
        const c = await seedListing(id);
        if (c.skipped) continue;
        out.listings++; out.written += c.written; out.unchanged += c.unchanged; out.held += c.held;
      } catch (err) {
        out.failed.push({ listingId: id, error: String(err?.message ?? err).slice(0, 200) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length || 1) }, worker));
  return { ...out, remaining: todo.length - batch.length };
}
