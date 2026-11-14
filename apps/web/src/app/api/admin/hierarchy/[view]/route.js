// @auth admin
export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";
import { stripSecrets } from "@/lib/security/secretColumns";

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

// PostgREST answers at most 1,000 rows however many match, so the lists that
// can outgrow that (listings, users, reviews) are read in pages. Each query
// needs a stable order for the pages not to overlap, hence the id tiebreak.
const PAGE = 1000;
async function fetchAll(query) {
  const rows = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function GET(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { view } = await params;
  const supabase = getSupabaseClient(getDbTarget(req));

  try {
    if (view === "listings") {
      const query = supabase
        .from("listings")
        .select(`*,
          listing_units(*, unit_leases(*)),
          listing_images(*),
          listing_landlords(id, user_id, is_primary, users(id, name, email, phone)),
          listing_reviews(*),
          listing_amenities(*),
          listing_utilities(*)`)
        .order("address")
        .order("id");
      // ?id= narrows to one listing, for its record page.
      const onlyId = new URL(req.url).searchParams.get("id");
      return Response.json(await fetchAll(onlyId ? query.eq("id", onlyId) : query));
    }

    if (view === "users") {
      const data = await fetchAll(supabase
        .from("users")
        .select(`*,
          roles!role_id(name),
          listing_landlords(listing_id, is_primary, listings(id, title, address)),
          listing_reviews!user_id(id, rating, legitimacy, created_at, deleted_at, listings(id, title, address)),
          matchmaking_preferences(*)`)
        .order("created_at", { ascending: false })
        .order("id"));
      return Response.json(data.map(stripSecrets));
    }

    /*
     * Every property review, newest first.
     *
     * Reviews were reachable only by expanding the listing or the person who
     * wrote one, which answers "what has this property got?" but never "what
     * came in today?", the question moderation actually starts from. The
     * reviewer and the listing are joined here so the table can name both
     * without a second round trip per row.
     *
     * Soft-deleted rows are included rather than filtered. This is the admin
     * surface: a review removed by mistake has to be findable to be restored,
     * and the view badges them instead of hiding them.
     */
    if (view === "reviews") {
      return Response.json(await fetchAll(supabase
        .from("listing_reviews")
        .select(`*,
          reviewer:users!user_id(id, name, email),
          listings!listing_id(id, title, address)`)
        .order("created_at", { ascending: false })
        .order("id")));
    }

    if (view === "dorms") {
      const { data, error } = await supabase
        .from("dorms")
        .select(`*,
          dorm_room_types(room_type),
          dorm_reviews(*, dorm_review_tags(tags(id, name)))`)
        .order("name");
      if (error) throw error;
      return Response.json(data);
    }

    if (view === "testimonials") {
      const { data, error } = await supabase
        .from("testimonials")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return Response.json(data);
    }

    if (view === "reference") {
      const tables = [
        "roles",
        "home_types",
        "lease_structures",
        "interaction_types",
        "metric_types",
        "tags",
        "schools",
        "locations",
      ];
      const results = await Promise.all(
        tables.map((t) =>
          (t === "locations"
            ? supabase.from(t).select("*, location_types(name)").order("name")
            : supabase.from(t).select("*")
          ).then(({ data, error }) => (error ? [] : data))
        )
      );
      return Response.json(Object.fromEntries(tables.map((t, i) => [t, results[i]])));
    }

    return Response.json({ error: "Unknown view" }, { status: 404 });
  } catch (err) {
    console.error(`[admin/hierarchy] view=${view}`, err?.message);
    return Response.json({ error: "Failed to load data" }, { status: 500 });
  }
}
