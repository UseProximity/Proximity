export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/emailKinds";

/*
 * The admin "Sent emails" list (Wyatt, 2026-10-24): every email the app sent,
 * newest first, 100 at a time, from sent_emails (lib/emailLog.js). Bodies are
 * not included; /api/admin/sent-emails/[id] returns one when it is opened.
 *
 * Query: category (a CATEGORIES key, or omitted for all), problems=1 (only
 * emails that bounced, were marked as spam, were refused, failed or are still
 * delayed), q (matches recipient or subject), before (an ISO time, for the
 * next page). Also returns how many emails each tab holds, under the same
 * search and problems filter.
 *
 * Honours the dashboard's dev/prod switch via the x-db-target header.
 *
 * @auth admin
 */

const PAGE = 100;
const PROBLEM_STATUSES = ["bounced", "complained", "rejected", "failed", "delayed"];
const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));
const COLUMNS =
  "id, created_at, category, kind, to_email, cc, redirected_to, subject, provider, status, status_detail, status_at, delivered_at, thread_id, user_id";

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

// PostgREST's or() filter is a comma and bracket separated string, so those
// characters (and the wildcard) are dropped from the search text.
function searchFilter(q) {
  const clean = String(q ?? "").replace(/[,()*%\\]/g, " ").trim().slice(0, 100);
  return clean ? `to_email.ilike.%${clean}%,subject.ilike.%${clean}%` : null;
}

function filtered(query, { category, problems, search }) {
  let q = query;
  if (category) q = q.eq("category", category);
  if (problems) q = q.in("status", PROBLEM_STATUSES);
  if (search) q = q.or(search);
  return q;
}

export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseClient(getDbTarget(req));
  const params = new URL(req.url).searchParams;
  const category = CATEGORY_KEYS.has(params.get("category")) ? params.get("category") : null;
  const problems = params.get("problems") === "1";
  const search = searchFilter(params.get("q"));
  const before = params.get("before");
  const beforeTime = before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : null;

  try {
    let list = filtered(supabase.from("sent_emails").select(COLUMNS), { category, problems, search })
      .order("created_at", { ascending: false })
      .limit(PAGE);
    if (beforeTime) list = list.lt("created_at", beforeTime);

    const countFor = (cat) =>
      filtered(supabase.from("sent_emails").select("id", { head: true, count: "exact" }), {
        category: cat,
        problems,
        search,
      });
    const keys = [null, ...CATEGORIES.map((c) => c.key)];
    const [rowsResult, ...countResults] = await Promise.all([list, ...keys.map(countFor)]);
    if (rowsResult.error) throw rowsResult.error;

    const counts = {};
    keys.forEach((k, i) => {
      if (countResults[i].error) throw countResults[i].error;
      counts[k ?? "all"] = countResults[i].count ?? 0;
    });

    const rows = rowsResult.data ?? [];
    return Response.json({
      rows,
      counts,
      nextBefore: rows.length === PAGE ? rows[rows.length - 1].created_at : null,
    });
  } catch (err) {
    console.error("admin sent emails failed:", err);
    return Response.json({ error: "Could not load sent emails" }, { status: 500 });
  }
}
