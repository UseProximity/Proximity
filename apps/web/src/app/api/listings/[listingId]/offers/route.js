import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { notifyNewChatMessage } from "@/lib/chat/notifyEmail";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAFE_ERRORS = new Set([
  "proposed rent must be a positive number",
  "offer note exceeds the 1000 character limit",
  "only the listing landlord can broadcast offers",
  "only the listing landlord can list savers",
  "listing not found",
  "listing has no landlord to contact",
]);

function mapError(error) {
  if (SAFE_ERRORS.has(error.message)) {
    const forbidden = error.message.startsWith("only the");
    const notFound = error.message === "listing not found";
    return NextResponse.json(
      { error: error.message },
      { status: notFound ? 404 : forbidden ? 403 : 400 }
    );
  }
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

// GET /api/listings/[listingId]/offers — saver count/list for broadcast UI
export async function GET(_req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { listingId } = await params;
    if (!UUID_RE.test(listingId ?? "")) {
      return NextResponse.json(
        { error: "listingId must be a valid UUID" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("rpc_list_listing_savers", {
      p_user_id: session.user.id,
      p_listing_id: listingId,
    });

    if (error) {
      console.error("GET /api/listings/[listingId]/offers failed:", error);
      return mapError(error);
    }

    return NextResponse.json(data ?? { count: 0, savers: [] });
  } catch (error) {
    console.error("GET /api/listings/[listingId]/offers failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/listings/[listingId]/offers — broadcast discount offers to savers
export async function POST(req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { listingId } = await params;
    if (!UUID_RE.test(listingId ?? "")) {
      return NextResponse.json(
        { error: "listingId must be a valid UUID" },
        { status: 400 }
      );
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const rent = Number(payload?.proposedRent);
    if (!Number.isFinite(rent) || rent <= 0) {
      return NextResponse.json(
        { error: "proposedRent must be a positive number" },
        { status: 400 }
      );
    }

    const note = payload?.note;
    if (note != null && typeof note !== "string") {
      return NextResponse.json({ error: "note must be a string" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("rpc_broadcast_discount_offers", {
      p_user_id: session.user.id,
      p_listing_id: listingId,
      p_proposed_rent: rent,
      p_note: typeof note === "string" ? note : null,
    });

    if (error) {
      console.error("POST /api/listings/[listingId]/offers failed:", error);
      return mapError(error);
    }

    const baseUrl = getBaseUrl(req);
    const results = Array.isArray(data?.results) ? data.results : [];
    // Notify each thread once (after response). Cap concurrent SMTP work lightly
    // by scheduling all after() callbacks — Next will run them post-response.
    after(async () => {
      for (const row of results) {
        if (!row?.threadId) continue;
        try {
          await notifyNewChatMessage({
            threadId: row.threadId,
            senderId: session.user.id,
            baseUrl,
          });
        } catch (err) {
          console.error("broadcast offer notify failed:", err);
        }
      }
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("POST /api/listings/[listingId]/offers failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
