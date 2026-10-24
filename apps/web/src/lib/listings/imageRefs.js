/*
 * Guards between listing photo rows and the R2 objects behind them.
 *
 * A photo row stores a public URL, and deleting the row deletes the object that
 * URL names. So the URL a row may carry, and the object a delete may remove,
 * have to be pinned down: otherwise a user registers someone else's photo URL
 * as their own row, deletes "their" photo, and the other listing's picture is
 * gone from the bucket.
 */
import supabase from "@/lib/supabase";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether `url` has the shape /api/upload hands out for this property:
 * <public base>/<property folder>/<uuid>-<file name>, and nothing else.
 */
export function isIssuedUploadUrl(url, { publicBase, folder }) {
  if (typeof url !== "string" || !publicBase || !folder) return false;
  const base = publicBase.endsWith("/") ? publicBase.slice(0, -1) : publicBase;
  // Anything may follow the uuid (it is the uploader's file name); the base,
  // folder and uuid prefix are what tie the URL to an object we issued.
  const re = new RegExp(`^${escapeRe(base)}/${escapeRe(folder)}/${UUID}-.+$`, "i");
  return re.test(url);
}

/**
 * Whether any photo row (other than `excludeImageId`) or any unit's floor plan
 * still points at this URL. A URL in use is never registered again, and its
 * object is never deleted from under the row that uses it.
 */
export async function imageUrlInUse(url, { excludeImageId = null } = {}) {
  let photos = supabase.from("listing_images").select("id", { count: "exact", head: true }).eq("url", url);
  if (excludeImageId) photos = photos.neq("id", excludeImageId);
  const [{ count: photoCount, error: photoErr }, { count: planCount, error: planErr }] =
    await Promise.all([
      photos,
      supabase
        .from("listing_units")
        .select("id", { count: "exact", head: true })
        .eq("floor_plan_image_url", url),
    ]);
  // Fail safe: when we can't tell, treat it as in use (keep the object).
  if (photoErr || planErr) return true;
  return (photoCount ?? 0) + (planCount ?? 0) > 0;
}
