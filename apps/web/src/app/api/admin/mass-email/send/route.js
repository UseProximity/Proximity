export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { loadVersion, MassEmailError, sendBatch, sendTest } from "@/lib/massEmail/send";
import { errorResponse, massEmailContext } from "@/lib/massEmail/http";

const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

/*
 * Sends a saved version of a mass email (lib/massEmail/send.js), from
 * info@useproximity.org with replies to info@useproximity.org.
 *
 * POST { mode: "test", versionId, to?, previewUserId? }
 *        one copy to `to` (the admin's own address by default), filled in as
 *        `previewUserId` would see it. Not recorded as a recipient.
 * POST { mode: "send", versionId, userIds, confirm: true, turnProxyOn?, allowRepeat?, batchId? }
 *        emails the people picked, at most 60 per call. The answer's `remaining`
 *        and `batchId` are passed back to continue the same batch.
 *
 * Only on this site's own database. Off production every email goes to the
 * tester's inbox or nowhere (lib/outreach.js), never to the real person.
 *
 * @auth admin
 */
export async function POST(req) {
  const ctx = await massEmailContext(req, { write: true });
  if (ctx.response) return ctx.response;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.mode !== "test" && body.mode !== "send") throw new MassEmailError("bad_mode", "Choose test or send.");
    const version = await loadVersion(ctx.db, body.versionId);

    if (body.mode === "test") {
      const to = typeof body.to === "string" && body.to.trim() ? body.to.trim() : ctx.session.user.email;
      if (!EMAIL_RE.test(to ?? "")) throw new MassEmailError("bad_address", "Enter one email address for the test.");
      const out = await sendTest(ctx.db, { version, to, previewUserId: body.previewUserId || null, req });
      return NextResponse.json({ ok: true, mode: "test", to, suppressed: out.suppressed, redirected: out.redirected });
    }

    if (body.confirm !== true) throw new MassEmailError("confirm_required", "Confirm that you want to send this email.");
    const result = await sendBatch(ctx.db, {
      version,
      userIds: body.userIds,
      adminId: ctx.session.user.id,
      turnProxyOn: body.turnProxyOn === true,
      allowRepeat: body.allowRepeat === true,
      batchId: typeof body.batchId === "string" ? body.batchId : null,
      req,
    });
    return NextResponse.json({ ok: true, mode: "send", ...result });
  } catch (err) {
    return errorResponse(err, "send");
  }
}
