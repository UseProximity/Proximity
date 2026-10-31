/*
 * GET /api/landlord/questions: the signed-in landlord's queue of questions
 * Proxy sent them (open first, then recently answered), with the clarifier
 * exchange on each. Never the student's name.
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveDashboardUserId } from "@/lib/users/viewAs";
import { listLandlordQuestions } from "@/lib/agents/questions";

export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const userId = resolveDashboardUserId(session, searchParams);
    const questions = await listLandlordQuestions(userId);
    return NextResponse.json({ questions, openCount: questions.filter((q) => q.status === "open").length });
  } catch (err) {
    console.error("GET /api/landlord/questions failed:", err);
    return NextResponse.json({ error: "Could not load questions" }, { status: 500 });
  }
}
