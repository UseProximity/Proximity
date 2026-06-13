/*
 * Ambassador home page (/refer).
 *   - Logged out  → recruiting landing + inline sign in / sign up (AuthCard, same flow
 *                   and styling as /login — no redirect to a separate page).
 *   - Logged in   → ambassador dashboard: shareable link, payout method, headline count of
 *                   reviews driven + earnings ($3/review), a list of each referred review,
 *                   and a public ambassador leaderboard with prize/tie handling.
 * The per-ambassador public review form lives at /refer/<ambassadorId>.
 */
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import AuthCard from "@/components/auth/AuthCard";
import { CopyLinkBox, Countdown, PaymentMethodBox } from "./ReferClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Proximity Ambassadors",
  robots: { index: false, follow: false },
};

// ── Game constants ──────────────────────────────────────────────────────────
const PER_REVIEW = 3;                       // $ earned per referred review
const PRIZE_POOL = { 1: 50, 2: 30, 3: 15 }; // bonus prizes by finishing position

function poolAt(pos) {
  return PRIZE_POOL[pos] || 0;
}
function ordinal(pos) {
  return pos === 1 ? "1st" : pos === 2 ? "2nd" : pos === 3 ? "3rd" : `${pos}th`;
}
function medalFor(pos) {
  return pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "🎖️";
}
function money(n) {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

// Map of referrer_id → number of non-deleted reviews they've driven.
async function getReferrerCounts() {
  const { data: rows } = await supabase
    .from("listing_reviews")
    .select("referrer_id")
    .not("referrer_id", "is", null)
    .is("deleted_at", null);
  const counts = {};
  for (const r of rows || []) counts[r.referrer_id] = (counts[r.referrer_id] || 0) + 1;
  return counts;
}

/*
 * Build the public leaderboard from a { id: count } map.
 *
 * Ambassadors are ranked by review count (desc) and grouped by ties. Each group occupies
 * consecutive finishing positions; a group's members evenly split the combined prize money
 * of the positions they occupy (e.g. two tied for 1st occupy positions 1+2 → split $50+$30
 * = $40 each). Every group that starts within the top 3 positions is shown in full, so ties
 * that cross the 3rd-place line simply overflow into extra cards.
 *
 * Returns { cards, userCount, userRank, userShown } where cards is a flat list (one per
 * shown ambassador) and userRank is the viewer's competition rank if they aren't shown.
 */
function buildLeaderboard(counts, userId) {
  const entries = Object.entries(counts).map(([id, count]) => ({ id, count }));
  entries.sort((a, b) => b.count - a.count);

  const cards = [];
  let pos = 1;
  let i = 0;
  while (i < entries.length) {
    let j = i;
    while (j < entries.length && entries[j].count === entries[i].count) j++;
    const size = j - i;
    const startPos = pos;
    const endPos = pos + size - 1;
    if (startPos > 3) break; // groups beyond 3rd place aren't shown

    let total = 0;
    for (let p = startPos; p <= endPos; p++) total += poolAt(p);
    const prizeEach = total / size;

    for (let k = i; k < j; k++) {
      cards.push({
        id: entries[k].id,
        count: entries[k].count,
        startPos,
        tied: size > 1,
        prizeEach,
        isYou: entries[k].id === userId,
      });
    }

    pos = endPos + 1;
    i = j;
  }

  const userCount = counts[userId] || 0;
  const userRank = 1 + entries.filter((e) => e.count > userCount).length;
  const userShown = cards.some((c) => c.isYou);

  return { cards, userCount, userRank, userShown };
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
            Get a personal link to share with fellow students. Earn $3 for every property
            review submitted through your link and compete for cash prizes on the
            ambassador leaderboard.
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
  const [{ data: reviews }, counts] = await Promise.all([
    supabase
      .from("listing_reviews")
      .select("id, created_at, rating, reviewer:users!user_id(name), listings!listing_id(address)")
      .eq("referrer_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    getReferrerCounts(),
  ]);

  const list = (reviews || []).map((r) => ({
    id: r.id,
    date: r.created_at,
    rating: r.rating,
    reviewerName: r.reviewer?.name || "Anonymous",
    address: r.listings?.address || "—",
  }));
  const count = list.length;
  const earnings = count * PER_REVIEW;

  const { cards, userCount, userRank, userShown } = buildLeaderboard(counts, userId);

  return (
    <div className="w-full px-6 sm:px-10 lg:px-16 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Your ambassador dashboard</h1>
        <p className="text-gray-600 mt-1">Share your link and track the reviews you drive.</p>
      </header>

      {/* Three columns: details (left) · timer + leaderboard (middle) · link + stats (right) */}
      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        {/* Left — how the game works */}
        <section className="rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">How the ambassador game works</h2>
          <ul className="text-sm text-gray-600 space-y-3 list-disc pl-5">
            <li>
              Share your personal link with fellow students. Every property review submitted
              through it is credited to you.
            </li>
            <li>
              Earn <span className="font-semibold text-gray-900">${PER_REVIEW}</span> for every
              review submitted through your link
            </li>
            <li>
              When the competition ends, the top ambassadors win bonus prizes:{" "}
              <span className="whitespace-nowrap">🥇 $50</span> ·{" "}
              <span className="whitespace-nowrap">🥈 $30</span> ·{" "}
              <span className="whitespace-nowrap">🥉 $15</span>.
            </li>
            <li>
              If ambassadors tie, they split their combined prize money evenly (e.g. two tied
              for 1st split $50 + $30 = $40 each).
            </li>
          </ul>
        </section>

        {/* Middle — competition timer + leaderboard */}
        <section className="flex flex-col gap-6">
          <Countdown />

          <div>
            <h2 className="text-sm font-semibold text-gray-800 mb-1">🏆 Top ambassadors</h2>
            <p className="text-xs text-gray-500 mb-3">
              Prizes: 🥇 $50 · 🥈 $30 · 🥉 $15. Tied ambassadors split their combined prizes evenly.
            </p>

            {cards.length === 0 ? (
              <p className="text-sm text-gray-400">No referrals yet — be the first!</p>
            ) : (
              <div className="flex flex-col gap-2">
                {cards.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border ${
                      c.isYou ? "border-red-300 bg-red-50" : "border-gray-100 bg-white"
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <span className="text-2xl leading-none">{medalFor(c.startPos)}</span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-gray-900">
                          {c.tied ? `Tied for ${ordinal(c.startPos)}` : `${ordinal(c.startPos)} place`}
                          {c.isYou && <span className="text-red-600 text-sm"> (you)</span>}
                        </span>
                        <span className="text-green-600 text-sm font-medium">
                          {money(c.prizeEach)}
                          {c.tied ? " each" : ""}
                        </span>
                      </span>
                    </span>
                    <span className="text-sm font-bold text-gray-900 whitespace-nowrap">
                      {c.count} review{c.count === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {cards.length > 0 && !userShown && (
              <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                {userCount === 0 ? (
                  <>You haven’t driven any reviews yet. Share your link to get on the board!</>
                ) : (
                  <>
                    You’re currently{" "}
                    <span className="font-semibold text-gray-900">#{userRank}</span> with{" "}
                    {userCount} review{userCount === 1 ? "" : "s"}. Keep sharing to reach the top 3!
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Right — referral link + individual stats */}
        <section className="flex flex-col gap-4">
          <CopyLinkBox userId={userId} />

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <div className="text-4xl font-bold text-gray-900">{count}</div>
            <div className="text-sm text-gray-500">
              review{count === 1 ? "" : "s"} submitted with your link
            </div>
            <div className="mt-2 text-sm font-semibold text-green-600">
              ${earnings} earned so far{" "}
              <span className="font-normal text-gray-400">· ${PER_REVIEW} per review</span>
            </div>
          </div>

          <PaymentMethodBox />

          <div>
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
        </section>
      </div>
    </div>
  );
}
