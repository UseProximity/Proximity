"use client";

/*
 * Small helpers shared by the admin Mass email screens.
 */
import { adminFetch } from "@/components/admin/adminShared";

export const FIELD = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500";
export const PRIMARY = "rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50";
export const SECONDARY = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";

export const api = (path, dbTarget, method = "GET", body) =>
  adminFetch(path, dbTarget, method === "GET" ? {} : { method, body: JSON.stringify(body ?? {}) });

// A file upload: adminFetch always sends JSON, so this one builds its own request.
export async function uploadPdf(file, dbTarget) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/admin/mass-email/attachments", { method: "POST", headers: { "x-db-target": dbTarget }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.attachment;
}

export function fmtWhen(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function Notice({ kind = "info", children }) {
  const colors = {
    info: "border-gray-200 bg-gray-50 text-gray-700",
    ok: "border-green-200 bg-green-50 text-green-800",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-red-200 bg-red-50 text-red-700",
  };
  return <div className={`rounded-lg border px-3 py-2 text-sm ${colors[kind]}`}>{children}</div>;
}
