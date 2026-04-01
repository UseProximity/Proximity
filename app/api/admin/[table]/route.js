export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { getSupabaseClient } from "@/libs/supabase";

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

const VALID_TABLES = new Set([
  "users",
  "listings",
  "listing_units",
  "reviews",
  "dorms",
  "dorm_reviews",
  "testimonials",
]);

async function requireSuper() {
  const session = await auth();
  if (!session || session.user.role !== "super") return null;
  return session;
}

export async function GET(req, { params }) {
  const session = await requireSuper();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { table } = await params;
  if (!VALID_TABLES.has(table)) {
    return Response.json({ error: "Unknown table" }, { status: 404 });
  }

  const supabase = getSupabaseClient(getDbTarget(req));
  const { data, error } = await supabase.from(table).select("*").limit(1000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(data);
}

export async function PATCH(req, { params }) {
  const session = await requireSuper();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { table } = await params;
  if (!VALID_TABLES.has(table)) {
    return Response.json({ error: "Unknown table" }, { status: 404 });
  }

  const supabase = getSupabaseClient(getDbTarget(req));
  const body = await req.json();
  const { id, updates } = body;
  if (!id || typeof id !== "string" || id.trim() === "") {
    return Response.json({ error: "Missing or invalid id" }, { status: 400 });
  }

  // Strip immutable / auto-managed fields
  const { id: _id, created_at, updated_at, mongo_id, ...safeUpdates } = updates || {};

  if (Object.keys(safeUpdates).length === 0) {
    return Response.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from(table)
    .update(safeUpdates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error(`[admin PATCH] table=${table} id=${id}`, error);
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json(data);
}

export async function POST(req, { params }) {
  const session = await requireSuper();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { table } = await params;
  if (!VALID_TABLES.has(table)) {
    return Response.json({ error: "Unknown table" }, { status: 404 });
  }

  const supabase = getSupabaseClient(getDbTarget(req));

  try {
    const body = await req.json();
    const { fields } = body;

    // Strip immutable / auto-managed fields
    const { id: _id, created_at, updated_at, mongo_id, ...safeFields } = fields || {};

    // Listings: geocode if lat/lng missing, then insert directly into Supabase
    if (table === "listings") {
      if (!safeFields.address?.trim()) {
        return Response.json({ error: "address is required" }, { status: 400 });
      }

      if (safeFields.latitude == null || safeFields.longitude == null) {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        if (token) {
          const encoded = encodeURIComponent(safeFields.address);
          const geoRes = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=1&country=US`
          );
          const geoData = await geoRes.json();
          const feature = geoData.features?.[0];
          if (feature) {
            const [lng, lat] = feature.center;
            safeFields.latitude = lat;
            safeFields.longitude = lng;
          }
        }
      }

    }

    // Convert empty strings to null so numeric/text columns don't get ""
    // Keep array columns as [] (not null) to satisfy NOT NULL constraints
    const ARRAY_COLUMNS = new Set(["images", "utilities_included", "amenities", "tags"]);
    for (const [k, v] of Object.entries(safeFields)) {
      if (v === "") safeFields[k] = ARRAY_COLUMNS.has(k) ? [] : null;
    }

    const { data, error } = await supabase
      .from(table)
      .insert(safeFields)
      .select()
      .single();

    if (error) {
      const detail = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
      return Response.json({ error: detail }, { status: 500 });
    }
    return Response.json(data, { status: 201 });
  } catch (err) {
    console.error(`[admin POST] table=${table}`, err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const session = await requireSuper();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { table } = await params;
  if (!VALID_TABLES.has(table)) {
    return Response.json({ error: "Unknown table" }, { status: 404 });
  }

  const supabase = getSupabaseClient(getDbTarget(req));
  let id;
  const url = new URL(req.url);
  const queryId = url.searchParams.get("id");
  if (queryId) {
    id = queryId;
  } else {
    try {
      const body = await req.json();
      id = body.id;
    } catch {
      // no body
    }
  }

  if (!id || typeof id !== "string" || id.trim() === "") {
    return Response.json({ error: "Missing or invalid id" }, { status: 400 });
  }

  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
