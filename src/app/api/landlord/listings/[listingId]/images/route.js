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

// PATCH /api/landlord/listings/[listingId]/images
// Body: { urls: string[] } — full ordered list of image URLs.
// Updates sort_order for each image to match the supplied order.
export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { listingId } = await params;
  if (!await requireOwnership(listingId, session.user.id, session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { urls } = await req.json();
  if (!Array.isArray(urls)) return NextResponse.json({ error: "urls array required" }, { status: 400 });

  await Promise.all(
    urls.map((url, i) =>
      supabase
        .from("listing_images")
        .update({ sort_order: i })
        .eq("listing_id", listingId)
        .eq("url", url)
    )
  );

  return NextResponse.json({ ok: true });
}
