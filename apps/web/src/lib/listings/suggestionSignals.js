import supabase from "@/lib/supabase";

/*
 * Loads the raw signals suggestListings.js turns into a taste profile, for one
 * user: recent matchmaking sessions, every saved/contacted interaction, the
 * last saved browse filter set, and their gender (for gender-restricted
 * listings). Each read is independent and failure-tolerant: a missing signal
 * just means one fewer data point, never a failed page.
 */
export async function loadSuggestionSignals(userId) {
  const [sessions, interactions, filterSummary, gender] = await Promise.all([
    supabase
      .from("matchmaking_chat_sessions")
      .select("preferences, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(10)
      .then(({ data }) => data ?? [], () => []),
    loadInteractions(userId),
    supabase
      .from("user_filter_summaries")
      .select("filters, updated_at")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => data ?? null, () => null),
    supabase
      .from("users")
      .select("gender")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => data?.gender ?? null, () => null),
  ]);
  return { sessions, interactions, filterSummary, gender };
}

async function loadInteractions(userId) {
  try {
    const { data: types } = await supabase
      .from("interaction_types")
      .select("id, name")
      .in("name", ["saved", "contacted"]);
    const nameById = Object.fromEntries((types ?? []).map((t) => [t.id, t.name]));
    if (!Object.keys(nameById).length) return [];
    const { data } = await supabase
      .from("user_listing_interactions")
      .select("listing_id, interaction_type_id, created_at")
      .eq("user_id", userId)
      .in("interaction_type_id", Object.keys(nameById));
    return (data ?? []).map((r) => ({
      listing_id: r.listing_id,
      type: nameById[r.interaction_type_id],
      created_at: r.created_at,
    }));
  } catch {
    return [];
  }
}

/*
 * The anchor for "similar to" mode: the listing a student contacted, from the
 * browse feed, plus the landlords behind it (so their other listings can rank
 * last). Usually the landlord went quiet because the place is gone, and the
 * feed drops withdrawn offerings, which would leave the anchor with no bedrooms
 * or price to compare against. So when none of its units is live, its units
 * are rebuilt from every offering, withdrawn or not.
 *
 * Returns { listing, ownerIds } or null when the listing is deleted or unknown.
 */
export async function loadAnchorListing(listingId, feed) {
  const listing = feed.find((l) => String(l._id) === String(listingId));
  if (!listing) return null;

  const { data, error } = await supabase
    .from("listings")
    .select(
      "id, listing_landlords(user_id), listing_units(bedrooms, deleted_at, unit_leases(rent, rent_is_per_person, is_active, furnished, owner_id))"
    )
    .eq("id", listingId)
    .maybeSingle();
  if (error || !data) return { listing, ownerIds: new Set(listing.owner?._id ? [String(listing.owner._id)] : []) };

  const units = (data.listing_units ?? []).filter((u) => !u.deleted_at);
  const ownerIds = new Set(
    [
      listing.owner?._id,
      ...(data.listing_landlords ?? []).map((r) => r.user_id),
      ...units.flatMap((u) => (u.unit_leases ?? []).map((l) => l.owner_id)),
    ]
      .filter(Boolean)
      .map(String)
  );

  if ((listing.unitTypes ?? []).some((u) => u.available !== false)) return { listing, ownerIds };

  const unitTypes = units.map((u) => {
    // Active offerings first, then the cheapest priced one.
    const priced = (u.unit_leases ?? [])
      .filter((l) => l.rent != null)
      .sort((a, b) => Number(b.is_active) - Number(a.is_active) || Number(a.rent) - Number(b.rent));
    const head = priced[0] ?? null;
    return {
      bedrooms: u.bedrooms != null ? Number(u.bedrooms) : null,
      rent: head ? Number(head.rent) : null,
      rentIsPerPerson: head?.rent_is_per_person ?? null,
      available: true,
      leases: (u.unit_leases ?? []).map((l) => ({ furnished: l.furnished })),
    };
  });
  return { listing: { ...listing, unitTypes }, ownerIds };
}
