import supabase from "@/lib/supabase";

/*
 * A review this person has already posted on this listing with the same text.
 *
 * The form blocks a double click while a request is in flight, but nothing
 * stops a second submit after the first one lands: going back to the still
 * filled form, or a phone that missed the first response and offered "try
 * again". Both produced a second identical row and a second landlord email.
 *
 * Only the text is compared, not the ratings: the same words posted twice on
 * one listing by one person is a resubmission whatever the stars say. A second
 * review with different words (another unit, another year) is left alone.
 *
 * Returns the existing row, or null. A failed lookup returns null so a database
 * hiccup never blocks a genuine review.
 */
export async function findDuplicateReview({ userId, listingId, comment }) {
  const text = String(comment || "").trim();
  if (!userId || !listingId || !text) return null;
  const { data, error } = await supabase
    .from("listing_reviews")
    .select("*")
    .eq("user_id", userId)
    .eq("listing_id", listingId)
    .eq("comment", text)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) {
    console.error("[reviews] duplicate lookup failed:", error.message);
    return null;
  }
  return data?.[0] ?? null;
}
