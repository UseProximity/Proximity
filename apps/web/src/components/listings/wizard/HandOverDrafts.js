"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Loader2, UserPlus } from "lucide-react";

/*
 * Team only: hand this import's finished drafts to the landlord they were
 * made for. The drafts move to that landlord's account, still unpublished,
 * and the landlord is emailed to check and publish them
 * (POST /api/admin/import/batches/[batchId]/assign).
 */
export default function HandOverDrafts({ batchId, count, reading = 0, onHandedOver }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState([]);

  const submit = async (e) => {
    e.preventDefault();
    const to = email.trim();
    if (!to || busy) return;
    const waiting = reading > 0 ? ` ${reading} still being read will stay on your account.` : "";
    if (!window.confirm(`Move ${count} ${count === 1 ? "draft" : "drafts"} to ${to}? They leave your account and the landlord is emailed to check and publish them.${waiting}`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/import/batches/${batchId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Couldn't hand these drafts over.");
        return;
      }
      const moved = data.moved?.length ?? 0;
      setLeft(data.left ?? []);
      if (moved) {
        toast.success(`Moved ${moved} ${moved === 1 ? "draft" : "drafts"} to ${data.landlord?.name || data.landlord?.email}.${data.emailed ? "" : " The email did not send, so let them know."}`);
        setEmail("");
        if (!(data.left ?? []).length) setOpen(false);
        onHandedOver?.(data);
      } else {
        toast.error("None of these drafts could be moved.");
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:border-red-300"
      >
        <UserPlus className="h-4 w-4" /> Hand to a landlord
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="w-full rounded-lg border border-gray-200 bg-white p-3 sm:w-96">
      <label htmlFor="hand-over-email" className="block text-xs font-medium text-gray-700">
        Landlord&apos;s account email
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="hand-over-email"
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="landlord@example.com"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Move {count}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-gray-500">
        The drafts stay unpublished. The landlord checks and publishes them from their own Drafts page.{" "}
        <button type="button" onClick={() => setOpen(false)} className="font-medium text-gray-700 hover:underline">
          Cancel
        </button>
      </p>
      {left.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-amber-700">
          {left.map((l) => (
            <li key={l.listingId}>
              {l.title}: {l.reason}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
