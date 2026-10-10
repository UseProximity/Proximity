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
