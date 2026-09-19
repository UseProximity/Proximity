import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { notifyNewChatMessage } from "@/lib/chat/notifyEmail";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAFE_OFFER_ERRORS = new Set([
  "proposed rent must be a positive number",
  "offer note exceeds the 1000 character limit",
  "not allowed to send an offer in this conversation",
  "offers require a listing conversation",
  "parent offer not found",
  "parent offer is no longer pending",
  "cannot counter your own offer",
  "not allowed to counter this offer",
]);

const NOT_PARTICIPANT_ERROR = "not a participant in this conversation";
const THREAD_NOT_FOUND_ERROR = "conversation not found";

function mapOfferError(error) {
  if (error.message === NOT_PARTICIPANT_ERROR) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (error.message === THREAD_NOT_FOUND_ERROR) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (SAFE_OFFER_ERRORS.has(error.message)) {
    const status =
      error.message.startsWith("only the") ||
      error.message.startsWith("not allowed") ||
      error.message.startsWith("cannot counter")
        ? 403
        : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

// POST /api/chat/threads/[threadId]/offers — send a discount_offer in a thread
export async function POST(req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { threadId } = await params;
    if (!UUID_RE.test(threadId ?? "")) {
      return NextResponse.json(
        { error: "threadId must be a valid UUID" },
        { status: 400 }
      );
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { proposedRent, note, parentOfferId } = payload ?? {};
    const rent = Number(proposedRent);
    if (!Number.isFinite(rent) || rent <= 0) {
      return NextResponse.json(
        { error: "proposedRent must be a positive number" },
        { status: 400 }
      );
    }

    if (parentOfferId != null && !UUID_RE.test(parentOfferId)) {
      return NextResponse.json(
        { error: "parentOfferId must be a valid UUID" },
        { status: 400 }
      );
    }

    if (note != null && typeof note !== "string") {
      return NextResponse.json({ error: "note must be a string" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("rpc_send_discount_offer", {
      p_user_id: session.user.id,
      p_thread_id: threadId,
      p_proposed_rent: rent,
      p_note: typeof note === "string" ? note : null,
      p_parent_offer_id: parentOfferId ?? null,
    });

    if (error) {
      console.error("POST /api/chat/threads/[threadId]/offers failed:", error);
      return mapOfferError(error);
    }

    const baseUrl = getBaseUrl(req);
    after(() =>
      notifyNewChatMessage({
        threadId,
        senderId: session.user.id,
        baseUrl,
      })
    );

    return NextResponse.json(data);
  } catch (error) {
    console.error("POST /api/chat/threads/[threadId]/offers failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
