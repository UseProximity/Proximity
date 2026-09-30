/*
 * Push notification sender. The single entry point every feature should call:
 *
 *   await sendPushNotification(userId, { title, body, data })
 *
 * Looks up every device_push_tokens row for that user and sends to each via
 * Expo's push service (expo-server-sdk), which relays to APNs/FCM on our
 * behalf. Callers never touch tokens, platforms, or Expo/APNs/FCM directly.
 *
 * Uses the service-role client (@/lib/supabase), same as the registration
 * route (see api/devices/push-token/route.js) — this is a trusted server
 * context reading across all of a user's devices, not a single row a client
 * is allowed to see under RLS.
 *
 * No outreachEnabled()-style staging gate, unlike email (see outreach.js). A
 * push token can only exist in an environment's device_push_tokens table
 * because some device registered against THAT environment's API — staging
 * points at the dev DB (appEnv.js), so a token sent from staging can never
 * belong to a real production user. The DB split is already the safety
 * boundary; a second gate here would be redundant.
 *
 * v1 scope: tickets only, no receipt polling. A `DeviceNotRegistered` error
 * on the immediate ticket means Expo already knows the token is dead without
 * even contacting APNs/FCM, which is enough to prune it here. Checking
 * delivery receipts (getPushNotificationReceiptsAsync) only matters at real
 * volume and is a deliberate cut for this foundation.
 */
import { Expo } from "expo-server-sdk";
import supabase from "./supabase";

const expo = new Expo();

export async function sendPushNotification(userId, { title, body, data = {} } = {}) {
  if (!userId) return { sent: 0, errors: [] };

  const { data: rows, error } = await supabase
    .from("device_push_tokens")
    .select("id, expo_push_token")
    .eq("user_id", userId);

  if (error) {
    console.error("[push] failed to load device tokens:", error.message);
    return { sent: 0, errors: [error.message] };
  }
  if (!rows?.length) return { sent: 0, errors: [] };

  const valid = rows.filter((row) => Expo.isExpoPushToken(row.expo_push_token));
  const stale = rows.filter((row) => !Expo.isExpoPushToken(row.expo_push_token));
  if (stale.length) {
    await supabase.from("device_push_tokens").delete().in("id", stale.map((row) => row.id));
  }
  if (!valid.length) return { sent: 0, errors: [] };

  const messages = valid.map((row) => ({
    to: row.expo_push_token,
    title,
    body,
    data,
  }));
  const chunks = expo.chunkPushNotifications(messages);

  let sent = 0;
  let messageIndex = 0;
  const errors = [];
  const deadRowIds = [];

  for (const chunk of chunks) {
    const chunkRows = valid.slice(messageIndex, messageIndex + chunk.length);
    messageIndex += chunk.length;
    let tickets;
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      console.error("[push] chunk send failed:", err.message);
      errors.push(err.message);
      continue;
    }

    tickets.forEach((ticket, i) => {
      if (ticket.status === "error") {
        errors.push(ticket.message);
        if (ticket.details?.error === "DeviceNotRegistered") {
          deadRowIds.push(chunkRows[i].id);
        }
      } else {
        sent += 1;
      }
    });
  }

  if (deadRowIds.length) {
    await supabase.from("device_push_tokens").delete().in("id", deadRowIds);
  }

  return { sent, errors };
}
