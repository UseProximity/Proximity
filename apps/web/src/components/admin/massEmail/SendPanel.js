"use client";

/*
 * Picking who a mass email goes to and sending it (Wyatt, 2026-11-07).
 *
 * The list is every account of the chosen role with an email address (deleted
 * and review sandbox accounts never appear). Filters narrow it; ticking people
 * picks them. Flags say who has no password yet (their button becomes a
 * set-password link), whose only live leases are subleases, and who already got
 * this email. A test goes to one address first, then Send emails the people
 * picked, a chunk at a time, with a running count.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/admin/adminShared";
import { api, FIELD, fmtWhen, Notice, PRIMARY, SECONDARY } from "./shared";

const ROLE_OPTIONS = [
  { key: "landlord", label: "Landlords" },
  { key: "student", label: "Students" },
  { key: "all", label: "Everyone" },
];

export default function SendPanel({ template, dbTarget, writable, onSent }) {
  const versions = template.versions;
  const [versionId, setVersionId] = useState(versions[0]?.id ?? null);
  const [role, setRole] = useState("landlord");
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [query, setQuery] = useState("");
  const [liveOnly, setLiveOnly] = useState(true);
  const [hideSent, setHideSent] = useState(true);
  const [hideSublease, setHideSublease] = useState(true);
  const [picked, setPicked] = useState(() => new Set());
  const [turnProxyOn, setTurnProxyOn] = useState(false);
  const [allowRepeat, setAllowRepeat] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  // The batch a failed send was working on: pressing Send again continues it, and
  // the server skips everyone it already reached (review of 2026-11-07).
  const [resume, setResume] = useState(null);

  const load = useCallback(async () => {
    setPeople(null);
    try {
      const d = await api(`/api/admin/mass-email/recipients?role=${role}&templateId=${template.id}`, dbTarget);
      setPeople(d.people);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [role, template.id, dbTarget]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people ?? []).filter((p) => {
      if (liveOnly && role !== "student" && !p.live) return false;
      if (hideSent && p.lastSent) return false;
      if (hideSublease && p.subleaseOnly) return false;
      if (!q) return true;
      return [p.name, p.email, p.company, ...p.listings.map((l) => l.label)].some((v) => v && v.toLowerCase().includes(q));
    });
  }, [people, query, liveOnly, hideSent, hideSublease, role]);

  const pickedPeople = useMemo(() => (people ?? []).filter((p) => picked.has(p.id)), [people, picked]);
  const allShownPicked = shown.length > 0 && shown.every((p) => picked.has(p.id));
  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleShown = () =>
    setPicked((s) => {
      const n = new Set(s);
      for (const p of shown) {
        if (allShownPicked) n.delete(p.id);
        else n.add(p.id);
      }
      return n;
    });

  const version = versions.find((v) => v.id === versionId);
  const noLogin = pickedPeople.filter((p) => !p.canLogin).length;
  const repeats = pickedPeople.filter((p) => p.lastSent).length;
  const proxyListings = pickedPeople.filter((p) => p.role === "landlord").reduce((n, p) => n + p.listings.length, 0);

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const preview = pickedPeople[0] ?? null;
      const r = await api("/api/admin/mass-email/send", dbTarget, "POST", { mode: "test", versionId, to: testTo || undefined, previewUserId: preview?.id });
      setNotice(
        r.suppressed
          ? `Test not sent: this is not the live site and no test inbox is chosen.`
          : `Test sent to ${r.redirected ? "the test inbox" : r.to}${preview ? `, filled in as ${preview.name || preview.email}` : ""}.`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setConfirming(false);
    setError(null);
    setNotice(null);
    let remaining = pickedPeople.map((p) => p.id);
    let batchId = resume?.versionId === versionId ? resume.batchId : null;
    const total = { sent: 0, failed: 0, skipped: [] };
    setProgress({ done: 0, of: remaining.length });
    try {
      while (remaining.length) {
        const r = await api("/api/admin/mass-email/send", dbTarget, "POST", {
          mode: "send", versionId, userIds: remaining, confirm: true, turnProxyOn, allowRepeat, batchId,
        });
        batchId = r.batchId;
        total.sent += r.sent;
        total.failed += r.failed;
        total.skipped.push(...r.skipped);
        remaining = r.remaining;
        setProgress({ done: pickedPeople.length - remaining.length, of: pickedPeople.length });
      }
      setResume(null);
      const parts = [`Sent ${total.sent}.`];
      if (total.failed) parts.push(`${total.failed} failed (see History).`);
      if (total.skipped.length) parts.push(`${total.skipped.length} skipped (already sent, bounced, or no longer emailable).`);
      setNotice(parts.join(" "));
      setPicked(new Set());
      await load();
      await onSent?.();
    } catch (e) {
      if (batchId) setResume({ batchId, versionId });
      setError(`${e.message} Press Send again to continue: everyone this send already reached is skipped.`);
      await load();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  if (!versions.length) return <Notice>Save a version on the Write tab first.</Notice>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-gray-600">Version</span>
          <select value={versionId ?? ""} onChange={(e) => setVersionId(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-2 text-sm">
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                Version {v.version}: {v.subject.slice(0, 50)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-gray-600">Who</span>
          <select value={role} onChange={(e) => { setRole(e.target.value); setPicked(new Set()); }} className="rounded-lg border border-gray-300 px-2 py-2 text-sm">
            {ROLE_OPTIONS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, company or listing" className={`${FIELD} max-w-xs`} />
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-gray-700">
        {role !== "student" && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
            Something live on the site
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hideSent} onChange={(e) => setHideSent(e.target.checked)} />
          Hide people who already got this email
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hideSublease} onChange={(e) => setHideSublease(e.target.checked)} />
          Hide sublease-only accounts
        </label>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="ok">{notice}</Notice>}

      {!people ? (
        <div className="py-10 text-center text-sm text-gray-400">Loading people…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" checked={allShownPicked} onChange={toggleShown} aria-label="Pick everyone shown" />
                </th>
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Live listings</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((p) => (
                <tr key={p.id} className={picked.has(p.id) ? "bg-red-50/40" : ""}>
                  <td className="px-3 py-2 align-top">
                    <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Pick ${p.email}`} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-gray-900">{p.name || "(no name)"}</div>
                    <div className="text-xs text-gray-500">
                      {p.email}
                      {p.company ? ` · ${p.company}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-600">
                    {p.listings.length ? (
                      <span title={p.listings.map((l) => l.label).join("\n")}>
                        {p.listings.slice(0, 2).map((l) => l.label).join(", ")}
                        {p.listings.length > 2 ? ` +${p.listings.length - 2} more` : ""}
                      </span>
                    ) : p.leaseCount ? (
                      `${p.leaseCount} lease${p.leaseCount === 1 ? "" : "s"} on others' listings`
                    ) : (
                      <span className="text-gray-400">None</span>
                    )}
                  </td>
                  <td className="space-x-1 px-3 py-2 align-top">
                    {p.role === "student" && role === "all" && <Badge color="blue">Student</Badge>}
                    {!p.canLogin && <Badge color="amber" title="No password, Google or Apple sign-in. Their button becomes a set-password link.">No password yet</Badge>}
                    {p.subleaseOnly && <Badge color="purple" title="Every live lease they own is a sublease, and they have no live listing.">Sublease only</Badge>}
                    {p.lastSent && <Badge color="green">Got v{p.lastSent.version} {fmtWhen(p.lastSent.at)}</Badge>}
                    {p.suppressed && <Badge color="red" title="Their address bounced or marked our email as spam. They are skipped when you send.">Bounced or spam</Badge>}
                    {p.unsubscribed && !p.suppressed && <Badge color="gray" title="They used the unsubscribe link or their mail app's Unsubscribe button. They are skipped when you send.">Unsubscribed</Badge>}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-gray-400">
                    Nobody matches these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="sticky bottom-0 z-10 space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <div className="text-sm text-gray-700">
          <strong>{pickedPeople.length}</strong> picked
          {noLogin ? ` · ${noLogin} get a set-password button` : ""}
          {repeats ? ` · ${repeats} already got this email` : ""}
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" className="mt-1" checked={turnProxyOn} onChange={(e) => setTurnProxyOn(e.target.checked)} disabled={!writable} />
          <span>
            Also turn Proxy on for their live listings
            {turnProxyOn && proxyListings ? ` (${proxyListings} listing${proxyListings === 1 ? "" : "s"})` : ""}. Landlords cannot turn it off.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" className="mt-1" checked={allowRepeat} onChange={(e) => setAllowRepeat(e.target.checked)} disabled={!writable} />
          <span>Send again to people who already got this email (otherwise they are skipped)</span>
        </label>

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Test to (your own email by default)" className={`${FIELD} max-w-xs`} />
          <button type="button" onClick={sendTest} disabled={!writable || busy || !versionId} className={SECONDARY}>
            Send a test
          </button>
          <span className="text-xs text-gray-500">{pickedPeople[0] ? `Filled in as ${pickedPeople[0].name || pickedPeople[0].email}.` : "Pick someone to fill it in as them."}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)} disabled={!writable || busy || !pickedPeople.length} className={PRIMARY}>
              Send to {pickedPeople.length} {pickedPeople.length === 1 ? "person" : "people"}
            </button>
          ) : (
            <>
              <span className="text-sm text-gray-800">
                Send version {version?.version} to {pickedPeople.length} {pickedPeople.length === 1 ? "person" : "people"}
                {turnProxyOn ? " and turn Proxy on for their listings" : ""}?
              </span>
              <button type="button" onClick={send} disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
                Yes, send
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={SECONDARY}>
                Cancel
              </button>
            </>
          )}
          {progress && (
            <span className="text-sm text-gray-600">
              Sending… {progress.done} of {progress.of}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
