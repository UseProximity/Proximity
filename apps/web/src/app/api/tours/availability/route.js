/*
 * GET  /api/tours/availability   the signed-in student's weekly pattern,
 *                                phone and email, and the real-date slots
 *                                the pattern gives over the next 14 days
 * PUT  /api/tours/availability   { pattern }  save the pattern
 *
 * @auth user
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { getAvailability, saveAvailability, slotsFromPattern } from "@/lib/agents/tours";

export async function GET(req) {
  const user = await getRequestUser(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [pattern, { data: me }, { data: tours }] = await Promise.all([
      getAvailability(user.id),
      supabase.from("users").select("phone, email").eq("id", user.id).maybeSingle(),
      // Tours already booked, on their exact dates, for the picker to grey out (Wyatt, 2026-11-02).
      supabase.from("tour_requests").select("confirmed_slot, listings!listing_id(title, address)")
        .eq("student_id", user.id).eq("status", "confirmed").gte("confirmed_slot", new Date(Date.now() - 3600 * 1000).toISOString()),
    ]);
    return NextResponse.json({
      pattern, slots: slotsFromPattern(pattern),
      booked: (tours ?? []).filter((t) => t.confirmed_slot).map((t) => ({ at: t.confirmed_slot, listing: t.listings?.title || t.listings?.address || "a listing" })),
      phone: me?.phone && me.phone !== "N/A" ? me.phone : "", email: me?.email ?? null,
    });
  } catch (err) {
    console.error("GET /api/tours/availability failed:", err);
    return NextResponse.json({ error: "Could not load availability" }, { status: 500 });
  }
}

export async function PUT(req) {
  const user = await getRequestUser(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const pattern = await saveAvailability(user.id, body?.pattern ?? {});
    return NextResponse.json({ pattern, slots: slotsFromPattern(pattern) });
  } catch (err) {
    console.error("PUT /api/tours/availability failed:", err);
    return NextResponse.json({ error: "Could not save availability" }, { status: 500 });
  }
}
