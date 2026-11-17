import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { clientIp } from "@/lib/auth/loginThrottle";
import { readVisitorId, newVisitorId, setVisitorCookie, anonIpLimited } from "@/lib/matchmaking/anonymousSessions";
import { findMatches } from "@/lib/findYourPlace/match";
import { getCachedListings } from "@/lib/listings/queryListings";
import { DEFAULT_FILTERS, filterListings } from "@/lib/listings/filterListings";
import { campusWalkMinutes } from "@/utils/washuPlaces";
import { sanitizeAnswers, sanitizeChips, standingChips, answeredCount, QUESTION_COUNT, TEXT_MAX, chipSentences } from "@/lib/findYourPlace/options";

export const dynamic = "force-dynamic";
// Two model calls and a read of every live listing.
export const maxDuration = 60;

const T = "matchmaking_chat_sessions";

/*
 * N on "Browse All N Matches": browse's own filter function over browse's own
 * (cached) listing feed, so the number is the number of cards the student
 * lands on. Worked out here so the page does not download the whole feed
 * just to count it. null when the feed could not be read.
 */
async function browseCount(browse) {
  if (!browse?.filters) return null;
  const listings = await getCachedListings();
  if (!listings.length) return null;
  return filterListings(listings, {
    filters: { ...DEFAULT_FILTERS, ...browse.filters },
    search: "",
    savedIds: [],
    campusMinutes: campusWalkMinutes,
  }).length;
}

/*
 * A signed-out device gets this many searches in all before it is asked to sign
 * in, counted across every search it has started (Start over included), so
 * clearing the page does not refill it. Each search is two model calls; a
 * signed-in student has no cap. A device that clears its cookie still meets the
 * per-IP limit.
 */
const VISITOR_RUN_CAP = 10;

// Searches this device has run, over every Find Your Place row it started
// (claimed ones too: signing up does not refill a later signed-out run).
async function visitorRuns(visitorId) {
  if (!visitorId) return 0;
  const { data } = await supabase.from(T).select("preferences").eq("visitor_id", visitorId).not("preferences->_fyp", "is", null);
  return (data ?? []).reduce((sum, row) => sum + (Number(row.preferences?._fyp?.runs) || 0), 0);
}

/*
 * Find Your Place: run the matcher for a set of answers and save the result.
 *
 * Signed-out visitors may run it (identified by the prx_vid device cookie) and
 * see their matches; opening or contacting a listing is gated on sign-in by the
 * page. Results are stored in matchmaking_chat_sessions, in the shape the chat
 * flow uses, so "Suggested for you", demand spreading and the mobile app's
 * history all keep reading one table.
 *
 * @auth optional
 */
export async function POST(request) {
  try {
    const requestUser = await getRequestUser(request);
    let actor = null;
    if (requestUser?.email) {
      const { data } = await supabase
        .from("users")
        .select("id, gender")
        .eq("email", requestUser.email.toLowerCase())
        .maybeSingle();
      if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });
      actor = data;
    } else if (/^bearer\b/i.test(request.headers.get("authorization") ?? "")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let visitor = readVisitorId(request);
    if (!actor && anonIpLimited(clientIp(request.headers))) {
      return NextResponse.json({ error: "busy" }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const answers = sanitizeAnswers(body.answers);
    // The page holds the same rules, so this only trips on an old saved run
    // or a hand-made request. "invalid" sends the student back to page 1.
    if (answeredCount(answers) < QUESTION_COUNT) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    const text = typeof body.text === "string" ? body.text.slice(0, TEXT_MAX).trim() : "";
    // Only the picks whose sentence is still in the box: one the student
    // deleted must not come back through the chips fallback.
    const chips = sanitizeChips(standingChips(text, body.chips));

    // Re-running updates the same row, so going Back and changing an answer
    // does not pile up sessions (or inflate how often a listing was "shown").
    let existing = null;
    if (typeof body.sessionId === "string" && /^[0-9a-f-]{36}$/i.test(body.sessionId)) {
      const { data } = await supabase.from(T).select("id, user_id, visitor_id, preferences").eq("id", body.sessionId).maybeSingle();
      const mine = data && (actor ? data.user_id === actor.id || (!data.user_id && data.visitor_id === visitor) : !data.user_id && data.visitor_id === visitor);
      if (mine && data.preferences?._fyp) existing = data;
    }

    const runs = (existing?.preferences?._fyp?.runs ?? 0) + 1;
    if (!actor && (await visitorRuns(visitor)) >= VISITOR_RUN_CAP) {
      return NextResponse.json({ error: "cap" }, { status: 429 });
    }

    const result = await findMatches({ answers, text, chips, viewerGender: actor?.gender ?? null });
    const count = await browseCount(result.browse).catch(() => null);

    const now = new Date().toISOString();
    const recommendations = result.matches.map((m) => ({
      listing_id: m.listing_id,
      score: m.score,
      intention: m.near_miss ? "Close match" : "Top match",
      reason: [m.reason, m.note].filter(Boolean).join(" "),
      ...(m.unit_split ? { unit_split: m.unit_split } : {}),
      card_data: m.card_data,
    }));
    const row = {
      status: "recommendations_ready",
      preferences: { ...result.preferences, _fyp: { answers, chips, text, parsed: result.parsed, runs } },
      weights: result.weights,
      recommendations,
      // Readable by the chat clients that still list past sessions.
      transcript: [
        { role: "user", content: text || chipSentences(chips) || "Find my place.", ts: now },
        {
          role: "assistant",
          content: recommendations.length ? "Here are your top matches." : "Nothing fits all of that right now.",
          recommendations,
          ts: now,
        },
      ],
      updated_at: now,
    };

    let sessionId = existing?.id ?? null;
    if (existing) {
      const { error } = await supabase.from(T).update({ ...row, ...(actor ? { user_id: actor.id } : {}) }).eq("id", existing.id);
      if (error) console.error("[find-your-place] session update failed:", error.message);
    } else {
      if (!actor && !visitor) visitor = newVisitorId();
      const { data, error } = await supabase
        .from(T)
        .insert({ ...row, user_id: actor?.id ?? null, visitor_id: actor ? null : visitor })
        .select("id")
        .single();
      if (error) console.error("[find-your-place] session insert failed:", error.message);
      sessionId = data?.id ?? null;
    }

    const u = result.usage;
    console.log(
      `[find-your-place] ${result.matches.length} matches of ${result.totalMatches} fits (parse:${result.parseSource} in:${(u.parse?.input_tokens ?? 0) + (u.pick?.input_tokens ?? 0)} out:${(u.parse?.output_tokens ?? 0) + (u.pick?.output_tokens ?? 0)})`
    );

    const response = NextResponse.json({
      sessionId,
      signedIn: !!actor,
      matches: result.matches.map(({ listing_id, reason, note, near_miss, price }) => ({ listing_id, reason, note, near_miss, price })),
      totalMatches: result.totalMatches,
      // What "Browse All Matches" hands to the browse page.
      browse: result.browse ? { ...result.browse, count } : null,
    });
    if (!actor && visitor) setVisitorCookie(response, visitor);
    return response;
  } catch (err) {
    console.error("[find-your-place POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/*
 * Claim: the student signed in (usually from the "save your matches" wall) on
 * the browser that ran the search signed out. The search on screen moves into
 * their account, so it shows up in their history and "Suggested for you".
 *
 * Only the one search the page names, only if this browser's device cookie
 * started it, and only while no account owns it. The matches themselves are
 * not re-ranked: they stay the four the student already saw.
 *
 * @auth user
 */
export async function PATCH(request) {
  try {
    const requestUser = await getRequestUser(request);
    if (!requestUser?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: actor } = await supabase
      .from("users")
      .select("id")
      .eq("email", requestUser.email.toLowerCase())
      .maybeSingle();
    if (!actor) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const visitor = readVisitorId(request);
    const body = await request.json().catch(() => ({}));
    const sessionId = typeof body.sessionId === "string" && /^[0-9a-f-]{36}$/i.test(body.sessionId) ? body.sessionId : null;
    if (!visitor || !sessionId) return NextResponse.json({ claimed: false });

    // `.is("user_id", null)` in the update itself, so two tabs cannot both claim
    // and a row another account claimed meanwhile is left alone.
    const { data, error } = await supabase
      .from(T)
      .update({ user_id: actor.id })
      .eq("id", sessionId)
      .eq("visitor_id", visitor)
      .is("user_id", null)
      .select("id");
    if (error) throw error;
    return NextResponse.json({ claimed: !!data?.length });
  } catch (err) {
    console.error("[find-your-place PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
