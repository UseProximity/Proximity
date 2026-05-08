import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

async function requireOwnership(listingId, userId, role) {
  if (role === "super") return true;
  const { data } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("listing_id", listingId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

// GET /api/landlord/listings/[listingId]/faqs
// Returns all FAQs (including pending AI-generated ones needing approval).
export async function GET(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;
  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("listing_faqs")
    .select("*")
    .eq("listing_id", listingId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/landlord/listings/[listingId]/faqs
// Body: { question, answer, source?, sort_order? }
// Landlord-authored FAQs are immediately public; AI-generated ones require approval.
export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;
  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  if (!body.question?.trim() || !body.answer?.trim())
    return NextResponse.json({ error: "question and answer required" }, { status: 400 });

  const source = body.source ?? "landlord_authored";
  const VALID_SOURCES = ["landlord_authored", "ai_from_chat", "ai_from_lease", "admin"];
  if (!VALID_SOURCES.includes(source))
    return NextResponse.json({ error: `source must be one of: ${VALID_SOURCES.join(", ")}` }, { status: 400 });

  const isLandlordAuthored = source === "landlord_authored";

  const { data, error } = await supabase
    .from("listing_faqs")
    .insert({
      listing_id: listingId,
      question: body.question.trim(),
      answer: body.answer.trim(),
      source,
      is_public: isLandlordAuthored,
      approved_by: isLandlordAuthored ? session.user.id : null,
      approved_at: isLandlordAuthored ? new Date().toISOString() : null,
      sort_order: body.sort_order ?? 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
