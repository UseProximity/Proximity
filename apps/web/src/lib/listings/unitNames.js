import supabase from "@/lib/supabase";
import { unitNameKey } from "@/utils/unitName";

/*
 * One apartment, one row. Two live units at the same property both called
 * "Apt 2E" are not two apartments, so a new name (or a rename) that matches one
 * already there is refused. Compared case- and space-insensitively in JS rather
 * than with ilike, so a "%" or "_" in a name is just a character.
 *
 * Returns the clashing unit's id, or null. An unnamed unit has nothing to clash
 * with.
 */
export async function findUnitNamed(listingId, name, { excludeId = null } = {}) {
  const key = unitNameKey(name);
  if (!key) return null;
  const { data } = await supabase
    .from("listing_units")
    .select("id, name")
    .eq("listing_id", listingId)
    .is("deleted_at", null)
    .not("name", "is", null);
  const clash = (data ?? []).find((u) => u.id !== excludeId && unitNameKey(u.name) === key);
  return clash?.id ?? null;
}

// Where a unit added now goes: after every unit already at the property, so a
// landlord's arrangement is never reshuffled by an addition.
export async function nextUnitSortOrder(listingId) {
  const { data } = await supabase
    .from("listing_units")
    .select("sort_order")
    .eq("listing_id", listingId)
    .is("deleted_at", null)
    .not("sort_order", "is", null)
    .order("sort_order", { ascending: false })
    .limit(1);
  return (data?.[0]?.sort_order ?? -1) + 1;
}
