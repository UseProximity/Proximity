/*
 * GET   /api/applications?listingId=   the signed-in student's applications
 *                                      on that listing (for "Did you submit?")
 * POST  /api/applications              { listingId, leaseId } Apply was clicked
 * PATCH /api/applications              { id, status: "applied" | "not_applying" }
 *                                      the student's answer
 *
 * The landlord's application itself lives on their own site; this only
 * records who went to it (lib/listings/applications.js).
 *
 * @auth user
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import { studentApplications, recordApplyClick, answerApplication } from "@/lib/listings/applications";
import { UUID_RE as UUID } from "@/lib/users/viewAs";

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

export async function GET(req) {
  try {
    const user = await getRequestUser(req);
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const listingId = new URL(req.url).searchParams.get("listingId");
    if (!UUID.test(listingId ?? "")) return NextResponse.json({ error: "listingId is required" }, { status: 400 });
    return NextResponse.json({ applications: await studentApplications({ studentId: user.id, listingId }) });
  } catch (err) {
    console.error("GET /api/applications failed:", err);
    return NextResponse.json({ error: "Could not load your applications" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const user = await getRequestUser(req);
    if (!user?.id) return NextResponse.json({ error: "Sign in to apply.", code: "SIGN_IN" }, { status: 401 });
    const b = await body(req);
    if (!UUID.test(b?.listingId ?? "") || !UUID.test(b?.leaseId ?? "")) {
      return NextResponse.json({ error: "listingId and leaseId are required" }, { status: 400 });
    }
    const result = await recordApplyClick({ studentId: user.id, listingId: b.listingId, leaseId: b.leaseId });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/applications failed:", err);
    return NextResponse.json({ error: "Could not record that" }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const user = await getRequestUser(req);
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const b = await body(req);
    if (!UUID.test(b?.id ?? "")) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const result = await answerApplication({ studentId: user.id, applicationId: b.id, status: b.status });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("PATCH /api/applications failed:", err);
    return NextResponse.json({ error: "Could not save your answer" }, { status: 500 });
  }
}
