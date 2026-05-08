import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

// POST /api/landlord/listings/draft
// Creates a minimal listing draft (no leases yet).
// The wizard adds leases in a later step.
// Body: { address, longitude, latitude, description, title?, homeType?,
//         leaseStructure?, furnished?, subleaseFriendly?, twentyOnePlus?,
//         contactEmail?, contactPhone?, contactName?, moveInDate? }
export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { address, longitude, latitude, description } = body;

  if (!address?.trim() || !description?.trim())
    return NextResponse.json({ error: "address and description required" }, { status: 400 });

  if (longitude == null || latitude == null)
    return NextResponse.json({ error: "longitude and latitude required (geocode first)" }, { status: 400 });

  // Resolve home_type_id
  let homeTypeId = null;
  if (body.homeType) {
    const { data: ht } = await supabase
      .from("home_types").select("id").ilike("label", body.homeType).maybeSingle();
    homeTypeId = ht?.id ?? null;
  }
  if (!homeTypeId) {
    const { data: ht } = await supabase
      .from("home_types").select("id").eq("label", "Other").maybeSingle();
    homeTypeId = ht?.id ?? null;
  }

  const { data: listingId, error } = await supabase.rpc("rpc_create_listing_v2", {
    p_user_id: session.user.id,
    p_listing_data: {
      title: body.title?.trim() || null,
      address: address.trim(),
      longitude: Number(longitude),
      latitude: Number(latitude),
      description: description.trim(),
      lease_type: "standard",
      home_type_id: homeTypeId,
      lease_structure: body.leaseStructure ?? null,
      sublease_friendly: body.subleaseFriendly ?? false,
      twenty_one_plus: body.twentyOnePlus ?? false,
      furnished: body.furnished ?? false,
      move_in_date: body.moveInDate ?? null,
      contact_email: body.contactEmail ?? null,
      contact_phone: body.contactPhone ?? null,
      contact_name: body.contactName ?? null,
      unavailable: true, // draft starts as unavailable (hidden from browse)
      deleted_at: null,
    },
    p_amenities: {},
    p_utilities: {},
    p_walk_times: [],
    p_leases: [],
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ listingId }, { status: 201 });
}
