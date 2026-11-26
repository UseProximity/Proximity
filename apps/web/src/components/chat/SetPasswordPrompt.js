/*
 * Shown in place of the composer when the signed-in account has no password.
 *
 * Reached by a landlord who followed a chat notification link: they can read the
 * conversation, but the first send is refused with PASSWORD_REQUIRED until they
 * have credentials of their own. The prompt sits where the composer was, because
 * the moment they want to type is the moment to ask, and sending them off to a
 * settings page would lose the reply.
 */
"use client";

import { useState } from "react";
import toast from "react-hot-toast";

export default function SetPasswordPrompt({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSave = password.length >= 8 && confirm === password && !saving;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Could not set password (${res.status})`);
      }
      toast.success("Password set. You can reply now.");
      onDone?.();
    } catch (err) {
      toast.error(err?.message || "Could not set password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-gray-100 bg-amber-50/60 px-4 py-3 space-y-2"
    >
      <p className="text-xs font-semibold text-gray-900">
        Set a password to reply
      </p>
      <p className="text-[11px] text-gray-600">
        You are signed in from an email link. Choose a password so you can get
        back in without one, and so replies are yours alone.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          aria-label="New password"
          className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          aria-label="Confirm password"
          className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <button
          type="submit"
          disabled={!canSave}
          className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {tooShort && (
        <p className="text-[11px] text-red-600">
          Use at least 8 characters.
        </p>
      )}
      {mismatch && (
        <p className="text-[11px] text-red-600">Passwords do not match.</p>
      )}
    </form>
  );
}
