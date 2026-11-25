/*
 * Saved recipes (recipe.js): one active per listing and one per platform,
 * older versions kept as retired rows so they can be compared (Wyatt,
 * 2026-11-24). Every function fails soft: a sync never stops for a recipe.
 */

import supabase from "@/lib/supabase";

export const recipesOn = () => String(process.env.SYNC_RECIPES ?? "").toLowerCase() !== "false";

/* The listing's and the platform's active recipes, and the listing's unit names. */
export async function loadRecipes(listingId, platformKey) {
  const out = { listing: null, platform: null, knownNames: [] };
  if (!recipesOn()) return out;
  try {
    const [mine, shared, units] = await Promise.all([
      listingId ? supabase.from("source_recipes").select("id, version, recipe").eq("scope", "listing").eq("listing_id", listingId).eq("status", "active").maybeSingle() : { data: null },
      platformKey ? supabase.from("source_recipes").select("id, version, recipe").eq("scope", "platform").eq("platform_key", platformKey).eq("status", "active").maybeSingle() : { data: null },
      listingId ? supabase.from("listing_units").select("name").eq("listing_id", listingId).is("deleted_at", null).limit(500) : { data: [] },
    ]);
    out.listing = mine.data ?? null;
    out.platform = shared.data ?? null;
    out.knownNames = (units.data ?? []).map((u) => u.name).filter(Boolean);
  } catch (err) {
    console.error(`[source-sync] recipes for ${listingId ?? platformKey}: ${err?.message ?? err}`);
  }
  return out;
}

/* Save a new version; the one it replaces is retired, not deleted. */
async function saveOne({ scope, listingId = null, platformKey = null, recipe, madeFrom, checked }) {
  const key = scope === "listing" ? { listing_id: listingId } : { platform_key: platformKey };
  const { data: prior } = await supabase.from("source_recipes").select("id, version, recipe").eq("scope", scope).match(key).eq("status", "active").maybeSingle();
  if (prior && JSON.stringify(prior.recipe) === JSON.stringify(recipe)) return prior.id;
  if (prior) await supabase.from("source_recipes").update({ status: "retired", retired_at: new Date().toISOString() }).eq("id", prior.id);
  const { data, error } = await supabase.from("source_recipes")
    .insert({ scope, ...key, version: (prior?.version ?? 0) + 1, recipe, made_from: madeFrom ?? null, checked: checked ?? null, last_ok_at: new Date().toISOString() })
    .select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/*
 * Keep what a read worked out (snapshot.recipe.made): the listing's recipe,
 * and the platform's when the site is on a known platform and the recipe can
 * find units by itself (it learned the line after a unit's name).
 */
export async function saveMadeRecipe({ listingId, info }) {
  if (!recipesOn() || !info?.made) return;
  try {
    await saveOne({ scope: "listing", listingId, recipe: info.made, madeFrom: info.madeFrom, checked: info.check });
    if (info.platformKey && info.made.kind === "named" && info.made.after) {
      const paths = [...new Set((info.made.pages ?? []).map((u) => { try { return new URL(u).pathname.replace(/\/+$/, "") || "/"; } catch { return null; } }).filter(Boolean))];
      await saveOne({ scope: "platform", platformKey: info.platformKey, recipe: { v: info.made.v, kind: "named", pages: [], paths, after: info.made.after, names: [] }, madeFrom: `listing ${listingId}`, checked: info.check });
    }
  } catch (err) {
    console.error(`[source-sync] saving recipe for ${listingId}: ${err?.message ?? err}`);
  }
}

/* Count a run against the recipe it used. */
export async function noteRecipeRun({ info }) {
  if (!recipesOn() || !info?.usedId) return;
  try {
    const { data } = await supabase.from("source_recipes").select("uses, failures").eq("id", info.usedId).maybeSingle();
    if (!data) return;
    const patch = info.broken ? { failures: data.failures + 1 } : { uses: data.uses + 1, last_ok_at: new Date().toISOString() };
    await supabase.from("source_recipes").update(patch).eq("id", info.usedId);
  } catch (err) {
    console.error(`[source-sync] recipe run note: ${err?.message ?? err}`);
  }
}
