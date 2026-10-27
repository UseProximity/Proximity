/*
 * Hourly: reminders for questions landlords have not answered (PRD v3).
 *
 *   day 1   remind the landlord
 *   day 3   remind again
 *   day 5   Proxy tells every waiting student there is no answer yet, and
 *           that they can book a tour or look at similar places
 *
 * Does nothing while the agents' global switch is off.
 *
 * @auth cron
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { cronAuthorized } from "@/app/api/landlord/import/_auth";
import { agentsEnabled } from "@/lib/agents/flags";
import { remindLandlord, tellStudentsNoAnswer } from "@/lib/agents/notify";

const DAY = 24 * 60 * 60 * 1000;
const before = (days) => new Date(Date.now() - days * DAY).toISOString();

export async function GET(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!agentsEnabled()) return NextResponse.json({ skipped: "agents off" });
  const out = { day1: 0, day3: 0, day5: 0, errors: 0 };
  const now = new Date().toISOString();

  const { data: open } = await supabase.from("listing_questions")
    .select("id, owner_id, created_at, reminder_1_at, reminder_3_at, student_told_at")
    .eq("status", "open").lt("created_at", before(1)).limit(500);
  for (const q of open ?? []) {
    try {
      if (q.owner_id && !q.reminder_1_at) {
        await remindLandlord({ questionId: q.id, day: 1 });
        await supabase.from("listing_questions").update({ reminder_1_at: now }).eq("id", q.id);
        out.day1++;
      } else if (q.owner_id && !q.reminder_3_at && q.created_at < before(3)) {
        await remindLandlord({ questionId: q.id, day: 3 });
        await supabase.from("listing_questions").update({ reminder_3_at: now }).eq("id", q.id);
        out.day3++;
      }
      if (!q.student_told_at && q.created_at < before(5)) {
        await tellStudentsNoAnswer({ questionId: q.id });
        await supabase.from("listing_questions").update({ student_told_at: now }).eq("id", q.id);
        out.day5++;
      }
    } catch (err) {
      out.errors++;
      console.error("[agent-questions] failed on", q.id, err?.message ?? err);
    }
  }
  return NextResponse.json(out);
}
