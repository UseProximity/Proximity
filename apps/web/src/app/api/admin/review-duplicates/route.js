export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";
import { PROXIMITY_PLACEHOLDER_EMAIL } from "@/lib/listings/placeholderOwner";
import { findReviewDuplicateSuspects } from "@/lib/reviews/duplicateReport";

/*
 * GET /api/admin/review-duplicates
 *     Properties made by a student review that may be a building already
 *     listed under another address (lib/reviews/duplicateReport.js). Read
 *     only: it names the pairs, a person decides, and nothing is merged here.
 *
 * Honours x-db-target like the other admin reads.
 *
 * @auth admin
 */

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const supabase = getSupabaseClient(getDbTarget(req));
  try {
    // Looked up, never created: a read must not write to the database it is reading.
    const { data: placeholder } = await supabase
      .from("users")
      .select("id")
      .eq("email", PROXIMITY_PLACEHOLDER_EMAIL)
      .maybeSingle();
    const suspects = await findReviewDuplicateSuspects(supabase, placeholder?.id ?? null);
    return Response.json(suspects, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("GET /api/admin/review-duplicates failed:", err);
    return Response.json({ error: "Could not load possible duplicates" }, { status: 500 });
  }
}
