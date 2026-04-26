export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";
import { insertAsUser, updateAsUser, deleteAsUser } from "@/libs/supabaseWithUser";

async function requireOwnership(listingId) {
  const session = await auth();
  if (!session?.user?.id) return { err: "Unauthorized", status: 401 };
  if (session.user.role === "super") return { session };
  if (!["landlord"].includes(session.user.role)) return { err: "Forbidden", status: 403 };

  const { data: own } = await supabase
    .from("listing_landlords")
    .select("listing_id, is_primary")
    .eq("listing_id", listingId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!own) return { err: "Forbidden", status: 403 };
  return { session, isPrimary: own.is_primary };
}

// GET /api/landlord/listings/[listingId]/landlords
export async function GET(_req, { params }) {
  const { listingId } = await params;
  const check = await requireOwnership(listingId);
  if (check.err) return NextResponse.json({ error: check.err }, { status: check.status });

  const { data: rows, error } = await supabase
    .from("listing_landlords")
    .select("user_id, is_primary")
    .eq("listing_id", listingId)
    .order("is_primary", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = rows.map((r) => r.user_id);
  const { data: users } = await supabase
    .from("users")
    .select("id, name, email")
    .in("id", userIds);

  const usersMap = Object.fromEntries((users ?? []).map((u) => [u.id, u]));

  const landlords = rows.map((r) => ({
    userId: r.user_id,
    isPrimary: r.is_primary,
    name: usersMap[r.user_id]?.name ?? null,
    email: usersMap[r.user_id]?.email ?? null,
  }));

  return NextResponse.json(landlords);
}

// POST /api/landlord/listings/[listingId]/landlords — body: { email }
export async function POST(req, { params }) {
  const { listingId } = await params;
  const check = await requireOwnership(listingId);
  if (check.err) return NextResponse.json({ error: check.err }, { status: check.status });

  const { email } = await req.json();
  if (!email?.trim()) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const { data: targetUser, error: userErr } = await supabase
    .from("users")
    .select("id, name, email")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });
  if (!targetUser) return NextResponse.json({ error: "No account found with that email." }, { status: 404 });

  const { data: existing } = await supabase
    .from("listing_landlords")
    .select("user_id")
    .eq("listing_id", listingId)
    .eq("user_id", targetUser.id)
    .maybeSingle();

  if (existing) return NextResponse.json({ error: "That person is already a co-owner." }, { status: 409 });

  const { error: insertErr } = await insertAsUser(supabase, {
    userId: check.session.user.id,
    table: "listing_landlords",
    data: { listing_id: listingId, user_id: targetUser.id, is_primary: false },
  });

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({
    userId: targetUser.id,
    isPrimary: false,
    name: targetUser.name,
    email: targetUser.email,
  });
}

// PATCH /api/landlord/listings/[listingId]/landlords — body: { userId } — transfer primary to userId
export async function PATCH(req, { params }) {
  const { listingId } = await params;
  const check = await requireOwnership(listingId);
  if (check.err) return NextResponse.json({ error: check.err }, { status: check.status });

  if (!check.isPrimary && check.session.user.role !== "super") {
    return NextResponse.json({ error: "Only the primary owner can transfer primary status." }, { status: 403 });
  }

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const { data: target } = await supabase
    .from("listing_landlords")
    .select("user_id")
    .eq("listing_id", listingId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "That user is not a co-owner of this listing." }, { status: 404 });

  const actorId = check.session.user.id;

  const { error: clearErr } = await updateAsUser(supabase, {
    userId: actorId,
    table: "listing_landlords",
    data: { is_primary: false },
    match: { listing_id: listingId },
  });

  if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 });

  const { error: setErr } = await updateAsUser(supabase, {
    userId: actorId,
    table: "listing_landlords",
    data: { is_primary: true },
    match: { listing_id: listingId, user_id: userId },
  });

  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/landlord/listings/[listingId]/landlords — body: { userId }
export async function DELETE(req, { params }) {
  const { listingId } = await params;
  const check = await requireOwnership(listingId);
  if (check.err) return NextResponse.json({ error: check.err }, { status: check.status });

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const { data: target } = await supabase
    .from("listing_landlords")
    .select("is_primary")
    .eq("listing_id", listingId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "Not a co-owner of this listing." }, { status: 404 });
  if (target.is_primary) return NextResponse.json({ error: "Cannot remove the primary owner." }, { status: 400 });

  const { error } = await deleteAsUser(supabase, {
    userId: check.session.user.id,
    table: "listing_landlords",
    match: { listing_id: listingId, user_id: userId },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
