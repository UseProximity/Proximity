/*
 * Ambassador home page (/refer).
 *   - Logged out  → recruiting landing + inline sign in / sign up (AuthCard, same flow
 *                   and styling as /login — no redirect to a separate page).
 *   - Logged in   → ambassador dashboard: shareable link, headline count of reviews
 *                   driven, a list of each referred review (reviewer name + property),
 *                   and a public top-3 ambassador leaderboard at the bottom.
 * The per-ambassador public review form lives at /refer/<ambassadorId>.
 */
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import AuthCard from "@/components/auth/AuthCard";
import { CopyLinkBox } from "./ReferClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Proximity Ambassadors",
  robots: { index: false, follow: false },
};

// Top 3 ambassadors by number of (non-deleted) referred reviews.
// Names are intentionally NOT returned — the public leaderboard shows rank + count only.
async function getTopReferrers() {
  const { data: rows } = await supabase
    .from("listing_reviews")
    .select("referrer_id")
    .not("referrer_id", "is", null)
    .is("deleted_at", null);
  const counts = {};
  for (const r of rows || []) counts[r.referrer_id] = (counts[r.referrer_id] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, count], idx) => ({ id, rank: idx + 1, count }));
}

export default async function ReferHome() {
  const session = await auth();

  // ── Logged out: recruiting landing + inline auth ────────────────────────
  if (!session?.user?.id) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Become a Proximity Ambassador
          </h1>
          <p className="text-gray-600">
            Get a personal link to share with fellow students. Every property review
            submitted through your link is credited to you — and you can track how many
            you’ve driven right here.
          </p>
        </div>
        <div className="flex justify-center">
          <AuthCard callbackUrl="/refer" initialTab="signup" />
        </div>
      </div>
    );
  }

  // ── Logged in: dashboard ────────────────────────────────────────────────
  const userId = session.user.id;
  const [{ data: reviews }, top3] = await Promise.all([
    supabase
      .from("listing_reviews")
      .select("id, created_at, rating, reviewer:users!user_id(name), listings!listing_id(address)")
      .eq("referrer_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    getTopReferrers(),
  ]);

  const list = (reviews || []).map((r) => ({
    id: r.id,
    date: r.created_at,
    rating: r.rating,
    reviewerName: r.reviewer?.name || "Anonymous",
    address: r.listings?.address || "—",
  }));
  const count = list.length;
  const medal = (rank) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉");
  const prize = (rank) => (rank === 1 ? "$50" : rank === 2 ? "$30" : "$15");

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Your ambassador dashboard</h1>
        <p className="text-gray-600 mt-1">Share your link and track the reviews you drive.</p>
      </header>

      <CopyLinkBox userId={userId} />

      <div className="mt-6 bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="text-4xl font-bold text-gray-900">{count}</div>
        <div className="text-sm text-gray-500">
          review{count === 1 ? "" : "s"} submitted with your link
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-2">Reviews you’ve driven</h2>
        {list.length === 0 ? (
          <p className="text-sm text-gray-400">
            No reviews yet. Share your link to get started!
          </p>
        ) : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 overflow-hidden bg-white">
            {list.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{r.reviewerName}</div>
                  <div className="text-sm text-gray-500 truncate">{r.address}</div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs font-semibold text-yellow-600">{r.rating}★</span>
                  <span className="text-xs text-gray-400">
                    {new Date(r.date).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Public top-3 leaderboard */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">🏆 Top ambassadors</h2>
        <p className="text-xs text-gray-500 mb-2">
          Prizes: 🥇 $50 · 🥈 $30 · 🥉 $15
        </p>
        {top3.length === 0 ? (
          <p className="text-sm text-gray-400">No referrals yet — be the first!</p>
        ) : (
          <ol className="rounded-xl border border-gray-100 overflow-hidden bg-white divide-y divide-gray-100">
            {top3.map((t) => (
              <li
                key={t.id}
                className={`flex items-center justify-between px-4 py-3 ${
                  t.id === userId ? "bg-red-50" : ""
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="text-lg">{medal(t.rank)}</span>
                  <span className="font-medium text-gray-900">
                    {t.rank === 1 ? "1st place" : t.rank === 2 ? "2nd place" : "3rd place"}
                    <span className="text-green-600 text-sm"> - {prize(t.rank)}</span>
                    {t.id === userId && <span className="text-red-600"> (you)</span>}
                  </span>
                </span>
                <span className="text-sm font-bold text-gray-900">
                  {t.count} review{t.count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
