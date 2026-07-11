"use client";

import { useState } from "react";
import { fmtDate, prodConfirm, insertRow, deleteRow, Stars, GearButton, TrashButton } from "@/components/admin/adminShared";

export default function TestimonialsView({ data, search, dbTarget, isProd, isReadOnly, onOpenGear, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ text: "", author: "", rating: 5 });
  const [saving, setSaving] = useState(false);

  const testimonials = data || [];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? testimonials.filter((t) => [t.text, t.author].some((v) => (v || "").toLowerCase().includes(q)))
    : testimonials;

  async function handleAdd(e) {
    e.preventDefault();
    if (!draft.text.trim() || !draft.author.trim()) { alert("Text and author are required"); return; }
    if (!prodConfirm(isProd, "Create a new testimonial.")) return;
    setSaving(true);
    try {
      await insertRow("testimonials", { ...draft, rating: Number(draft.rating) }, dbTarget);
      setAdding(false);
      setDraft({ text: "", author: "", rating: 5 });
      onRefresh();
    } catch (err) {
      alert(`Add failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this testimonial? This cannot be undone.")) return;
    if (!prodConfirm(isProd, "Permanently delete this testimonial.")) return;
    try {
      await deleteRow("testimonials", id, dbTarget);
      onRefresh();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{filtered.length} of {testimonials.length} testimonials (shown on the marketing site)</p>
        {!isReadOnly && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded">
            + New testimonial
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="p-4 rounded-xl border border-blue-200 bg-blue-50/50 space-y-2">
          <textarea
            value={draft.text}
            onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            placeholder="Testimonial text…"
            rows={2}
            className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          />
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft.author}
              onChange={(e) => setDraft((d) => ({ ...d, author: e.target.value }))}
              placeholder="Author"
              className="w-48 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
            />
            <input
              type="number"
              min="1"
              max="5"
              value={draft.rating}
              onChange={(e) => setDraft((d) => ({ ...d, rating: e.target.value }))}
              className="w-16 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
            />
            <button type="submit" disabled={saving} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40">
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-white">Cancel</button>
          </div>
        </form>
      )}

      {filtered.map((t) => (
        <div key={t.id} className="flex items-start gap-3 px-4 py-2.5 rounded-xl border border-gray-200 bg-white shadow-sm">
          <Stars rating={t.rating} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-800">{t.text}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">— {t.author} · {fmtDate(t.created_at)}</p>
          </div>
          {!isReadOnly && <TrashButton title="Delete testimonial" onClick={() => handleDelete(t.id)} />}
          <GearButton onClick={() => onOpenGear("testimonials", t)} />
        </div>
      ))}

      {filtered.length === 0 && <p className="py-10 text-center text-sm text-gray-400">No testimonials match.</p>}
    </div>
  );
}
