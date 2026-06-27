/*
 * Ambassador payout details (how they want to be paid for referrals).
 *
 *   GET   /api/referralPayment  → { method, handle } for the signed-in user
 *   PATCH /api/referralPayment  → save { method, handle }
 *
 * method must be "zelle" or "venmo" (or null to clear). Stored on users.payment_method /
 * users.payment_handle. Writes go through updateAsUser so the change is attributed in the
 * action log, matching the rest of the app's user-initiated writes.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { updateAsUser } from "@/lib/supabaseWithUser";

export const dynamic = "force-dynamic";

const METHODS = ["zelle", "venmo"];

async function getSessionUserId() {
  const session = await auth();
  if (!session?.user?.email) return null;
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("email", session.user.email.toLowerCase())
    .is("deleted_at", null)
    .maybeSingle();
  return user?.id ?? null;
}

export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: user } = await supabase
      .from("users")
      .select("payment_method, payment_handle")
      .eq("id", userId)
      .maybeSingle();

    return NextResponse.json({
      method: user?.payment_method ?? null,
      handle: user?.payment_handle ?? null,
    });
  } catch (e) {
    console.error("GET /api/referralPayment failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const rawMethod = body.method == null ? null : String(body.method).trim().toLowerCase();
    const handle = body.handle == null ? null : String(body.handle).trim();

    if (rawMethod !== null && !METHODS.includes(rawMethod)) {
      return NextResponse.json({ error: "Choose Zelle or Venmo." }, { status: 400 });
    }
    // A method with no handle (or vice versa) is not useful — require both or neither.
    if (rawMethod && !handle) {
      return NextResponse.json({ error: "Enter your payment username." }, { status: 400 });
    }
    if (handle && !rawMethod) {
      return NextResponse.json({ error: "Choose a payment method." }, { status: 400 });
    }

    const { error } = await updateAsUser(supabase, {
      userId,
      table: "users",
      data: {
        payment_method: rawMethod,
        payment_handle: rawMethod ? handle : null,
      },
      rowId: userId,
    });
    if (error) {
      console.error("PATCH /api/referralPayment update failed:", error);
      return NextResponse.json({ error: "Could not save payment info." }, { status: 500 });
    }

    return NextResponse.json({
      method: rawMethod,
      handle: rawMethod ? handle : null,
    });
  } catch (e) {
    console.error("PATCH /api/referralPayment failed:", e?.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
