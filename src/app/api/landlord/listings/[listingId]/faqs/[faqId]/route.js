import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

async function resolveFaq(faqId, listingId, userId, role) {
  const { data, error } = await supabase
    .from("listing_faqs")
    .select("id, listing_id")
    .eq("id", faqId)
    .eq("listing_id", listingId)
    .single();
  if (error || !data) return { err: "Not found", status: 404 };
  if (role !== "super") {
    const { data: own } = await supabase
      .from("listing_landlords")
      .select("listing_id")
      .eq("listing_id", listingId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!own) return { err: "Forbidden", status: 403 };
  }
  return { faq: data };
}

// PATCH /api/landlord/listings/[listingId]/faqs/[faqId]
// Also handles approval of AI-generated FAQs via { is_public: true }.
export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId, faqId } = await params;
  const { err, status } = await resolveFaq(faqId, listingId, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  const body = await req.json();
  const ALLOWED = new Set(["question", "answer", "is_public", "sort_order"]);
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => ALLOWED.has(k)));
  if (!Object.keys(updates).length)
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  // When approving a previously AI-generated FAQ, stamp approved_by and approved_at.
  if (updates.is_public === true) {
    updates.approved_by = session.user.id;
    updates.approved_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("listing_faqs")
    .update(updates)
    .eq("id", faqId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/landlord/listings/[listingId]/faqs/[faqId]
export async function DELETE(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId, faqId } = await params;
  const { err, status } = await resolveFaq(faqId, listingId, session.user.id, session.user.role);
  if (err) return NextResponse.json({ error: err }, { status });

  const { error } = await supabase.from("listing_faqs").delete().eq("id", faqId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
