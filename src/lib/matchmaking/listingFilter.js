import { join } from "path";
import { readFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import supabase from "@/lib/supabase";
import { LISTING_SELECT } from "@/lib/listings/listingSelect";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const SKILL_PATH = join(process.cwd(), "src", "lib", "matchmaking", "listing-filter.skill.md");
let _skillMd;
try {
  _skillMd = readFileSync(SKILL_PATH, "utf8");
} catch (err) {
  console.error(`[listingFilter] Failed to load skill markdown from ${SKILL_PATH}:`, err);
  throw new Error(`Listing filter skill not found at ${SKILL_PATH}`);
}

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

const RankedItemSchema = z.object({
  listing_id: z.string(),
  score: z.number(),
  intention: z.string(),
  reason: z.string(),
});

const FilterResponseSchema = z.object({
  ranked: z.array(RankedItemSchema),
});

function extractCardData(listing) {
  const activeLeases = (listing.listing_leases ?? []).filter(
    (l) => l.is_active && !l.deleted_at
  );
  const minRent =
    activeLeases.length > 0 ? Math.min(...activeLeases.map((l) => l.rent)) : null;
  const hero = (listing.listing_images ?? []).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  )[0];
  const amenRow = listing.listing_amenities?.[0];
  const topAmenities = amenRow
    ? Object.entries(amenRow)
        .filter(([, v]) => v === true)
        .slice(0, 3)
        .map(([k]) => k.replace(/_/g, " "))
    : [];
  return {
    title: listing.title,
    address: listing.address,
    hero_image_url: hero?.url ?? null,
    min_rent: minRent,
    top_amenities: topAmenities,
  };
}

export async function rankListings({
  preferences,
  weights,
  requestedIntentions,
  limit = 10,
}) {
  const { data: allListings, error } = await supabase
    .from("listings")
    .select(LISTING_SELECT)
    .is("deleted_at", null)
    .eq("unavailable", false)
    .limit(80);

  if (error) throw new Error(`[listingFilter] Supabase fetch failed: ${error.message}`);

  const budgetMax = preferences.budget_max ?? Infinity;
  const groupSize = Number(preferences.group_size) || 1;

  const pruned = (allListings ?? [])
    .filter((listing) => {
      const activeLeases = (listing.listing_leases ?? []).filter(
        (l) => l.is_active && !l.deleted_at
      );
      if (activeLeases.length === 0) return false;
      const minRent = Math.min(...activeLeases.map((l) => l.rent));
      if (budgetMax !== Infinity && minRent > budgetMax * 1.1) return false;
      const maxBeds = Math.max(...activeLeases.map((l) => l.bedrooms ?? 0));
      if (maxBeds < groupSize) return false;
      return true;
    })
    .slice(0, 30);

  if (pruned.length === 0) {
    return { ranked: [], usage: null };
  }

  const userContent = JSON.stringify({
    preferences,
    weights,
    candidates: pruned,
    requestedIntentions,
    limit,
    instruction: "Respond with JSON only — no prose, no markdown fences.",
  });

  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: _skillMd,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  const raw = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();

  const parsed = FilterResponseSchema.safeParse(JSON.parse(jsonText));
  if (!parsed.success) {
    throw new Error(`[listingFilter] Invalid response schema: ${parsed.error.message}`);
  }

  const candidatesById = Object.fromEntries(pruned.map((l) => [l.id, l]));
  const enriched = parsed.data.ranked.map((r) => ({
    ...r,
    card_data: candidatesById[r.listing_id]
      ? extractCardData(candidatesById[r.listing_id])
      : null,
  }));

  return { ranked: enriched, usage: response.usage };
}
