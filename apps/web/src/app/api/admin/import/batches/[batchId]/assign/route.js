export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireDbRole } from "@/lib/userRole";
import { getBaseUrl, sendDraftsHandedOverEmail } from "@/lib/email";
import { handOverBatch, landlordByEmail } from "@/lib/sourceImport/handOver";

/*
 * POST /api/admin/import/batches/[batchId]/assign   body: { email }
 *
 * Hand the finished drafts of an import the caller ran to a landlord: the
 * drafts move to that landlord's account, unpublished, and the landlord gets
 * one email asking them to check and publish. Only the caller's own batch,
 * only drafts it created (lib/sourceImport/handOver.js has the rules).
 *
 * Returns { landlord: { name, email }, moved: [...], left: [...], emailed }.
 *
 * @auth super
 */
export async function POST(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { batchId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(batchId ?? "")) return NextResponse.json({ error: "No such import." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return NextResponse.json({ error: "Enter the landlord's email." }, { status: 400 });

  const landlord = await landlordByEmail(email);
  if (!landlord) return NextResponse.json({ error: "No landlord account uses that email." }, { status: 404 });
  if (landlord.id === session.user.id) return NextResponse.json({ error: "These drafts are already on your account." }, { status: 400 });

  try {
    const result = await handOverBatch({ batchId, fromId: session.user.id, to: landlord, actorId: session.user.id });
    if (!result) return NextResponse.json({ error: "No such import." }, { status: 404 });
    let emailed = false;
    if (result.moved.length) {
      try {
        await sendDraftsHandedOverEmail({ to: landlord.email, name: landlord.name, drafts: result.moved, baseUrl: getBaseUrl(), req });
        emailed = true;
      } catch (err) {
        console.error("[import/assign] email:", err?.message);
      }
    }
    return NextResponse.json({ landlord: { name: landlord.name, email: landlord.email }, ...result, emailed });
  } catch (err) {
    console.error("[import/assign]", err?.message);
    return NextResponse.json({ error: "We couldn't hand these drafts over. Please try again." }, { status: 500 });
  }
}
