/*
 * Daily cron: delete marketing attribution data past its retention (PRD
 * section 9, edge case 28).
 *
 *   - marketing_sessions never linked to an account (user_id null) that started
 *     more than 13 months ago. Their touchpoints and outcomes go with them
 *     (on delete cascade); an outcome on such a session has no account either.
 *   - marketing_outcome_rejections older than 13 months (counters only).
 *
 * Sessions linked to an account are kept until the account is purged
 * (api/cron/purge-accounts). Deletes run in batches so a large backlog never
 * hits the function time limit; anything left over goes on the next run.
 *
 * Security: CRON_SECRET bearer token, same as the other cron routes.
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { retentionCutoff } from "@/lib/marketing/retention";

export const dynamic = "force-dynamic";

// 150 ids per delete keeps the PostgREST URL short (the same chunk size as
// lib/billing/enrollment.js); 500 uuids is an ~18 KB query string.
const BATCH = 150;
const MAX_BATCHES = 60;

async function deleteOldUnlinkedSessions(cutoff) {
  let deleted = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data, error } = await supabase
      .from("marketing_sessions")
      .select("id")
      .is("user_id", null)
      .lt("started_at", cutoff)
      .limit(BATCH);
    if (error) throw error;
    const ids = (data ?? []).map((r) => r.id);
    if (!ids.length) break;
    // Re-checked on delete: a session linked to an account since the select stays.
    const { error: delError } = await supabase.from("marketing_sessions").delete().in("id", ids).is("user_id", null);
    if (delError) throw delError;
    deleted += ids.length;
    if (ids.length < BATCH) break;
  }
  return deleted;
}

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = retentionCutoff();
  try {
    const sessionsDeleted = await deleteOldUnlinkedSessions(cutoff);
    const { error, count } = await supabase
      .from("marketing_outcome_rejections")
      .delete({ count: "exact" })
      .lt("occurred_at", cutoff);
    if (error) throw error;
    return NextResponse.json({ cutoff, sessionsDeleted, rejectionsDeleted: count ?? 0 });
  } catch (err) {
    console.error("[marketing-retention] failed:", err?.message || err);
    return NextResponse.json({ error: "Retention run failed" }, { status: 500 });
  }
}
