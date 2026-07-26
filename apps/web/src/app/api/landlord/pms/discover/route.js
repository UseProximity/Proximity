export const dynamic = "force-dynamic";
export const maxDuration = 120;
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { haversineKm } from "@/utils/walkTimes";
import { WASHU_PLACES } from "@/utils/washuPlaces";
import { isApiProvider, getConnector } from "@/lib/pms/index.js";
import { normalizeSubdomain } from "@/lib/pms/appfolio.js";
import { joinAddress } from "@/lib/pms/types.js";

// Campus anchor for the auto-include radius (Olin Library — center of campus).
const CAMPUS = WASHU_PLACES[0];

async function requireLandlordOrSuper() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!["landlord", "super"].includes(session.user.role)) return null;
  return session;
}

// Local copy of the private geocodeAddress helper (this codebase deliberately
// duplicates route-private helpers instead of sharing them).
async function geocodeAddress(address) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=1&country=US`;
  const res = await fetch(url);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.center;
  return { latitude: lat, longitude: lng };
}

const streetNumberOf = (address) => {
  const match = (address || "").trim().match(/^(\d+)/);
  return match ? match[1] : null;
};

/*
 * POST /api/landlord/pms/discover — after the Nango Connect widget succeeds:
 * verify the connection, store/refresh the pms_connections row, pull the first
 * snapshot, filter to properties near campus, and suggest dedupe matches
 * against the landlord's OWN pre-existing listings (the landlord confirms —
 * they know their buildings). Nothing is linked or ingested here; /confirm
 * applies the landlord's decisions.
 */
export async function POST(req) {
  const session = await requireLandlordOrSuper();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { provider, nangoConnectionId, subdomain } = await req.json().catch(() => ({}));
  if (!isApiProvider(provider) || !nangoConnectionId || typeof nangoConnectionId !== "string") {
    return NextResponse.json({ error: "provider and nangoConnectionId are required" }, { status: 400 });
  }

  // AppFolio is reached at {subdomain}.appfolio.com — the subdomain is
  // landlord-supplied text that ends up in a URL, so it is validated here
  // (server-side, SSRF guard) and again inside the connector on every call.
  let credentialMeta = null;
  if (provider === "appfolio") {
    const sub = normalizeSubdomain(subdomain);
    if (!sub) {
      return NextResponse.json(
        { error: "Enter your AppFolio database name (the part before .appfolio.com in your AppFolio URL)" },
        { status: 400 }
      );
    }
    credentialMeta = { subdomain: sub };
  }

  const connector = getConnector(provider);
  const verified = await connector.verifyConnection(nangoConnectionId, credentialMeta);
  if (!verified.ok) {
    return NextResponse.json(
      { error: `We couldn't read from your ${provider} account: ${verified.error}` },
      { status: 422 }
    );
  }

  // One connection per landlord × provider — refresh it if it already exists.
  const { data: existing } = await supabase
    .from("pms_connections")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("provider", provider)
    .is("deleted_at", null)
    .maybeSingle();

  const connectionValues = {
    nango_connection_id: nangoConnectionId,
    status: "active",
    credential_meta: { accountLabel: verified.accountLabel || null, ...(credentialMeta || {}) },
    last_sync_error: null,
  };

  let connectionId = existing?.id;
  if (connectionId) {
    await supabase.from("pms_connections").update(connectionValues).eq("id", connectionId);
  } else {
    const { data: inserted, error } = await supabase
      .from("pms_connections")
      .insert({ user_id: session.user.id, provider, ...connectionValues })
      .select("id, radius_auto_include_km")
      .single();
    if (error) {
      console.error("[pms/discover] connection insert:", error.message);
      return NextResponse.json({ error: "Could not save the connection" }, { status: 500 });
    }
    connectionId = inserted.id;
  }

  const { data: connection } = await supabase
    .from("pms_connections")
    .select("id, radius_auto_include_km")
    .eq("id", connectionId)
    .single();
  const radiusKm = Number(connection?.radius_auto_include_km) || 8;

  const snapshot = await connector.fetchSnapshot(nangoConnectionId, credentialMeta);
  if (!snapshot.properties.length) {
    return NextResponse.json(
      { error: "We connected, but couldn't read any properties from the account", detail: snapshot.errors },
      { status: 422 }
    );
  }

  // The landlord's pre-existing listings — the only dedupe universe that matters.
  const { data: owned } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("user_id", session.user.id);
  const ownedIds = (owned ?? []).map((r) => r.listing_id);
  let ownListings = [];
  if (ownedIds.length) {
    const { data } = await supabase
      .from("listings")
      .select("id, title, address, latitude, longitude, pms_connection_id")
      .in("id", ownedIds)
      .is("deleted_at", null);
    ownListings = data ?? [];
  }

  const properties = [];
  for (const prop of snapshot.properties) {
    const fullAddress = joinAddress(prop.address, prop.city, prop.state, prop.zip);
    let geo = null;
    if (fullAddress) {
      try {
        geo = await geocodeAddress(fullAddress);
      } catch {
        geo = null;
      }
    }
    const distanceKm = geo
      ? haversineKm(geo.latitude, geo.longitude, CAMPUS.lat, CAMPUS.lng)
      : null;

    // Dedupe suggestion: nearest of the landlord's own listings within 200m;
    // exact street-number match upgrades it to high confidence.
    let match = null;
    if (geo) {
      const near = ownListings
        .filter((l) => l.latitude != null && l.longitude != null)
        .map((l) => ({ ...l, dKm: haversineKm(geo.latitude, geo.longitude, l.latitude, l.longitude) }))
        .filter((l) => l.dKm <= 0.2)
        .sort((a, b) => a.dKm - b.dKm);
      const number = streetNumberOf(prop.address);
      const numberHit = number ? near.find((l) => streetNumberOf(l.address) === number) : null;
      const hit = numberHit || near[0];
      if (hit) {
        match = {
          listingId: hit.id,
          title: hit.title,
          address: hit.address,
          confidence: numberHit ? "high" : "low",
          alreadySynced: !!hit.pms_connection_id,
        };
      }
    }

    properties.push({
      externalPropertyId: prop.externalPropertyId,
      name: prop.name,
      address: fullAddress,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
      withinRadius: distanceKm != null && distanceKm <= radiusKm,
      unitCount: prop.units.length,
      availableUnits: prop.units.filter((u) => u.available === true).length,
      units: prop.units,
      match,
    });
  }

  return NextResponse.json({
    connectionId,
    provider,
    accountLabel: verified.accountLabel || null,
    radiusKm,
    snapshotErrors: snapshot.errors,
    properties,
  });
}
