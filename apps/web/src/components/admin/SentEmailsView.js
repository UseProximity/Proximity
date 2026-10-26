"use client";

/*
 * Admin view of every email the app sent (Wyatt, 2026-10-24). Emails go out
 * through Amazon SES (or Gmail as a fallback) with info@ on the From line, so
 * they never appear in the info@ Gmail Sent folder; this is where to check one.
 *
 * Tabs sort them by category (lib/emailLog.js), each with its count, and
 * "Problems only" narrows to the ones that bounced, were marked as spam, were
 * refused, failed or are still delayed. The header search box matches the
 * recipient or subject. Each row shows when, who, what and how it went; "View
 * email" opens the body as sent, with login links replaced by [removed].
 *
 * Status comes from SES's own delivery reports (/api/ses/events). Gmail sends
 * have none, and say so rather than looking delivered.
 */

import { useEffect, useState } from "react";
import { adminFetch, Badge, shortId } from "@/components/admin/adminShared";
import { CATEGORIES, kindLabel } from "@/lib/emailKinds";

const TABS = [{ key: "all", label: "All" }, ...CATEGORIES];

// An SES email with no report after this long is worth a look.
const NO_REPORT_AFTER_MS = 60 * 60 * 1000;

function fmtWhen(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusBadge(row) {
  switch (row.status) {
    case "delivered":
      return { color: "green", label: "Delivered", title: "The recipient's mail server accepted it. Inbox or spam is not reported." };
    case "delayed":
      return { color: "amber", label: "Delayed", title: "Their server is deferring it; Amazon SES keeps retrying." };
    case "bounced":
      return { color: "red", label: "Bounced", title: "Permanently refused by the recipient's server." };
    case "complained":
      return { color: "red", label: "Marked as spam" };
    case "rejected":
      return { color: "red", label: "Refused by SES" };
    case "failed":
      return { color: "red", label: "Failed to send" };
    case "suppressed":
      return { color: "gray", label: "Not sent (test site)", title: "Off the live site with no test inbox chosen, so nothing was sent." };
    default:
      if (row.provider === "gmail") {
        return { color: "gray", label: "Sent via Gmail", title: "Gmail does not report delivery, so this cannot be confirmed." };
      }
      if (Date.now() - new Date(row.created_at).getTime() > NO_REPORT_AFTER_MS) {
        return { color: "amber", label: "No report yet", title: "Sent through Amazon SES over an hour ago with no delivery report." };
      }
      return { color: "gray", label: "Sent", title: "Waiting for Amazon SES's delivery report." };
  }
}

function EmailBody({ id, dbTarget }) {
  const [body, setBody] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch(`/api/admin/sent-emails/${id}`, dbTarget)
      .then((b) => { if (!cancelled) setBody(b); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [id, dbTarget]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!body) return <p className="text-xs text-gray-400">Loading…</p>;
  if (!body.html && !body.text) {
    return <p className="text-xs italic text-gray-400">The body was not kept for this email (sent before this page existed).</p>;
  }
  return (
    <div>
      {body.fromEmail && <p className="mb-1 text-[11px] text-gray-500">From {body.fromEmail}</p>}
      {body.html ? (
        // sandbox with no permissions: no scripts, no forms, links do not navigate.
        <iframe title="Email as sent" sandbox="" srcDoc={body.html} className="w-full h-[480px] rounded-lg border border-gray-200 bg-white" />
      ) : (
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-800">{body.text}</pre>
      )}
      <p className="mt-1 text-[11px] text-gray-400">Login, setup and invite links are shown as [removed].</p>
    </div>
  );
}

function EmailRow({ row, dbTarget }) {
  const [open, setOpen] = useState(false);
  const status = statusBadge(row);
  return (
    <li className="border-b border-gray-100 last:border-0">
      <div className="flex items-start gap-3 px-4 py-2.5">
        <span className="w-28 shrink-0 text-xs text-gray-500 pt-0.5">{fmtWhen(row.created_at)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900 break-all">{row.to_email ?? "(no recipient)"}</span>
            <Badge color={status.color} title={status.title}>{status.label}</Badge>
            {row.redirected_to && <Badge color="blue" title="Off the live site, the email went to a test inbox instead">test copy to {row.redirected_to}</Badge>}
          </div>
          <p className="text-sm text-gray-700 truncate">
            {row.subject ?? <span className="italic text-gray-400">Sent before this page existed: subject and email not kept</span>}
          </p>
          <div className="mt-0.5 flex items-center gap-2 flex-wrap text-[11px] text-gray-400">
            <span>{kindLabel(row.kind)}</span>
            {row.cc && <span>cc {row.cc}</span>}
            {row.thread_id && <span>conversation {shortId(row.thread_id)}</span>}
            {row.delivered_at && <span>delivered {fmtWhen(row.delivered_at)}</span>}
            {row.status_detail && row.status !== "delivered" && <span className="text-gray-500">{row.status_detail}</span>}
          </div>
        </div>
        {/* Rows copied from the old chat log have no subject, and no body to show. */}
        {row.subject !== null && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 px-2 py-1 text-xs rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            {open ? "Hide email" : "View email"}
          </button>
        )}
      </div>
      {open && (
        <div className="px-4 pb-4">
          <EmailBody id={row.id} dbTarget={dbTarget} />
        </div>
      )}
    </li>
  );
}

export default function SentEmailsView({ search, dbTarget }) {
  const [tab, setTab] = useState("all");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [query, setQuery] = useState(search);
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [nextBefore, setNextBefore] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // The header box updates on every keystroke; wait for a pause.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  function url(before) {
    const p = new URLSearchParams();
    if (tab !== "all") p.set("category", tab);
    if (problemsOnly) p.set("problems", "1");
    if (query) p.set("q", query);
    if (before) p.set("before", before);
    return `/api/admin/sent-emails?${p}`;
  }

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    adminFetch(url(), dbTarget)
      .then((out) => {
        if (cancelled) return;
        setRows(out.rows);
        setCounts(out.counts ?? {});
        setNextBefore(out.nextBefore);
      })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
    // url() reads exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, problemsOnly, query, dbTarget]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const out = await adminFetch(url(nextBefore), dbTarget);
      setRows((r) => [...(r ?? []), ...out.rows]);
      setNextBefore(out.nextBefore);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-1 text-xs rounded-full border ${
              tab === t.key ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {t.label} <span className={tab === t.key ? "text-gray-300" : "text-gray-400"}>{counts[t.key] ?? ""}</span>
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-700">
          <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
          Problems only
        </label>
      </div>

      {error && <div className="mb-3 px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl">{error}</div>}

      <div className="rounded-xl border border-gray-200 bg-white">
        {rows === null ? (
          <p className="py-16 text-center text-sm text-gray-400">Loading sent emails…</p>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">
            {problemsOnly ? "No problems. Every email here was delivered or is on its way." : "No emails match."}
          </p>
        ) : (
          <ul>
            {rows.map((r) => <EmailRow key={r.id} row={r} dbTarget={dbTarget} />)}
          </ul>
        )}
      </div>

      {nextBefore && (
        <div className="mt-3 text-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={loadMore}
            className="px-3 py-1.5 text-xs rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Show older emails"}
          </button>
        </div>
      )}
    </div>
  );
}
