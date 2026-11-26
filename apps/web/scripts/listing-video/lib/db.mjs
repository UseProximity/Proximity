/*
 * Read-side DB access. Snake_case in Supabase, camelCase here (project convention).
 */
import { createClient } from "@supabase/supabase-js";
import { dbConfig } from "./env.mjs";

let clients = {};
function getClient(target) {
  if (!clients[target]) {
    const { url, serviceKey } = dbConfig(target);
    clients[target] = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return clients[target];
}

/*
 * Returns { listing: {id, address, deletedAt, videoEnabled}, images: [{id, url, sortOrder, source, mediaType}] }
 * Images are non-Street-View stills only, in current sort_order (alphabetical — the
 * pipeline reorders them).
 */
export async function fetchListing(target, listingId) {
  const supabase = getClient(target);

  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select("id, address, deleted_at")
    .eq("id", listingId)
    .single();
  if (listingError) throw new Error(`listing ${listingId}: ${listingError.message}`);

  const { data: images, error: imagesError } = await supabase
    .from("listing_images")
    .select("id, url, sort_order, source, media_type")
    .eq("listing_id", listingId)
    .order("sort_order", { ascending: true });
  if (imagesError) throw new Error(`listing_images ${listingId}: ${imagesError.message}`);

  return {
    listing: {
      id: listing.id,
      address: listing.address || "",
      deletedAt: listing.deleted_at,
    },
    images: (images || [])
      .filter((i) => (i.media_type || "image") === "image" && i.source !== "street_view")
      .map((i) => ({
        id: i.id,
        url: i.url,
        sortOrder: i.sort_order,
        source: i.source,
      })),
    streetViewOnly:
      (images || []).length > 0 &&
      (images || []).every((i) => i.source === "street_view"),
  };
}
