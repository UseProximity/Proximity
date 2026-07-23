export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { getSupabaseClient } from "@/lib/supabase";

// Columns that must never leave the server, even for supers
const USER_SENSITIVE_COLS = [
  "password_hash",
  "email_verification_token",
  "email_verification_expires_at",
  "password_reset_token",
  "password_reset_expires_at",
];

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

function stripSensitive(user) {
  if (!user || typeof user !== "object") return user;
  const clean = { ...user };
  for (const col of USER_SENSITIVE_COLS) delete clean[col];
  return clean;
}

export async function GET(req, { params }) {
  const session = await auth();
  if (!session || (session.user.role !== "super" && session.user.role !== "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { view } = await params;
  const supabase = getSupabaseClient(getDbTarget(req));

  try {
    if (view === "listings") {
      const { data, error } = await supabase
        .from("listings")
        .select(`*,
          listing_units(*, unit_leases(*)),
          listing_images(*),
          listing_landlords(id, user_id, is_primary, users(id, name, email, phone)),
          listing_reviews(*),
          listing_amenities(*),
          listing_utilities(*)`)
        .order("address");
      if (error) throw error;
      return Response.json(data);
    }

    if (view === "users") {
      const { data, error } = await supabase
        .from("users")
        .select(`*,
          roles!role_id(name),
          listing_landlords(listing_id, is_primary, listings(id, title, address)),
          listing_reviews!user_id(id, rating, legitimacy, created_at, deleted_at, listings(id, title, address)),
          matchmaking_preferences(*)`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return Response.json(data.map(stripSensitive));
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
