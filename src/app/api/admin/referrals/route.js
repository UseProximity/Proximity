/*
 * Admin referral leaderboard for the ambassador review program.
 *
 *   GET /api/admin/referrals        → ambassadors ranked by reviews they've driven
 *   GET /api/admin/referrals?q=foo  → search any user (so admins can mint a link for them)
 *
 * Counts are derived from listing_reviews.referrer_id (excluding soft-deleted reviews),
 * split into approved (legitimacy=true) and pending. Accessible to super + admin roles.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase, { getSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Respect the admin dashboard's dev/prod switch (sent as the x-db-target header).
// Falls back to NODE_ENV when absent, matching the other admin routes.
function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

async function requireSuperOrAdmin() {
  const session = await auth();
  if (!session?.user?.email) return null;
  const { data: user } = await supabase
    .from("users")
    .select("id, roles!role_id(name)")
    .eq("email", session.user.email.toLowerCase())
    .single();
  if (!user || (user.roles?.name !== "super" && user.roles?.name !== "admin")) return null;
  return user;
}

// Build a { userId: { total, approved, pending } } map from referred reviews.
async function countsForReferrerIds(db, ids) {
  if (!ids?.length) return {};
  const { data: rows } = await db
    .from("listing_reviews")
    .select("referrer_id, legitimacy")
    .in("referrer_id", ids)
    .is("deleted_at", null);
  const counts = {};
  for (const r of rows || []) {
    const c = counts[r.referrer_id] || { total: 0, approved: 0, pending: 0 };
    c.total += 1;
    if (r.legitimacy) c.approved += 1;
    else c.pending += 1;
    counts[r.referrer_id] = c;
  }
  return counts;
}

export async function GET(req) {
  try {
    const user = await requireSuperOrAdmin();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Data queries target whichever database the dashboard is switched to.
    const db = getSupabaseClient(getDbTarget(req));

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const details = (searchParams.get("details") || "").trim();

    // ── Details mode: every referred review for one ambassador ────────────────
    if (details) {
      const { data: rows, error } = await db
        .from("listing_reviews")
        .select("id, created_at, rating, reviewer:users!user_id(name, email), listings!listing_id(address)")
        .eq("referrer_id", details)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const reviews = (rows || []).map((r) => ({
        id: r.id,
        date: r.created_at,
        rating: r.rating,
        reviewerName: r.reviewer?.name || "Anonymous",
        reviewerEmail: r.reviewer?.email || null,
        address: r.listings?.address || "—",
      }));
      return NextResponse.json({ reviews });
    }

    // ── Search mode: any user matching name/email, with their referral counts ──
    if (q.length >= 2) {
      const { data: users, error } = await db
        .from("users")
        .select("id, name, email")
        .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
        .is("deleted_at", null)
        .limit(10);
      if (error) throw error;

      const counts = await countsForReferrerIds(db, (users || []).map((u) => u.id));
      const results = (users || []).map((u) => ({
        id: u.id,
        name: u.name || "Unknown",
        email: u.email || null,
        ...(counts[u.id] || { total: 0, approved: 0, pending: 0 }),
      }));
      return NextResponse.json({ results });
    }

    // ── Leaderboard mode: everyone who has driven at least one review ──────────
    const { data: refRows, error } = await db
      .from("listing_reviews")
      .select("referrer_id, legitimacy")
      .not("referrer_id", "is", null)
      .is("deleted_at", null);
    if (error) throw error;

    const counts = {};
    for (const r of refRows || []) {
      const c = counts[r.referrer_id] || { total: 0, approved: 0, pending: 0 };
      c.total += 1;
      if (r.legitimacy) c.approved += 1;
      else c.pending += 1;
      counts[r.referrer_id] = c;
    }

    const ids = Object.keys(counts);
    let usersById = {};
    if (ids.length) {
      const { data: us } = await db
        .from("users")
        .select("id, name, email")
        .in("id", ids);
      for (const u of us || []) usersById[u.id] = u;
    }

    const leaderboard = ids
      .map((id) => ({
        id,
        name: usersById[id]?.name || "Unknown",
        email: usersById[id]?.email || null,
        ...counts[id],
      }))
      .sort((a, b) => b.total - a.total || b.approved - a.approved);

    return NextResponse.json({ leaderboard });
  } catch (e) {
    console.error("GET /api/admin/referrals failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
