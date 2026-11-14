"use client";

/*
 * Internal notes on a person or a listing (Wyatt, 2026-11-12). The team's own
 * record of calls, promises and context; never shown to the landlord or
 * student. A note can carry a "follow up on" date, which stays flagged until
 * someone marks it done. Only the author edits or deletes a note.
 */
import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/admin/adminShared";
import { Card, dayTime } from "./shared";

const FIELD = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none";
const today = () => new Date().toISOString().slice(0, 10);
const dateLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function NoteForm({ initial, busy, onSave, onCancel, saveLabel }) {
  const [body, setBody] = useState(initial?.body ?? "");
  const [followUpOn, setFollowUpOn] = useState(initial?.followUpOn ?? "");
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) onSave({ body, followUpOn: followUpOn || null }, () => { setBody(""); setFollowUpOn(""); });
      }}
    >
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} placeholder="Add a note for the team. Only admins see this." className={FIELD} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          Follow up on
          <input type="date" value={followUpOn} min={initial ? undefined : today()} onChange={(e) => setFollowUpOn(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        </label>
        <span className="ml-auto flex gap-2">
          {onCancel && <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs">Cancel</button>}
          <button type="submit" disabled={busy || !body.trim()} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{saveLabel}</button>
        </span>
      </div>
    </form>
  );
}

export default function NotesPanel({ subjectType, subjectId, dbTarget }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await adminFetch(`/api/admin/notes?subjectType=${subjectType}&subjectId=${subjectId}`, dbTarget));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [subjectType, subjectId, dbTarget]);
  useEffect(() => { load(); }, [load]);

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      setError(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const add = (input, reset) => run(async () => {
    await adminFetch("/api/admin/notes", dbTarget, { method: "POST", body: JSON.stringify({ subjectType, subjectId, ...input }) });
    reset();
  });
  const save = (id, input) => run(async () => {
    await adminFetch(`/api/admin/notes/${id}`, dbTarget, { method: "PATCH", body: JSON.stringify(input) });
    setEditing(null);
  });
  const setDone = (id, done) => run(() => adminFetch(`/api/admin/notes/${id}`, dbTarget, { method: "PATCH", body: JSON.stringify({ followUpDone: done }) }));
  const remove = (id) => {
    if (!confirm("Delete this note? The activity log keeps a copy.")) return;
    run(() => adminFetch(`/api/admin/notes/${id}`, dbTarget, { method: "DELETE" }));
  };

  const notes = data?.notes ?? [];
  const waiting = notes.filter((n) => n.followUpOn && !n.followUpDone).length;

  return (
    <Card title="Notes" count={data ? notes.length : null} action={waiting > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{waiting} follow-up{waiting === 1 ? "" : "s"} open</span> : null}>
      {error && <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {data?.unavailable && <p className="mb-2 text-xs text-gray-500">Notes are not set up on this database yet.</p>}
      {data?.canWrite && <div className="mb-3"><NoteForm busy={busy} onSave={add} saveLabel="Add note" /></div>}
      {data && !data.canWrite && !data.unavailable && (
        <p className="mb-2 text-xs text-gray-500">
          {data.readOnlyReason === "other_database" ? "Read only here: notes are written on the site that owns this database." : "Read only: super admins write notes."}
        </p>
      )}
      {!data && !error && <p className="text-sm text-gray-400">Loading notes...</p>}
      {data && notes.length === 0 && !data.unavailable && <p className="text-sm text-gray-400">No notes yet.</p>}

      <ul className="space-y-2">
        {notes.map((n) => {
          const overdue = n.followUpOn && !n.followUpDone && n.followUpOn <= today();
          return (
            <li key={n.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              {editing === n.id ? (
                <NoteForm initial={n} busy={busy} onSave={(input) => save(n.id, input)} onCancel={() => setEditing(null)} saveLabel="Save" />
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-sm text-gray-900">{n.body}</p>
                  {n.followUpOn && (
                    <p className={`mt-1 text-xs ${n.followUpDone ? "text-gray-400 line-through" : overdue ? "font-semibold text-red-700" : "text-amber-700"}`}>
                      Follow up on {dateLabel(n.followUpOn)}{overdue ? " (due)" : ""}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-gray-500">
                    <span>{n.author} · {dayTime(n.createdAt)}{n.edited ? " · edited" : ""}</span>
                    {data?.canWrite && (
                      <span className="ml-auto flex gap-3">
                        {n.followUpOn && <button type="button" disabled={busy} onClick={() => setDone(n.id, !n.followUpDone)} className="underline">{n.followUpDone ? "Reopen follow-up" : "Mark follow-up done"}</button>}
                        {n.mine && <button type="button" disabled={busy} onClick={() => setEditing(n.id)} className="underline">Edit</button>}
                        {n.mine && <button type="button" disabled={busy} onClick={() => remove(n.id)} className="text-red-600 underline">Delete</button>}
                      </span>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
