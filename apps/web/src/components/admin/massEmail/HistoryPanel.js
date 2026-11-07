"use client";

/*
 * Every send of one mass email, newest first, with each recipient and how their
 * email went (Wyatt, 2026-11-07). Delivery comes from Amazon SES's reports; an
 * email sent through Gmail cannot be confirmed and says so.
 */

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/admin/adminShared";
import { api, fmtWhen, Notice } from "./shared";

const STATUS = {
  delivered: ["green", "Delivered"],
  sent: ["gray", "Sent"],
  redirected: ["blue", "Sent to test inbox"],
  suppressed: ["gray", "Not sent (test site)"],
  delayed: ["amber", "Delayed"],
  bounced: ["red", "Bounced"],
  complained: ["red", "Marked as spam"],
  rejected: ["red", "Refused by SES"],
  failed: ["red", "Failed"],
};

export default function HistoryPanel({ template, dbTarget }) {
  const [batches, setBatches] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/admin/mass-email/${template.id}`, dbTarget);
      setBatches(d.batches);
      setOpen((cur) => cur ?? d.batches[0]?.id ?? null);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [template.id, dbTarget]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!batches) return <div className="py-10 text-center text-sm text-gray-400">Loading…</div>;
  if (!batches.length) return <Notice>Nothing sent yet.</Notice>;

  return (
    <div className="space-y-3">
      {batches.map((b) => {
        const counts = b.recipients.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
        const problems = (counts.bounced ?? 0) + (counts.complained ?? 0) + (counts.rejected ?? 0) + (counts.failed ?? 0);
        return (
          <div key={b.id} className="rounded-lg border border-gray-200">
            <button type="button" onClick={() => setOpen(open === b.id ? null : b.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left">
              <span className="text-sm text-gray-900">
                <strong>{fmtWhen(b.createdAt)}</strong> · version {b.version} · {b.recipients.length} {b.recipients.length === 1 ? "person" : "people"}
                {b.sentBy ? ` · by ${b.sentBy}` : ""}
                {b.turnProxyOn ? " · Proxy turned on" : ""}
              </span>
              <span className="space-x-1">
                {counts.delivered ? <Badge color="green">{counts.delivered} delivered</Badge> : null}
                {problems ? <Badge color="red">{problems} problem{problems === 1 ? "" : "s"}</Badge> : null}
              </span>
            </button>
            {open === b.id && (
              <table className="w-full border-t border-gray-100 text-sm">
                <tbody className="divide-y divide-gray-100">
                  {b.recipients.map((r) => {
                    const [color, label] = STATUS[r.status] ?? ["gray", r.status];
                    return (
                      <tr key={r.id}>
                        <td className="px-4 py-2">
                          <div className="text-gray-900">{r.name || r.email}</div>
                          {r.name && <div className="text-xs text-gray-500">{r.email}</div>}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {r.setupLink ? "Set-password link · " : ""}
                          {r.proxyListings ? `Proxy on for ${r.proxyListings} listing${r.proxyListings === 1 ? "" : "s"}` : ""}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Badge color={color} title={r.detail ?? undefined}>{label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
