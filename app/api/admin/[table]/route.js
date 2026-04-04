export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { getSupabaseClient } from "@/libs/supabase";
import nodemailer from "nodemailer";

const _adminEmailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

async function sendNewListingEmail(toEmail, toName, address, listingId) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("[sendNewListingEmail] Email env vars not set — skipping in dev mode.");
    return;
  }
  const listingUrl = `https://useproximity.org/browse?listing=${listingId}`;
  await _adminEmailTransporter.sendMail({
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "You have a new listing on Proximity!",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
        <p>Hi ${toName || "there"},</p>
        <p>Congratulations! A new listing has been assigned to your Proximity account.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p><strong>Address:</strong> ${address}</p>
        <p style="margin-top: 16px;">
          <a href="${listingUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">View Your Listing</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p>Best,<br/>The Proximity Team<br/><a href="https://useproximity.org" style="color: #dc2626;">useproximity.org</a></p>
        <p style="color: #9ca3af; font-size: 12px;">You're receiving this because a listing was assigned to your account on Proximity.</p>
      </div>
    `,
  });
}

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

async function requireSuper() {
  const session = await auth();
  if (!session || session.user.role !== "super") return null;
  return session;
}

export async function GET(req, { params }) {
  const session = await requireSuper();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { table } = await params;

  const supabase = getSupabaseClient(getDbTarget(req));
  const { data, error } = await supabase.from(table).select("*").limit(1000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(data);
}

export async function PATCH(req, { params }) {
  const session = await requireSuper();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { table } = await params;

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

  // Notify new landlord if a listing's landlord_id was updated
  if (table === "listings" && safeUpdates.landlord_id && data?.address) {
    try {
      const { data: newLandlord } = await supabase
        .from("users")
        .select("email, name")
        .eq("id", safeUpdates.landlord_id)
        .maybeSingle();
      if (newLandlord?.email) {
        await sendNewListingEmail(newLandlord.email, newLandlord.name, data.address, data.id);
      }
    } catch (emailErr) {
      console.error("[admin PATCH] Failed to send landlord notification:", emailErr?.message);
    }
  }

  return Response.json(data);
}

export async function POST(req, { params }) {
  const session = await requireSuper();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { table } = await params;

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
