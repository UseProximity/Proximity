import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { notifyNewChatMessage } from "@/lib/chat/notifyEmail";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAFE_RESPOND_ERRORS = new Set([
  "action must be accept, deny, or counter",
  "proposed rent is required to counter",
  "proposed rent must be a positive number",
  "offer note exceeds the 1000 character limit",
  "offer not found",
  "message is not a discount offer",
  "offer is no longer pending",
  "cannot respond to your own offer",
  "not allowed to respond to this offer",
  "parent offer not found",
  "parent offer is no longer pending",
  "cannot counter your own offer",
  "not allowed to counter this offer",
  "only the listing landlord can send an offer",
  "offers require a listing conversation",
]);

const NOT_PARTICIPANT_ERROR = "not a participant in this conversation";
const THREAD_NOT_FOUND_ERROR = "conversation not found";

function mapRespondError(error) {
  if (error.message === NOT_PARTICIPANT_ERROR) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (error.message === THREAD_NOT_FOUND_ERROR) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (error.message === "offer not found") {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }
  if (SAFE_RESPOND_ERRORS.has(error.message)) {
    const forbidden =
      error.message.startsWith("cannot ") ||
      error.message.startsWith("not allowed") ||
      error.message.startsWith("only the");
    return NextResponse.json(
      { error: error.message },
      { status: forbidden ? 403 : 400 }
    );
  }
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

// POST /api/chat/offers/[messageId]/respond — accept, deny, or counter an offer
export async function POST(req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { messageId } = await params;
    if (!UUID_RE.test(messageId ?? "")) {
      return NextResponse.json(
        { error: "messageId must be a valid UUID" },
        { status: 400 }
      );
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const action = String(payload?.action ?? "")
      .trim()
      .toLowerCase();
    if (!["accept", "deny", "counter"].includes(action)) {
      return NextResponse.json(
        { error: "action must be accept, deny, or counter" },
        { status: 400 }
      );
    }

    let proposedRent = null;
    if (action === "counter") {
      const rent = Number(payload?.proposedRent);
      if (!Number.isFinite(rent) || rent <= 0) {
        return NextResponse.json(
          { error: "proposedRent must be a positive number" },
          { status: 400 }
        );
      }
      proposedRent = rent;
    }

    const note = payload?.note;
    if (note != null && typeof note !== "string") {
      return NextResponse.json({ error: "note must be a string" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("rpc_respond_discount_offer", {
      p_user_id: session.user.id,
      p_message_id: messageId,
      p_action: action,
      p_proposed_rent: proposedRent,
      p_note: typeof note === "string" ? note : null,
    });

    if (error) {
      console.error("POST /api/chat/offers/[messageId]/respond failed:", error);
      return mapRespondError(error);
    }

    // Counter inserts a new message — notify. Accept/deny only update metadata.
    if (action === "counter" && data?.threadId) {
      const baseUrl = getBaseUrl(req);
      after(() =>
        notifyNewChatMessage({
          threadId: data.threadId,
          senderId: session.user.id,
          baseUrl,
        })
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("POST /api/chat/offers/[messageId]/respond failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
