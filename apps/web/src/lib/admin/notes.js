/*
 * Shared by the admin notes routes (app/api/admin/notes): checking what was
 * typed and shaping rows for the page.
 */
export const NOTE_SELECT = "id, subject_type, subject_id, body, follow_up_on, follow_up_done_at, author_id, created_at, updated_at";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/* { body, followUpOn } ready to save, or { error }. `partial` skips what was not sent. */
export function cleanNoteInput(input, { partial = false } = {}) {
  const out = {};
  if (input?.body !== undefined || !partial) {
    const body = String(input?.body ?? "").trim();
    if (!body) return { error: "Write something first." };
    if (body.length > 4000) return { error: "Keep a note under 4,000 characters." };
    out.body = body;
  }
  if (input?.followUpOn !== undefined || !partial) {
    const raw = input?.followUpOn;
    if (raw == null || raw === "") out.followUpOn = null;
    else if (!DATE.test(String(raw)) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return { error: "That follow-up date is not a date." };
    else out.followUpOn = String(raw);
  }
  return out;
}

/* Rows as the page shows them, with the author's name and whether the viewer wrote each one. */
export async function shapeNotes(db, rows, viewerId) {
  const ids = [...new Set(rows.map((n) => n.author_id).filter(Boolean))];
  const { data: authors } = ids.length ? await db.from("users").select("id, name, email").in("id", ids) : { data: [] };
  const byId = new Map((authors ?? []).map((u) => [u.id, u.name || u.email || "A team member"]));
  return rows.map((n) => ({
    id: n.id,
    body: n.body,
    followUpOn: n.follow_up_on,
    followUpDone: !!n.follow_up_done_at,
    author: n.author_id ? byId.get(n.author_id) ?? "A team member" : "Someone who has left",
    mine: !!viewerId && n.author_id === viewerId,
    createdAt: n.created_at,
    edited: !!n.updated_at && !!n.created_at && Date.parse(n.updated_at) - Date.parse(n.created_at) > 2000,
  }));
}
