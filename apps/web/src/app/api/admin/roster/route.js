/*
 * The student roster, with invite status attached, for the bulk-send picker.
 *
 * @auth admin
 *
 * Reads student_roster_invite_status (see its migration): the roster left-joined
 * to its most recent invite, so "already asked" is derived rather than stored
 * and cannot drift from the ledger.
 *
 * Two modes:
 *   - browse   (default) paged, searchable, filterable. What the picker table shows.
 *   - sample=N a random draw of people we have not contacted, for "just give me
 *              200 to email". Constrained to rows WITH a first name, because the
 *              message template interpolates one and "Hi ," is worse than not
 *              sending at all.
 *
 * This never returns a token or anything from review_invites beyond timestamps.
 * The roster is bulk PII for people who have no account with us, so it is admin
 * only and never reachable from the browser key (RLS on the base table, and the
 * view is security_invoker so it inherits that rather than bypassing it).
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

export const dynamic = "force-dynamic";

const VIEW = "student_roster_invite_status";
const COLUMNS = "id, email, first_name, last_name, class_year, has_first_name, invited, last_invited_at, review_written_at";

// PostgREST caps a single response at 1000 rows, so anything that needs the
// whole eligible set has to walk it a page at a time.
const PAGE = 1000;
const MAX_SAMPLE = 1000;

async function requireSuperOrAdmin() {
  const session = await auth();
  if (!session?.user?.email) return null;
  const { data: user } = await supabase
    .from("users")
    .select("id, roles!role_id(name)")
    .eq("email", session.user.email.toLowerCase())
    .maybeSingle();
  if (!user || (user.roles?.name !== "super" && user.roles?.name !== "admin")) return null;
  return user;
}

/** Apply the shared filters so browse and sample can never disagree about who is eligible. */
function applyFilters(query, { q, status, withFirstName }) {
  if (q) {
    // Match on any of the three things an admin would actually type.
    const term = `%${q}%`;
    query = query.or(
      `email.ilike.${term},first_name.ilike.${term},last_name.ilike.${term}`
    );
  }
  if (status === "uncontacted") query = query.eq("invited", false);
  if (status === "contacted") query = query.eq("invited", true);
  if (withFirstName) query = query.eq("has_first_name", true);
  return query;
}

/*
 * Fisher-Yates. Math.random is right here: this picks who gets an email, not
 * anything an attacker gains from predicting, and the alternative (ordering by
 * random() in the database) would mean a second round trip for no benefit.
 */
function shuffle(rows) {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function GET(req) {
  try {
    const user = await requireSuperOrAdmin();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const status = url.searchParams.get("status") || "all";
    const withFirstName = url.searchParams.get("withFirstName") === "1";
    const sample = Number(url.searchParams.get("sample")) || 0;

    /*
     * The headline numbers, always returned so the UI can say "5,364 of 6,595
     * can be emailed" without a second request. head:true asks for the count
     * alone, so these cost no rows.
     */
    const [{ count: total }, { count: sendable }, { count: invited }, { count: noFirstName }] =
      await Promise.all([
        supabase.from(VIEW).select("id", { count: "exact", head: true }),
        supabase.from(VIEW).select("id", { count: "exact", head: true })
          .eq("invited", false).eq("has_first_name", true),
        supabase.from(VIEW).select("id", { count: "exact", head: true }).eq("invited", true),
        supabase.from(VIEW).select("id", { count: "exact", head: true }).eq("has_first_name", false),
      ]);

    const counts = {
      total: total ?? 0,
      sendable: sendable ?? 0,
      invited: invited ?? 0,
      missingFirstName: noFirstName ?? 0,
    };

    // ── Random draw ────────────────────────────────────────────────────────
    if (sample > 0) {
      const want = Math.min(sample, MAX_SAMPLE);
      /*
       * Always uncontacted AND named, whatever the browse filters say. This is
       * the "just pick some people for me" button, and the two rules it must
       * never break are the two the caller is most likely to forget.
       *
       * IDS FIRST, then hydrate the winners. A fair shuffle needs the whole
       * eligible set in hand, but it does not need every column of it: pulling
       * ids alone keeps that walk to a fraction of the payload, and the rows
       * actually drawn are fetched in one follow-up query.
       */
      const ids = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await applyFilters(
          supabase.from(VIEW).select("id"),
          { q, status: "uncontacted", withFirstName: true }
        )
          .order("email", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data?.length) break;
        ids.push(...data.map((r) => r.id));
        if (data.length < PAGE) break;
      }

      const drawn = shuffle(ids).slice(0, want);
      let rows = [];
      if (drawn.length) {
        const { data, error } = await supabase.from(VIEW).select(COLUMNS).in("id", drawn);
        if (error) throw error;
        rows = data || [];
      }

      return NextResponse.json({
        rows,
        // What the pool actually held, so the UI can say "you asked for 500,
        // there are only 340 left" rather than silently returning fewer.
        poolSize: ids.length,
        counts,
      });
    }

    // ── Browse ─────────────────────────────────────────────────────────────
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

    const { data, count: matched, error } = await applyFilters(
      supabase.from(VIEW).select(COLUMNS, { count: "exact" }),
      { q, status, withFirstName }
    )
      .order("email", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return NextResponse.json({ rows: data || [], matched: matched ?? 0, counts });
  } catch (err) {
    console.error("admin/roster GET:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
