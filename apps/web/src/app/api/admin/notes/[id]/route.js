/*
 * /api/admin/notes/[id]: change or remove one internal note.
 *
 *   PATCH  { body?, followUpOn?, followUpDone? }
 *   DELETE
 *
 * Only the note's author edits or deletes it (Wyatt, 2026-11-12). Marking a
 * follow-up done is open to any super admin, since whoever makes the call
 * should be able to tick it off. action_log keeps every earlier version.
 *
 * @auth super
 */
export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { adminDb } from "@/lib/admin/adminDb";
import { isUuid } from "@/lib/admin/records";
import { cleanNoteInput, NOTE_SELECT, shapeNotes } from "@/lib/admin/notes";

async function context(req, params) {
  const session = await requireDbRole(["super"]);
  if (!session) return { res: Response.json({ error: "Forbidden" }, { status: 403 }) };
  const { id } = await params;
  if (!isUuid(id)) return { res: Response.json({ error: "Not found" }, { status: 404 }) };
  const { db, writable } = adminDb(req);
  if (!writable) return { res: Response.json({ error: "Notes can only be changed on this site's own database." }, { status: 409 }) };
  const { data: note, error } = await db.from("admin_notes").select("id, author_id").eq("id", id).maybeSingle();
  if (error || !note) return { res: Response.json({ error: "That note is gone." }, { status: 404 }) };
  return { session, db, id, isAuthor: note.author_id === session.user.id };
}

export async function PATCH(req, { params }) {
  const c = await context(req, params);
  if (c.res) return c.res;
  const body = await req.json().catch(() => ({}));
  const patch = {};

  if (body.body !== undefined || body.followUpOn !== undefined) {
    if (!c.isAuthor) return Response.json({ error: "Only the person who wrote a note can edit it." }, { status: 403 });
    const input = cleanNoteInput(body, { partial: true });
    if (input.error) return Response.json({ error: input.error }, { status: 400 });
    if (input.body !== undefined) patch.body = input.body;
    if (input.followUpOn !== undefined) {
      patch.follow_up_on = input.followUpOn;
      // A new date reopens the follow-up.
      patch.follow_up_done_at = null;
    }
  }
  if (body.followUpDone !== undefined) patch.follow_up_done_at = body.followUpDone ? new Date().toISOString() : null;
  if (!Object.keys(patch).length) return Response.json({ error: "Nothing to change" }, { status: 400 });

  const { data, error } = await c.db.from("admin_notes").update(patch).eq("id", c.id).select(NOTE_SELECT).single();
  if (error) {
    console.error("PATCH admin/notes failed:", error);
    return Response.json({ error: "Could not save the note" }, { status: 500 });
  }
  return Response.json({ note: (await shapeNotes(c.db, [data], c.session.user.id))[0] });
}

export async function DELETE(req, { params }) {
  const c = await context(req, params);
  if (c.res) return c.res;
  if (!c.isAuthor) return Response.json({ error: "Only the person who wrote a note can delete it." }, { status: 403 });
  const { error } = await c.db.from("admin_notes").delete().eq("id", c.id);
  if (error) {
    console.error("DELETE admin/notes failed:", error);
    return Response.json({ error: "Could not delete the note" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
