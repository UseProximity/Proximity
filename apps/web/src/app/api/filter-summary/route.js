import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getRequestUser } from "@/lib/getRequestUser";
import { cleanFilterSummary } from "@/lib/listings/suggestListings";

/**
 * @auth any
 *
 * POST /api/filter-summary  { filters }
 * Records the browse filters a student just saved (Done / Apply Filters) as
 * their running filter summary: one row per user, overwritten each time. It is
 * the lightest-weighted signal behind "Suggested for you".
 *
 * Only known filter keys are kept (cleanFilterSummary). Saving an empty set,
 * e.g. right after Reset, leaves the previous summary alone: clearing filters
 * says nothing about taste.
 */
export async function POST(req) {
  try {
    const user = await getRequestUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const filters = cleanFilterSummary(body?.filters);
    if (!Object.keys(filters).length) return NextResponse.json({ ok: true, skipped: true });

    // Service-role write, like matchmaking_chat_sessions: not a table the
    // write-as-user RPCs cover, and nothing here is worth an audit trail.
    const { error } = await supabase
      .from("user_filter_summaries")
      .upsert(
        { user_id: user.id, filters, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    if (error) {
      console.error("[filter-summary] save failed:", error.message);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[filter-summary] save failed:", err?.message ?? err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
