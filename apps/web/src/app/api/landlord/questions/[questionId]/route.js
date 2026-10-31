/*
 * POST /api/landlord/questions/[questionId]  { body, done? }
 *
 * The landlord replies to Proxy in one box. Left to itself, Proxy works out
 * whether the reply is the answer (saved to the listing's knowledge and
 * relayed to every waiting student) or a question back to the student
 * (relayed as the landlord's question); `done` forces either. Contact
 * details are removed before anything reaches a student.
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { answerQuestion } from "@/lib/agents/questions";
import { resolveDashboardUserId } from "@/lib/users/viewAs";

export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { questionId } = await params;
    let body;
    try { body = await req.json(); } catch { body = {}; }
    // A super "viewing as" a landlord answers as that landlord.
    const landlordUserId = resolveDashboardUserId(session, new URL(req.url).searchParams);
    const result = await answerQuestion({
      questionId, landlordUserId, body: String(body?.body ?? ""), done: typeof body?.done === "boolean" ? body.done : null, via: "app",
    });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json({
      ok: true, status: result.question.status, kind: result.kind, relayedTo: result.relayedTo, screened: result.screened,
      saved: result.synthesis ? { written: result.synthesis.written, retired: result.synthesis.retired, notes: result.synthesis.notes } : null,
    });
  } catch (err) {
    console.error("POST /api/landlord/questions/[id] failed:", err);
    return NextResponse.json({ error: "Could not send the answer" }, { status: 500 });
  }
}
