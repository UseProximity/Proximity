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
