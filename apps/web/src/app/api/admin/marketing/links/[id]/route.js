/*
 * One campaign link (PRD 7.9 edit rules).
 *
 * @auth admin
 *
 * PATCH  edit name, labels (source, medium, campaign, content), destination
 *        or status (active / archived). The slug can never change: it is on
 *        printed paper and in QR codes. Past sessions keep the labels they
 *        were recorded with.
 * DELETE only a link with zero sessions. A used link is archived instead,
 *        and keeps attributing (its codes are still out in the world).
 */
import { NextResponse } from "next/server";
import { requireDbRole } from "@/lib/userRole";
import { isUuid } from "@/lib/marketing/config";
import { validateLinkInput } from "@/lib/marketing/links";
import { deleteLink, getLink, sessionCountForLink, updateLink } from "@/lib/marketing/linksServer";

export const dynamic = "force-dynamic";

const EDITABLE = ["name", "source", "medium", "campaign", "content", "destination_path"];
const FK_VIOLATION = "23503";

export async function PATCH(req, { params }) {
  if (!(await requireDbRole(["admin", "super"]))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (body?.slug !== undefined) return NextResponse.json({ error: "A link's slug cannot be changed once saved. Make a new link instead." }, { status: 400 });

  const input = Object.fromEntries(EDITABLE.filter((k) => body?.[k] !== undefined).map((k) => [k, body[k]]));
  const { value, errors } = validateLinkInput(input, { partial: true });
  if (Object.keys(errors).length) return NextResponse.json({ error: "Check the highlighted fields.", fields: errors }, { status: 400 });
  if (body?.status !== undefined) {
    if (!["active", "archived"].includes(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    value.status = body.status;
  }
  if (!Object.keys(value).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  try {
    if (!(await getLink(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await updateLink(id, value);
    if (error) throw error;
    return NextResponse.json({ link: data });
  } catch (err) {
    console.error("PATCH /api/admin/marketing/links/[id] failed:", err?.message || err);
    return NextResponse.json({ error: "Could not save the link." }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  if (!(await requireDbRole(["admin", "super"]))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const used = { error: "This link has been used, so it can only be archived. Archived links keep attributing." };
  try {
    if (!(await getLink(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((await sessionCountForLink(id)) > 0) return NextResponse.json(used, { status: 409 });
    const { error } = await deleteLink(id);
    if (error) {
      // A visit landed between the count and the delete: the foreign key refuses it.
      if (error.code === FK_VIOLATION) return NextResponse.json(used, { status: 409 });
      throw error;
    }
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /api/admin/marketing/links/[id] failed:", err?.message || err);
    return NextResponse.json({ error: "Could not delete the link." }, { status: 500 });
  }
}
