"use client";

/*
 * One campaign link: what the admin gets back (short link, full link, QR code,
 * copy buttons) plus edit, archive and delete. A link with sessions can only
 * be archived; archived links keep attributing visits.
 */
import { useState } from "react";
import toast from "react-hot-toast";
import { Badge, fmtDate } from "@/components/admin/adminShared";
import { fullLink, shortLink } from "@/lib/marketing/links";
import CampaignLinkForm from "./CampaignLinkForm";
import LinkQrCode from "./LinkQrCode";

function CopyRow({ label, value }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  };
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-gray-700">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-800" title={value}>{value}</code>
        <button type="button" onClick={copy} className="shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          Copy
        </button>
      </div>
    </div>
  );
}

export default function CampaignLinkDetail({ link, origin, campaigns, onChanged, onClose }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const short = shortLink(link.slug, origin);
  const full = fullLink(link.destination_path, link.slug, origin);
  const used = Boolean(link.used);

  async function call(method, body) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/marketing/links/${link.id}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Something went wrong.");
        return null;
      }
      return data;
    } finally {
      setBusy(false);
    }
  }

  const setStatus = async (status) => {
    const data = await call("PATCH", { status });
    if (data) {
      toast.success(status === "archived" ? "Link archived. It still attributes visits." : "Link restored.");
      onChanged(data.link);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete the link "${link.name}"? This cannot be undone.`)) return;
    const data = await call("DELETE");
    if (data) {
      toast.success("Link deleted.");
      onChanged(null);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">{link.name}</h3>
            {link.status === "archived" && <Badge color="amber">Archived</Badge>}
          </div>
          <p className="text-xs text-gray-500">
            {link.slug} · {link.source} / {link.medium} / {link.campaign}{link.content ? ` / ${link.content}` : ""} · created {fmtDate(link.created_at)}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800">Close</button>
      </div>

      {editing ? (
        <CampaignLinkForm link={link} campaigns={campaigns} onCancel={() => setEditing(false)} onSaved={(l) => { setEditing(false); toast.success("Link saved."); onChanged(l); }} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <CopyRow label="Short link (QR codes and anywhere length matters)" value={short} />
            <CopyRow label="Full link (places that show the URL)" value={full} />
            <p className="text-xs text-gray-500">
              Goes to <code className="text-gray-700">{link.destination_path}</code>. Changing the destination repoints the short link and printed QR codes; full links already shared keep their old page.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={() => setEditing(true)} disabled={busy} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Edit</button>
              {link.status === "active" ? (
                <button type="button" onClick={() => setStatus("archived")} disabled={busy} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Archive</button>
              ) : (
                <button type="button" onClick={() => setStatus("active")} disabled={busy} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Restore</button>
              )}
              <button
                type="button"
                onClick={remove}
                disabled={busy || used}
                title={used ? "This link has been used, so it can only be archived." : "Delete this unused link"}
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete
              </button>
            </div>
            {used && <p className="text-xs text-gray-400">This link has visits, so it can be archived but not deleted.</p>}
          </div>
          <LinkQrCode url={short} slug={link.slug} />
        </div>
      )}
    </div>
  );
}
