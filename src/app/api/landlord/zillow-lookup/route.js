import { NextResponse } from "next/server";
import { auth } from "@/auth";

const HOME_TYPE_MAP = {
  SINGLE_FAMILY: "house", MULTI_FAMILY: "house", CONDO: "condo",
  TOWNHOUSE: "townhouse", APARTMENT: "apartment", MANUFACTURED: "other", LOT: "other",
};

function parsePrice(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function buildBboxUrl(latitude, longitude, delta = 0.003) {
  const w = longitude - delta, e = longitude + delta;
  const s = latitude - delta,  n = latitude + delta;
  const qs = encodeURIComponent(JSON.stringify({
    pagination: {},
    mapBounds: { west: w, east: e, south: s, north: n },
    isMapVisible: true,
    filterState: { fr: { value: true }, fsba: { value: false }, fsbo: { value: false },
                   nc: { value: false }, cmsn: { value: false }, auc: { value: false }, fore: { value: false } },
  }));
  return `https://www.zillow.com/rentals/?searchQueryState=${qs}`;
}

// ── Method 1: Apify REST API (direct, bypasses x402) ─────────────────────────
async function tryApify(latitude, longitude) {
  const token = process.env.APIFY_API_KEY;
  if (!token) return null;

  const url = buildBboxUrl(latitude, longitude);
  const body = JSON.stringify({ searchUrls: [{ url }], maxItems: 1 });

  const startRes = await fetch(
    `https://api.apify.com/v2/acts/maxcopell~zillow-scraper/runs?token=${token}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body }
  );
  if (!startRes.ok) return null;
  const { data: run } = await startRes.json();
  if (!run?.id) return null;

  // Poll for up to 60s
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}?token=${token}`);
    const { data: runData } = await statusRes.json();
    if (runData?.status === "SUCCEEDED") {
      const itemsRes = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}/dataset/items?token=${token}&limit=1`);
      const items = await itemsRes.json();
      return items?.[0] ?? null;
    }
    if (runData?.status === "FAILED" || runData?.status === "ABORTED") return null;
  }
  return null;
}

function normalizeApify(item) {
  if (!item) return null;
  const unit = item.units?.[0];
  return {
    found: true,
    source: "apify_zillow",
    title: item.buildingName ?? item.statusText ?? null,
    description: item.description ?? null,
    home_type: HOME_TYPE_MAP[item.homeType] ?? null,
    furnished: item.listCardRecommendation?.flexFieldRecommendations
      ?.some(r => /furnished/i.test(r.displayString)) ?? null,
    bedrooms: unit?.beds ? parseInt(unit.beds, 10) : null,
    bathrooms: null,
    area_sqft: null,
    rent: parsePrice(unit?.price),
    images: (item.carouselPhotosComposable?.photoData ?? [])
      .map(p => `https://photos.zillowstatic.com/fp/${p.photoKey}-p_e.jpg`),
    zillow_url: item.detailUrl ?? null,
    zillow_id: item.zpid ?? null,
    contact_phone: item.listCardRecommendation?.ctaRecommendations
      ?.find(r => r.contentType === "PHONE")?.displayString ?? null,
  };
}

// ── Method 2: Zillow internal GetSearchPageState API ─────────────────────────
async function tryZillowPublic(latitude, longitude) {
  const delta = 0.003;
  const searchQueryState = {
    pagination: {},
    mapBounds: { west: longitude - delta, east: longitude + delta,
                 south: latitude - delta, north: latitude + delta },
    isMapVisible: true,
    filterState: { fr: { value: true }, fsba: { value: false }, fsbo: { value: false },
                   nc: { value: false }, cmsn: { value: false }, auc: { value: false }, fore: { value: false } },
  };
  const url = `https://www.zillow.com/search/GetSearchPageState.htm?` +
    `searchQueryState=${encodeURIComponent(JSON.stringify(searchQueryState))}` +
    `&wants={"cat1":["listResults"],"cat2":["total"]}&requestId=2`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.zillow.com/",
    },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.cat1?.searchResults?.listResults?.[0] ?? null;
}

function normalizeZillowPublic(item) {
  if (!item) return null;
  return {
    found: true,
    source: "zillow_public",
    title: item.buildingName ?? item.statusText ?? null,
    description: null,
    home_type: HOME_TYPE_MAP[item.hdpData?.homeInfo?.homeType] ?? null,
    furnished: null,
    bedrooms: item.beds ?? item.hdpData?.homeInfo?.bedrooms ?? null,
    bathrooms: item.baths ?? item.hdpData?.homeInfo?.bathrooms ?? null,
    area_sqft: item.hdpData?.homeInfo?.livingArea ?? null,
    rent: parsePrice(item.price ?? item.unformattedPrice),
    images: item.carouselPhotos?.map(p => p.url).filter(Boolean) ?? [],
    zillow_url: item.detailUrl ? `https://www.zillow.com${item.detailUrl}` : null,
    zillow_id: item.zpid ?? null,
    contact_phone: null,
  };
}

export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { address, latitude, longitude } = await req.json();
  if (!latitude || !longitude) return NextResponse.json({ error: "latitude and longitude required" }, { status: 400 });

  // Try Apify first, fall back to Zillow public API
  const [apifyRaw, zillowRaw] = await Promise.allSettled([
    tryApify(latitude, longitude),
    tryZillowPublic(latitude, longitude),
  ]);

  const apifyResult = apifyRaw.status === "fulfilled" ? normalizeApify(apifyRaw.value) : null;
  const zillowResult = zillowRaw.status === "fulfilled" ? normalizeZillowPublic(zillowRaw.value) : null;

  if (!apifyResult && !zillowResult) {
    return NextResponse.json({ found: false });
  }

  // Merge: Apify wins, Zillow fills gaps
  const primary = apifyResult ?? zillowResult;
  const secondary = apifyResult ? zillowResult : null;

  const merged = { ...primary };
  if (secondary) {
    for (const key of Object.keys(secondary)) {
      if (merged[key] == null && secondary[key] != null) merged[key] = secondary[key];
    }
  }

  return NextResponse.json(merged);
}
