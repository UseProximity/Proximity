/*
 * Registers/unregisters a device's Expo push token for the authenticated
 * user. Always goes through this service-role route rather than a direct
 * client write — expo_push_token is globally unique (one physical device,
 * not one user), so reassigning a shared/re-logged-in device from one user
 * to another needs the service-role client to bypass RLS (see the
 * device_push_tokens migration's own comment for why).
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getRequestUser } from "@/lib/getRequestUser";

const PLATFORMS = ["ios", "android"];

export async function POST(req) {
  const user = await getRequestUser(req);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { expoPushToken, platform } = await req.json();
  if (!expoPushToken || typeof expoPushToken !== "string") {
    return NextResponse.json({ error: "expoPushToken required" }, { status: 400 });
  }
  if (!PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: "platform must be ios or android" }, { status: 400 });
  }

  const { error } = await supabase.from("device_push_tokens").upsert(
    {
      user_id: user.id,
      expo_push_token: expoPushToken,
      platform,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "expo_push_token" }
  );

  if (error) {
    console.error("[devices/push-token] upsert failed:", error.message);
    return NextResponse.json({ error: "Failed to register device" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const user = await getRequestUser(req);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { expoPushToken } = await req.json();
  if (!expoPushToken || typeof expoPushToken !== "string") {
    return NextResponse.json({ error: "expoPushToken required" }, { status: 400 });
  }

  // Scoped by user_id too: if this device was already reassigned to a
  // different user before this (now-stale) logout request arrives, it must
  // not delete that other user's live registration for the same token.
  const { error } = await supabase
    .from("device_push_tokens")
    .delete()
    .eq("expo_push_token", expoPushToken)
    .eq("user_id", user.id);

  if (error) {
    console.error("[devices/push-token] delete failed:", error.message);
    return NextResponse.json({ error: "Failed to unregister device" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
