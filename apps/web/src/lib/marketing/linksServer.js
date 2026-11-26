/*
 * Server-side campaign link storage and the headline numbers the Campaign
 * links page shows per link. Always the site's own database (the page is
 * pinned): /go/<slug> and the beacon read links from that same database.
 *
 * Every insert, update and delete fires the action_log trigger on
 * marketing_links. created_by records who made a link.
 *
 * Numbers leave out sessions and outcomes that belong to admin or super
 * accounts (PRD 7.6 exclusions).
 */
import supabase from "@/lib/supabase";

const LINK_FIELDS = "id, slug, name, source, medium, campaign, content, destination_path, status, created_by, created_at, updated_at";
const PAGE = 1000;

/** Read every row of a query, 1000 at a time (PostgREST caps each response). */
export async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Ids of admin and super accounts, whose traffic is left out of every number. */
export async function staffUserIds() {
  const rows = await fetchAll(() => supabase.from("users").select("id, roles!inner(name)").in("roles.name", ["admin", "super"]));
  return new Set(rows.map((r) => r.id));
}

export async function listLinks() {
  const { data, error } = await supabase
    .from("marketing_links")
    .select(`${LINK_FIELDS}, creator:users!marketing_links_created_by_fkey(name, email)`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getLink(id) {
  const { data, error } = await supabase.from("marketing_links").select(LINK_FIELDS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function slugsLike(slug) {
  const { data, error } = await supabase.from("marketing_links").select("slug").like("slug", `${slug}%`);
  if (error) throw error;
  return (data || []).map((r) => r.slug);
}

/** Sessions ever recorded for a link (decides archive vs delete). */
export async function sessionCountForLink(id) {
  const { count, error } = await supabase.from("marketing_sessions").select("id", { count: "exact", head: true }).eq("link_id", id);
  if (error) throw error;
  return count || 0;
}

/**
 * Per-link headline numbers since `sinceIso`: sessions, accounts created,
 * inquiries, applications started. Returns { [linkId]: {...} }.
 */
export async function linkStats(sinceIso) {
  const staff = await staffUserIds();
  const [sessions, outcomes] = await Promise.all([
    fetchAll(() => supabase.from("marketing_sessions").select("link_id, user_id").not("link_id", "is", null).gte("started_at", sinceIso)),
    fetchAll(() =>
      supabase
        .from("marketing_outcomes")
        .select("link_id, outcome, tier, user_id")
        .not("link_id", "is", null)
        .in("tier", ["account", "inquiry", "application"])
        .gte("occurred_at", sinceIso),
    ),
  ]);
  const stats = {};
  const bump = (id, key) => {
    stats[id] ??= { sessions: 0, accounts: 0, inquiries: 0, applications: 0 };
    stats[id][key] += 1;
  };
  for (const s of sessions) if (!staff.has(s.user_id)) bump(s.link_id, "sessions");
  for (const o of outcomes) {
    if (staff.has(o.user_id)) continue;
    if (o.outcome === "account_created") bump(o.link_id, "accounts");
    else if (o.tier === "inquiry") bump(o.link_id, "inquiries");
    else if (o.outcome === "application_started") bump(o.link_id, "applications");
  }
  return stats;
}

/** Campaign names already used on active links (form suggestions). */
export function campaignSuggestions(links) {
  return [...new Set(links.filter((l) => l.status === "active").map((l) => l.campaign))].sort();
}

/**
 * src tags seen on visits that match no registered link, newest first, with
 * how many sessions carried each. Registering a link with that slug removes
 * it from this list (new visits then classify as the link).
 */
export async function unregisteredTags(sinceIso, links) {
  const registered = new Set(links.map((l) => l.slug));
  const rows = await fetchAll(() =>
    supabase
      .from("marketing_sessions")
      .select("campaign, started_at")
      .eq("classified_from", "src")
      .is("link_id", null)
      .gte("started_at", sinceIso)
      .order("started_at", { ascending: false }),
  );
  const tags = new Map();
  for (const r of rows) {
    if (!r.campaign || registered.has(r.campaign)) continue;
    const t = tags.get(r.campaign) ?? { tag: r.campaign, sessions: 0, lastSeen: r.started_at };
    t.sessions += 1;
    tags.set(r.campaign, t);
  }
  return [...tags.values()];
}

export async function insertLink(value, createdBy) {
  return supabase.from("marketing_links").insert({ ...value, created_by: createdBy }).select(LINK_FIELDS).single();
}

export async function updateLink(id, patch) {
  return supabase.from("marketing_links").update(patch).eq("id", id).select(LINK_FIELDS).single();
}

export async function deleteLink(id) {
  return supabase.from("marketing_links").delete().eq("id", id);
}
