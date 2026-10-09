/*
 * Attach (or clear) the source URL a listing is monitored against.
 *
 * Single entry point for both paths that can set one:
 *   - the import flow, where the landlord pasted the URL themselves
 *   - the admin console, where a super fills one in for an existing listing
 *
 * Keeping both on this function means listings.source_url and
 * listing_source_monitors can never disagree about what is being monitored.
 */
import supabase from "@/lib/supabase";
import { classifySourceUrl } from "./classify.js";

/*
 * Returns { ok: true, kind, url } or { ok: false, reason }.
 * Never throws — a failure here must not fail listing creation.
 */
export async function attachSourceUrl({ listingId, rawUrl, indexUrl = null, userId = null }) {
  if (!listingId) return { ok: false, reason: "no_listing" };

  const classified = classifySourceUrl(rawUrl);
  if (!classified) return { ok: false, reason: "bad_url" };

  /*
   * The page the landlord actually pasted, when it was a company's list of
   * properties rather than the property itself.
   *
   * The sync needs both: source_url is the property's own page, which it reads
   * for rents and availability, and index_url is where that property is
   * expected to keep appearing — a building that drops off its own landlord's
   * list has almost certainly been let, which is not something the property
   * page says out loud. Nothing wrote index_url until now, so every monitor ran
   * without that check.
   */
  const classifiedIndex = indexUrl ? classifySourceUrl(indexUrl) : null;

  // Refuse subleases outright rather than creating a monitor the cron will skip. The
  // only page that exists for a sublet room is the building's, and it is authoritative
  // for none of it.
  const { data: listing } = await supabase
    .from("listings")
    .select("lease_type")
    .eq("id", listingId)
    .maybeSingle();
  if (listing?.lease_type === "sublease") return { ok: false, reason: "sublease_not_monitored" };

  try {
    const { error: listingError } = await supabase
      .from("listings")
      .update({
        source_url: classified.url,
        source_kind: classified.kind,
        source_added_by: userId,
        source_added_at: new Date().toISOString(),
      })
      .eq("id", listingId);
    if (listingError) return { ok: false, reason: listingError.message };

    // One monitor per listing (unique on listing_id). Re-pointing an existing monitor
    // at a new URL resets its failure count and un-mutes it: the old URL's history
    // says nothing about the new one.
    const { error: monitorError } = await supabase
      .from("listing_source_monitors")
      .upsert(
        {
          listing_id: listingId,
          source_url: classified.url,
          source_kind: classified.kind,
          index_url: classifiedIndex?.url ?? null,
          enabled: true,
          consecutive_failures: 0,
          muted_until: null,
          last_status: null,
          last_error: null,
        },
        { onConflict: "listing_id" }
      );
    if (monitorError) return { ok: false, reason: monitorError.message };

    return {
      ok: true,
      kind: classified.kind,
      url: classified.url,
      indexUrl: classifiedIndex?.url ?? null,
    };
  } catch (err) {
    return { ok: false, reason: err?.message ?? "attach_failed" };
  }
}

export async function detachSourceUrl(listingId) {
  if (!listingId) return { ok: false, reason: "no_listing" };
  try {
    // Both columns must clear together — chk_listings_source_pair enforces it.
    await supabase
      .from("listings")
      .update({ source_url: null, source_kind: null, source_added_by: null, source_added_at: null })
      .eq("id", listingId);
    await supabase.from("listing_source_monitors").delete().eq("listing_id", listingId);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message ?? "detach_failed" };
  }
}
