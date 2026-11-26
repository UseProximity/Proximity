/*
 * GET /api/admin/agents/knowledge             every published listing with
 *                                             how much its agent knows
 * GET /api/admin/agents/knowledge?listingId=  one listing's current facts,
 *                                             each with its source, plus its
 *                                             sources, found pages and recent
 *                                             knowledge changes
 *
 * Admin only, read only. Works whether or not agents are switched on: the
 * team checks what a listing knows before it goes live (Wyatt, 2026-11-02).
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireTeam() {
  const session = await auth();
  if (!session?.user?.id) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!["super", "admin"].includes(session.user.role)) return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: session.user.id };
}

async function all(table, select, filter = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(supabase.from(table).select(select)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const countBy = (rows, key = "listing_id") => rows.reduce((m, r) => m.set(r[key], (m.get(r[key]) ?? 0) + 1), new Map());
const nameOf = (l) => l?.title || String(l?.address ?? "").split(",")[0] || "Untitled listing";

async function listingsOverview() {
  const [listings, facts, sources, found, agents] = await Promise.all([
    all("listings", "id, title, address", (q) => q.not("published_at", "is", null).is("deleted_at", null)),
    all("listing_facts", "listing_id", (q) => q.eq("is_current", true)),
    all("listing_sources", "listing_id"),
    all("listing_found_sources", "listing_id, status"),
    all("listing_agents", "listing_id, status, seeded_at"),
  ]);
  const factN = countBy(facts);
  const sourceN = countBy(sources);
  const foundN = countBy(found.filter((f) => f.status === "confirmed"));
  const reviewN = countBy(found.filter((f) => f.status === "needs_review"));
  const agentBy = new Map(agents.map((a) => [a.listing_id, a]));
  return listings.map((l) => ({
    listingId: l.id,
    name: nameOf(l),
    address: l.address ?? "",
    facts: factN.get(l.id) ?? 0,
    sources: sourceN.get(l.id) ?? 0,
    foundConfirmed: foundN.get(l.id) ?? 0,
    foundToReview: reviewN.get(l.id) ?? 0,
    status: agentBy.get(l.id)?.status ?? "off",
    seededAt: agentBy.get(l.id)?.seeded_at ?? null,
  })).sort((a, b) => b.facts - a.facts || a.name.localeCompare(b.name));
}

async function listingDetail(listingId) {
  const [{ data: listing }, facts, sources, found, units, events] = await Promise.all([
    supabase.from("listings").select("id, title, address, source_url").eq("id", listingId).maybeSingle(),
    all("listing_facts", "id, section, field_key, summary, value, scope_level, scope_id, source_id, source_ref, excerpt, confidence, landlord_set, observed_at, valid_from, valid_until", (q) => q.eq("listing_id", listingId).eq("is_current", true).order("section").order("field_key")),
    all("listing_sources", "id, kind, url, label, enabled, last_checked_at, last_status, last_error, consecutive_failures, created_at", (q) => q.eq("listing_id", listingId).order("created_at")),
    all("listing_found_sources", "id, url, site, page_type, status, confidence, title, evidence, found_by, reviewed_at, created_at", (q) => q.eq("listing_id", listingId).order("site")),
    all("listing_units", "id, name, title, unit_number, bedrooms", (q) => q.eq("listing_id", listingId)),
    supabase.from("listing_fact_events").select("id, section, field_key, cause, status, detail, created_at").eq("listing_id", listingId).order("created_at", { ascending: false }).limit(60),
  ]);
  if (!listing) return null;

  const unitName = new Map(units.map((u) => [u.id, u.name || u.title || u.unit_number || (u.bedrooms != null ? `${u.bedrooms} bed` : "Unit")]));
  const factsBySource = countBy(facts, "source_id");
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const foundByUrl = new Map(found.map((f) => [f.url, f]));
  const sourceLabel = (s) => {
    if (!s) return null;
    const f = s.url ? foundByUrl.get(s.url) : null;
    return { kind: s.kind, url: s.url, label: s.label, foundSite: f?.site ?? null };
  };

  return {
    listing: { id: listing.id, name: nameOf(listing), address: listing.address ?? "", sourceUrl: listing.source_url ?? null },
    facts: facts.map((f) => ({
      id: f.id, section: f.section, key: f.field_key, summary: f.summary, value: f.value,
      scope: f.scope_level === "property" ? "Whole property" : f.scope_level === "unit" ? `Unit: ${unitName.get(f.scope_id) ?? "unknown"}` : f.scope_level === "lease" ? "One lease" : "One owner's leases",
      confidence: f.confidence, landlordSet: f.landlord_set, observedAt: f.observed_at,
      validFrom: f.valid_from, validUntil: f.valid_until, excerpt: f.excerpt,
      source: sourceLabel(sourceById.get(f.source_id)), sourceRef: f.source_ref,
    })),
    sources: sources.map((s) => ({
      id: s.id, kind: s.kind, url: s.url, label: s.label, enabled: s.enabled,
      lastCheckedAt: s.last_checked_at, lastStatus: s.last_status, lastError: s.last_error,
      failures: s.consecutive_failures, facts: factsBySource.get(s.id) ?? 0,
      foundSite: s.url ? foundByUrl.get(s.url)?.site ?? null : null,
    })),
    found: found.map((f) => ({
      id: f.id, url: f.url, site: f.site, pageType: f.page_type, status: f.status, confidence: f.confidence,
      title: f.title, evidence: f.evidence, foundBy: f.found_by, reviewedAt: f.reviewed_at, createdAt: f.created_at,
    })),
    events: (events.data ?? []).map((e) => ({
      id: e.id, section: e.section, key: e.field_key, cause: e.cause, status: e.status,
      summary: e.detail?.summary ?? null, createdAt: e.created_at,
    })),
  };
}

export async function GET(req) {
  const gate = await requireTeam();
  if (gate.res) return gate.res;
  try {
    const listingId = new URL(req.url).searchParams.get("listingId");
    if (!listingId) return NextResponse.json({ listings: await listingsOverview() });
    if (!UUID.test(listingId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const detail = await listingDetail(listingId);
    if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    console.error("[agents] admin knowledge failed:", err);
    return NextResponse.json({ error: "Could not load knowledge" }, { status: 500 });
  }
}
