/*
 * Daily cron: enforce the chat retention promises.
 *
 * Two things accumulate forever without this, and one of them is a commitment
 * in the Privacy Policy rather than just housekeeping:
 *
 *   1. chat_moderation_events. Section 1.4 says a refused or flagged message is
 *      kept for two years and then deleted. For a refused message that row is
 *      the ONLY copy of what the person typed, because the message itself is
 *      never created, so nothing else would ever remove it. A policy that
 *      promises deletion with no job behind it is worse than making no promise.
 *
 *   2. chat_access_tokens. A magic-link token expires after 14 days and is
 *      single-use, but neither expiry nor use deletes the row. They are hashed,
 *      so a leaked table is not directly usable, but keeping a growing list of
 *      who was emailed about which thread serves no purpose once the token is
 *      spent. Swept 30 days past expiry, which leaves a short window for
 *      "my link did not work" support questions.
 *
 * Security: CRON_SECRET bearer token, same as the other cron routes.
 *
 * @auth cron
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Privacy Policy section 1.4.
const MODERATION_RETENTION_DAYS = 730;
// Past the 14 day TTL, with room for support questions.
const ACCESS_TOKEN_GRACE_DAYS = 30;

function cutoff(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = { moderationEventsDeleted: 0, accessTokensDeleted: 0, errors: [] };

  try {
    const { data, error } = await supabase
      .from("chat_moderation_events")
      .delete()
      .lt("created_at", cutoff(MODERATION_RETENTION_DAYS))
      .select("id");

    if (error) {
      console.error("[chat-retention] moderation sweep failed:", error.message);
      result.errors.push("moderation_events");
    } else {
      result.moderationEventsDeleted = data?.length ?? 0;
    }
  } catch (err) {
    console.error("[chat-retention] moderation sweep threw:", err);
    result.errors.push("moderation_events");
  }

  try {
    const { data, error } = await supabase
      .from("chat_access_tokens")
      .delete()
      .lt("expires_at", cutoff(ACCESS_TOKEN_GRACE_DAYS))
      .select("id");

    if (error) {
      console.error("[chat-retention] access token sweep failed:", error.message);
      result.errors.push("access_tokens");
    } else {
      result.accessTokensDeleted = data?.length ?? 0;
    }
  } catch (err) {
    console.error("[chat-retention] access token sweep threw:", err);
    result.errors.push("access_tokens");
  }

  console.log(
    `[chat-retention] moderation=${result.moderationEventsDeleted} tokens=${result.accessTokensDeleted}` +
      (result.errors.length ? ` errors=${result.errors.join(",")}` : "")
  );

  // A partial failure is still reported as 500 so the Vercel cron log shows it,
  // but whatever did get deleted stays deleted.
  return NextResponse.json(result, { status: result.errors.length ? 500 : 200 });
}
