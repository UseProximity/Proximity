import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { updateAsUser } from "@/lib/supabaseWithUser";

async function getRoleUser() {
  const session = await auth();
  if (!session?.user?.email) return null;
  const { data: user } = await supabase
    .from("users")
    .select("id, roles!role_id(name)")
    .eq("email", session.user.email.toLowerCase())
    .single();
  return user;
}

async function requireSuper() {
  const user = await getRoleUser();
  if (!user || user.roles?.name !== "super") return null;
  return user;
}

async function requireSuperOrAdmin() {
  const user = await getRoleUser();
  if (!user || (user.roles?.name !== "super" && user.roles?.name !== "admin")) return null;
  return user;
}

export async function GET() {
  try {
    const user = await requireSuperOrAdmin();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: reviews, error } = await supabase
      .from("listing_reviews")
      .select("*, reviewer:users!user_id(name, email, image), listings!listing_id(address, title)")
      .eq("legitimacy", false)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json(reviews || []);
  } catch (err) {
    console.error("admin/pending-reviews GET:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const user = await requireSuper();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { reviewId } = await request.json();
    if (!reviewId) return NextResponse.json({ error: "reviewId required" }, { status: 400 });

    const { data: review, error: fetchErr } = await supabase
      .from("listing_reviews")
      .select("id, listing_id")
      .eq("id", reviewId)
      .single();
    if (fetchErr || !review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

    await updateAsUser(supabase, { userId: user.id, table: "listing_reviews", data: { legitimacy: true }, rowId: reviewId });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("admin/pending-reviews PATCH:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const user = await requireSuper();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { reviewId } = await request.json();
    if (!reviewId) return NextResponse.json({ error: "reviewId required" }, { status: 400 });

    const { data: review, error: fetchErr } = await supabase
      .from("listing_reviews")
      .select("id, listing_id")
      .eq("id", reviewId)
      .single();
    if (fetchErr || !review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

    await updateAsUser(supabase, { userId: user.id, table: "listing_reviews", data: { deleted_at: new Date().toISOString() }, rowId: reviewId });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("admin/pending-reviews DELETE:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
