"use client";

/*
 * Live listings with no landlord account (Wyatt, 2026-11-07), each with a
 * suggested fix from its contact email and leases (lib/massEmail/unowned.js).
 * Nothing changes until an admin presses the button on a row:
 *
 *   Attach  links the listing to the landlord account that has its contact email
 *   Invite  creates a landlord account for the contact email (no password yet; the
 *           next mass email gives them a set-password link) and links every
 *           listing that shares that email
 *   Skip / Needs a person   shown with the reason, no button
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/admin/adminShared";
import { api, Notice } from "./shared";

const ACTION = {
  attach: ["green", "Attach"],
  invite: ["blue", "Invite"],
  skip: ["gray", "Skip"],
  manual: ["amber", "Needs a person"],
};
const ORDER = ["attach", "invite", "manual", "skip"];

// `writable` comes from the caller when it already knows; on its own page
// (Listings > Without an account) the panel takes it from the server's answer.
export default function UnownedPanel({ dbTarget, writable: writableProp }) {
  const [serverWritable, setServerWritable] = useState(false);
  const writable = writableProp ?? serverWritable;
  const [listings, setListings] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api("/api/admin/mass-email/unowned", dbTarget);
      setListings(d.listings);
      setServerWritable(!!d.writable);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [dbTarget]);

  useEffect(() => {
    load();
  }, [load]);

  // Invites go out once per contact email, covering all of its listings.
  const inviteGroups = useMemo(() => {
    const groups = new Map();
    for (const l of listings ?? []) {
      if (l.suggestion.action !== "invite") continue;
      groups.set(l.contactEmail, [...(groups.get(l.contactEmail) ?? []), l]);
    }
    return groups;
  }, [listings]);

  const sorted = useMemo(
    () => [...(listings ?? [])].sort((a, b) => ORDER.indexOf(a.suggestion.action) - ORDER.indexOf(b.suggestion.action)),
    [listings]
  );

  const act = async (l) => {
    const s = l.suggestion;
    const group = s.action === "invite" ? inviteGroups.get(l.contactEmail) ?? [l] : [l];
    const what =
      s.action === "attach"
        ? `Link ${l.label} to ${s.userName || "that landlord"}'s account?`
        : `Create a landlord account for ${l.contactEmail} and link ${group.map((g) => g.label).join(", ")}?`;
    if (!window.confirm(what)) return;
    setBusy(l.id);
    setError(null);
    setNotice(null);
    try {
      if (s.action === "attach") {
        await api("/api/admin/mass-email/unowned", dbTarget, "POST", { action: "attach", userId: s.userId, listingIds: [l.id] });
        setNotice(`${l.label} is now on ${s.userName || "the landlord"}'s account.`);
      } else {
        const r = await api("/api/admin/mass-email/unowned", dbTarget, "POST", {
          action: "invite",
          email: l.contactEmail,
          name: l.contactName,
          listingIds: group.map((g) => g.id),
        });
        setNotice(`Created ${r.name} (${l.contactEmail}) with ${r.linked} listing${r.linked === 1 ? "" : "s"}. They show on the Send tab with "No password yet".`);
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!listings && !error) return <div className="py-10 text-center text-sm text-gray-400">Loading…</div>;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Listings without an account</h2>
      <p className="text-sm text-gray-600">
        Live listings that no landlord account owns. Nobody on them can sign in, sign the marketing agreement or answer Proxy until one does.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="ok">{notice}</Notice>}
      {listings && !listings.length && <Notice kind="ok">Every live listing has a landlord account.</Notice>}
      {listings?.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Listing</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">Suggestion</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((l) => {
                const [color, label] = ACTION[l.suggestion.action] ?? ["gray", l.suggestion.action];
                const canAct = writable && (l.suggestion.action === "attach" || l.suggestion.action === "invite");
                return (
                  <tr key={l.id}>
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-gray-900">{l.label}</div>
                      <div className="text-xs text-gray-500">
                        {l.leaseCount} live lease{l.leaseCount === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-gray-600">
                      <div>{l.contactName || "(no name)"}</div>
                      <div>{l.contactEmail || <span className="text-gray-400">no email</span>}</div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Badge color={color}>{label}</Badge>
                      <div className="mt-1 text-xs text-gray-500">{l.suggestion.reason}</div>
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      {canAct && (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => act(l)}
                          className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {busy === l.id ? "Working…" : l.suggestion.action === "attach" ? `Attach to ${l.suggestion.userName || "landlord"}` : "Invite"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
