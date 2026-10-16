/*
 * Demand signal shared by matchmaking ranking and suggested listings. Split out
 * of listingFilter.js so callers can import it without that module's load-time
 * side effects (Anthropic client + skill-file read).
 */
import supabase from "@/lib/supabase";

// Live saturation signal from the DB: how oversubscribed each listing already
// is. Contacts weigh more than prior recommendations (a contact is real demand;
// merely being shown is softer). Returns listing_id -> weighted count. Best-effort:
// any failure yields {} so saturation never blocks a ranking.
export async function fetchSaturation() {
  const counts = {};
  try {
    const { data: itype } = await supabase
      .from("interaction_types").select("id").eq("name", "contacted").maybeSingle();
    if (itype?.id) {
      const { data: rows } = await supabase
        .from("user_listing_interactions").select("listing_id").eq("interaction_type_id", itype.id);
      for (const r of rows ?? []) counts[r.listing_id] = (counts[r.listing_id] ?? 0) + 2;
    }
  } catch { /* best-effort */ }
  try {
    const { data: sessions } = await supabase
      .from("matchmaking_chat_sessions").select("recommendations").not("recommendations", "is", null);
    for (const s of sessions ?? []) {
      const recs = Array.isArray(s.recommendations) ? s.recommendations : s.recommendations?.ranked;
      for (const r of recs ?? []) {
        const id = r?.listing_id ?? r?.id;
        if (id) counts[id] = (counts[id] ?? 0) + 1;
      }
    }
  } catch { /* best-effort */ }
  return counts;
}
