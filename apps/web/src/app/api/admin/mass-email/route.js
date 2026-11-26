export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createTemplate, listTemplates } from "@/lib/massEmail/templates";
import { errorResponse, massEmailContext } from "@/lib/massEmail/http";
import { getMrecForm } from "@/lib/users/mrecForm";

/*
 * Admin mass email: the saved emails (Wyatt, 2026-11-07).
 *
 * GET   { templates: [{ id, name, versions: [...] }], target, own, writable, mrecUploaded }
 *       ?archived=1 includes archived emails.
 * POST  { name } creates an email; its first version is saved separately.
 *
 * @auth admin
 */
export async function GET(req) {
  const ctx = await massEmailContext(req);
  if (ctx.response) return ctx.response;
  try {
    const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
    const [templates, mrec] = await Promise.all([listTemplates(ctx.db, { includeArchived }), getMrecForm(ctx.db).catch(() => null)]);
    return NextResponse.json({ templates, target: ctx.target, own: ctx.own, writable: ctx.writable, mrecUploaded: !!mrec });
  } catch (err) {
    return errorResponse(err, "list templates");
  }
}

export async function POST(req) {
  const ctx = await massEmailContext(req, { write: true });
  if (ctx.response) return ctx.response;
  try {
    const { name } = await req.json().catch(() => ({}));
    const template = await createTemplate(ctx.db, { name, adminId: ctx.session.user.id });
    return NextResponse.json({ template });
  } catch (err) {
    return errorResponse(err, "create template");
  }
}
