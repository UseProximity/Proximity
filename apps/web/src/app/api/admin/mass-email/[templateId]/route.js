export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { updateTemplate } from "@/lib/massEmail/templates";
import { templateHistory } from "@/lib/massEmail/history";
import { errorResponse, massEmailContext } from "@/lib/massEmail/http";

/*
 * One saved mass email (Wyatt, 2026-11-07).
 *
 * GET    { batches }: every send of it, newest first, each recipient with how
 *        their email went (delivery reports from Amazon SES).
 * PATCH  { name?, archived? } renames or archives it. Archiving keeps its history.
 *
 * @auth admin
 */
export async function GET(req, { params }) {
  const ctx = await massEmailContext(req);
  if (ctx.response) return ctx.response;
  try {
    const { templateId } = await params;
    return NextResponse.json({ batches: await templateHistory(ctx.db, templateId) });
  } catch (err) {
    return errorResponse(err, "read history");
  }
}

export async function PATCH(req, { params }) {
  const ctx = await massEmailContext(req, { write: true });
  if (ctx.response) return ctx.response;
  try {
    const { templateId } = await params;
    const body = await req.json().catch(() => ({}));
    const template = await updateTemplate(ctx.db, templateId, { name: body.name, archived: body.archived });
    return NextResponse.json({ template });
  } catch (err) {
    return errorResponse(err, "update template");
  }
}
