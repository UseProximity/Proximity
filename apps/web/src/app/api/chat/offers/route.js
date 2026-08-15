import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { notifyNewChatMessage } from "@/lib/chat/notifyEmail";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAFE_START_OFFER_ERRORS = new Set([
  "proposed rent must be a positive number",
  "offer note exceeds the 1000 character limit",
  "listing not found",
  "listing is not active",
  "listing has no landlord to contact",
  "listing landlord is no longer an active user",
  "cannot send an offer on your own listing",
]);

function mapStartOfferError(error) {
  if (SAFE_START_OFFER_ERRORS.has(error.message)) {
    const notFound = error.message === "listing not found";
    const forbidden = error.message === "cannot send an offer on your own listing";
    return NextResponse.json(
      { error: error.message },
      { status: notFound ? 404 : forbidden ? 403 : 400 }
    );
  }
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

// POST /api/chat/offers — propose a rent on a listing, starting the thread if needed
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { listingId, proposedRent, note } = payload ?? {};
    if (typeof listingId !== "string" || !UUID_RE.test(listingId.trim())) {
      return NextResponse.json(
        { error: "listingId must be a valid UUID" },
        { status: 400 }
      );
    }

    const rent = Number(proposedRent);
    if (!Number.isFinite(rent) || rent <= 0) {
      return NextResponse.json(
        { error: "proposedRent must be a positive number" },
        { status: 400 }
      );
    }

    if (note != null && typeof note !== "string") {
      return NextResponse.json({ error: "note must be a string" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("rpc_start_listing_offer", {
      p_user_id: session.user.id,
      p_listing_id: listingId.trim(),
      p_proposed_rent: rent,
      p_note: typeof note === "string" ? note : null,
    });

    if (error) {
      console.error("POST /api/chat/offers failed:", error);
      return mapStartOfferError(error);
    }

    // Read the request headers here: after() runs once the response is on its way.
    const baseUrl = getBaseUrl(req);
    after(() =>
      notifyNewChatMessage({
        threadId: data?.threadId,
        senderId: session.user.id,
        baseUrl,
      })
    );

    return NextResponse.json(data);
  } catch (error) {
    console.error("POST /api/chat/offers failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
