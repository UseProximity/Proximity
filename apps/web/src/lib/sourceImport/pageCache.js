/*
 * The importer's shared page cache (see setSharedPageCache in
 * lib/listingDraft/fetchSite.js): pages fetched in the last 15 minutes, in
 * listing_import_page_cache, so every building of a batch, on whichever
 * server instance it runs, reuses the landlord's home page, property list
 * and site-wide pages. Best-effort throughout: a cache that cannot be read
 * or written only means a fresh fetch.
 */
import supabase from "@/lib/supabase";

const FRESH_MS = 15 * 60 * 1000;
const KEEP_MS = 60 * 60 * 1000;
// Large rendered pages are fetched again rather than stored.
const MAX_CHARS = 1_500_000;

let writes = 0;

export const pageCacheStore = {
  async get(key) {
    const since = new Date(Date.now() - FRESH_MS).toISOString();
    const { data } = await supabase.from("listing_import_page_cache").select("page").eq("key", key).gt("fetched_at", since).maybeSingle();
    return data?.page ?? null;
  },
  async set(key, page) {
    const json = JSON.stringify(page);
    if (json.length > MAX_CHARS) return;
    await supabase.from("listing_import_page_cache").upsert({ key, page: JSON.parse(json), fetched_at: new Date().toISOString() }, { onConflict: "key" });
    // Now and then, clear what nobody will read again.
    if (++writes % 25 === 1) {
      await supabase.from("listing_import_page_cache").delete().lt("fetched_at", new Date(Date.now() - KEEP_MS).toISOString());
    }
  },
};
