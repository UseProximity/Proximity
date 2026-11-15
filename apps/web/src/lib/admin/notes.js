/*
 * Shared by the admin notes routes (app/api/admin/notes): checking what was
 * typed and shaping rows for the page.
 */
export const NOTE_SELECT = "id, subject_type, subject_id, body, follow_up_on, follow_up_done_at, author_id, created_at, edited_at";

/*
 * Today (or `offsetDays` from today) as YYYY-MM-DD in St. Louis time. Follow-up
 * dates are calendar days for the team, so "due" must not flip at UTC midnight
 * (6pm or 7pm here). Used by the notes panel and by Home, so both agree.
 */
export function teamDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

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
    // Set only when the text changes, so ticking a follow-up off is not an edit.
    edited: !!n.edited_at,
  }));
}
