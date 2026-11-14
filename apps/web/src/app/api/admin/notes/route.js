/*
 * /api/admin/notes: internal notes on a person or a listing (admin_notes,
 * Wyatt 2026-11-12). Never shown to landlords or students.
 *
 *   GET  ?subjectType=user|listing&subjectId=   the notes, newest first
 *   POST { subjectType, subjectId, body, followUpOn? }   super only
 *
 * Reads follow the dashboard's dev/prod switch. Writing only works on this
 * site's own database, because the author is the signed-in team member.
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";

import { requireDbRole, hasDbRole } from "@/lib/userRole";
import { adminDb, missingTable } from "@/lib/admin/adminDb";
import { isUuid } from "@/lib/admin/records";
import { cleanNoteInput, NOTE_SELECT, shapeNotes } from "@/lib/admin/notes";

const SUBJECTS = new Set(["user", "listing"]);

export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const p = new URL(req.url).searchParams;
  const subjectType = p.get("subjectType");
  const subjectId = p.get("subjectId");
  if (!SUBJECTS.has(subjectType) || !isUuid(subjectId)) return Response.json({ error: "subjectType and subjectId required" }, { status: 400 });
  const { db, writable } = adminDb(req);

  const { data, error } = await db.from("admin_notes").select(NOTE_SELECT).eq("subject_type", subjectType).eq("subject_id", subjectId).order("created_at", { ascending: false }).limit(200);
  // The table reaches production with its migration; until then there are simply no notes.
  if (missingTable(error)) return Response.json({ notes: [], canWrite: false, unavailable: true });
  if (error) {
    console.error("GET admin/notes failed:", error);
    return Response.json({ error: "Could not load notes" }, { status: 500 });
  }
  const canWrite = writable && (await hasDbRole(session.user.id, ["super"]));
  return Response.json({ notes: await shapeNotes(db, data ?? [], session.user.id), canWrite, readOnlyReason: writable ? null : "other_database" });
}

export async function POST(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { db, writable } = adminDb(req);
  if (!writable) return Response.json({ error: "Notes can only be written on this site's own database. Switch back, or open the other site." }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  if (!SUBJECTS.has(body?.subjectType) || !isUuid(body?.subjectId)) return Response.json({ error: "subjectType and subjectId required" }, { status: 400 });
  const input = cleanNoteInput(body);
  if (input.error) return Response.json({ error: input.error }, { status: 400 });

  const { data, error } = await db.from("admin_notes")
    .insert({ subject_type: body.subjectType, subject_id: body.subjectId, body: input.body, follow_up_on: input.followUpOn, author_id: session.user.id })
    .select(NOTE_SELECT).single();
  if (error) {
    console.error("POST admin/notes failed:", error);
    return Response.json({ error: "Could not save the note" }, { status: 500 });
  }
  return Response.json({ note: (await shapeNotes(db, [data], session.user.id))[0] });
}
