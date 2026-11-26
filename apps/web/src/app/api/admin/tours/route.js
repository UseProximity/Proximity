export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";
import { fmtTourTime, availabilityText } from "@/lib/agents/tourTime";

/*
 * GET /api/admin/tours?status=all|requested|messaging|confirmed|cancelled|expired
 *
 * Tours for the admin Conversations view's "Tours" tab (Wyatt, 2026-11-01;
 * every status since 2026-11-03, so a request stuck waiting on a landlord is
 * visible, not only confirmed ones): the listing, who is touring, whose
 * listing it is, the student's availability, the confirmed time, who
 * cancelled and why, and when anything last happened, with the direct chat
 * the tour opened and the student's Proxy chat it was asked from, so the
 * admin can open either. Confirmed tours come upcoming first then past;
 * everything else newest activity first. Times are America/Chicago.
 *
 * Read only. Honours x-db-target like the other admin reads.
 *
 * @auth admin
 */

const PAGE = 1000;
const STATUSES = new Set(["all", "requested", "proposed", "messaging", "confirmed", "cancelled", "expired"]);

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
  const requested = new URL(req.url).searchParams.get("status") ?? "all";
  const status = STATUSES.has(requested) ? requested : "all";

  try {
    let query = supabase
      .from("tour_requests")
      .select("id, listing_id, student_id, landlord_id, status, student_slots, confirmed_slot, confirmed_at, cancelled_by, cancel_reason, thread_id, proxy_thread_id, created_at, last_activity_at, listings!listing_id(id, title, address)")
      .order("created_at", { ascending: false });
    if (status !== "all") query = query.eq("status", status);
    const tours = await fetchAll(query);
    const ids = [...new Set(tours.flatMap((t) => [t.student_id, t.landlord_id, t.cancelled_by]).filter(Boolean))];
    const users = ids.length ? await fetchAll(supabase.from("users").select("id, name, email").in("id", ids)) : [];
    const byId = new Map(users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email }]));
    const now = Date.now();

    const out = tours.map((t) => ({
      id: t.id,
      status: t.status,
      listing: t.listings ?? { id: t.listing_id },
      student: byId.get(t.student_id) ?? { id: t.student_id },
      landlord: byId.get(t.landlord_id) ?? (t.landlord_id ? { id: t.landlord_id } : null),
      availabilityText: (t.student_slots ?? []).length ? availabilityText(t.student_slots) : null,
      cancelledBy: !t.cancelled_by ? null : t.cancelled_by === t.student_id ? "student" : t.cancelled_by === t.landlord_id ? "landlord" : "someone else",
      cancelReason: t.cancel_reason,
      lastActivityAt: t.last_activity_at ?? t.created_at,
      confirmedSlot: t.confirmed_slot,
      confirmedText: t.confirmed_slot ? fmtTourTime(t.confirmed_slot) : null,
      confirmedAt: t.confirmed_at,
      upcoming: !!t.confirmed_slot && Date.parse(t.confirmed_slot) >= now,
      directThreadId: t.thread_id,
      proxyThreadId: t.proxy_thread_id,
      createdAt: t.created_at,
    }));
    // Confirmed: upcoming soonest first, then past most recent first.
    // Everything else: newest activity first.
    const bySlot = (a, b) => Date.parse(a.confirmedSlot ?? 0) - Date.parse(b.confirmedSlot ?? 0);
    const confirmed = out.filter((t) => t.status === "confirmed");
    const upcoming = confirmed.filter((t) => t.upcoming).sort(bySlot);
    const past = confirmed.filter((t) => !t.upcoming).sort(bySlot).reverse();
    const rest = out.filter((t) => t.status !== "confirmed")
      .sort((a, b) => Date.parse(b.lastActivityAt ?? 0) - Date.parse(a.lastActivityAt ?? 0));
    return Response.json([...upcoming, ...past, ...rest]);
  } catch (err) {
    console.error("GET /api/admin/tours failed:", err);
    return Response.json({ error: "Could not load tours" }, { status: 500 });
  }
}
