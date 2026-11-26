export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { saveVersion } from "@/lib/massEmail/templates";
import { errorResponse, massEmailContext } from "@/lib/massEmail/http";

/*
 * Saves a new version of a mass email (Wyatt, 2026-11-07). Versions are never
 * edited, so what each person received stays on record.
 *
 * POST  { subject, body, buttonTarget, buttonLabel, buttonUrl, attachments,
 *         footerReason } -> { version }
 *
 * @auth admin
 */
export async function POST(req, { params }) {
  const ctx = await massEmailContext(req, { write: true });
  if (ctx.response) return ctx.response;
  try {
    const { templateId } = await params;
    const input = await req.json().catch(() => ({}));
    const version = await saveVersion(ctx.db, templateId, input, { adminId: ctx.session.user.id });
    return NextResponse.json({ version });
  } catch (err) {
    return errorResponse(err, "save version");
  }
}
