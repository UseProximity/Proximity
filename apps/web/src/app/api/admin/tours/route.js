export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";
import { fmtTourTime } from "@/lib/agents/tourTime";

/*
 * GET /api/admin/tours?status=confirmed
 *
 * Tours for the admin Conversations view's "Confirmed tours" tab (Wyatt,
 * 2026-11-01): the listing, who is touring, whose listing it is and when,
 * upcoming first then past, with the direct chat the tour opened and the
 * student's Proxy chat it was asked from, so the admin can open either.
 * Times are America/Chicago.
 *
 * Read only. Honours x-db-target like the other admin reads.
 *
 * @auth admin
 */

const PAGE = 1000;
const STATUSES = new Set(["requested", "proposed", "messaging", "confirmed", "cancelled", "expired"]);

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

async function fetchAll(query) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const supabase = getSupabaseClient(getDbTarget(req));
  const requested = new URL(req.url).searchParams.get("status") ?? "confirmed";
  const status = STATUSES.has(requested) ? requested : "confirmed";

  try {
    const tours = await fetchAll(
      supabase
        .from("tour_requests")
        .select("id, listing_id, student_id, landlord_id, status, confirmed_slot, confirmed_at, thread_id, proxy_thread_id, created_at, listings!listing_id(id, title, address)")
        .eq("status", status)
        .order("confirmed_slot", { ascending: true, nullsFirst: false })
    );
    const ids = [...new Set(tours.flatMap((t) => [t.student_id, t.landlord_id]).filter(Boolean))];
    const users = ids.length ? await fetchAll(supabase.from("users").select("id, name, email").in("id", ids)) : [];
    const byId = new Map(users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email }]));
    const now = Date.now();

    const out = tours.map((t) => ({
      id: t.id,
      status: t.status,
      listing: t.listings ?? { id: t.listing_id },
      student: byId.get(t.student_id) ?? { id: t.student_id },
      landlord: byId.get(t.landlord_id) ?? (t.landlord_id ? { id: t.landlord_id } : null),
      confirmedSlot: t.confirmed_slot,
      confirmedText: t.confirmed_slot ? fmtTourTime(t.confirmed_slot) : null,
      confirmedAt: t.confirmed_at,
      upcoming: !!t.confirmed_slot && Date.parse(t.confirmed_slot) >= now,
      directThreadId: t.thread_id,
      proxyThreadId: t.proxy_thread_id,
      createdAt: t.created_at,
    }));
    // Upcoming soonest first, then past most recent first.
    const upcoming = out.filter((t) => t.upcoming);
    const past = out.filter((t) => !t.upcoming).reverse();
    return Response.json([...upcoming, ...past]);
  } catch (err) {
    console.error("GET /api/admin/tours failed:", err);
    return Response.json({ error: "Could not load tours" }, { status: 500 });
  }
}
