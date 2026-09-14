"use client";

/*
 * Review invites: pick students, write one message, send it to all of them with
 * a personal link each. Plus the ledger of what has already gone out.
 *
 * Unlike every other view in this dashboard, this one does NOT read the dev/prod
 * switch. Sending is an outreach action, not a database edit: an invite writes a
 * row that a later review has to find, so it always targets whichever database
 * the running app already serves. Minting against prod from a local dashboard
 * would mail a link that this app cannot resolve. The banner says so rather than
 * leaving an admin to infer it from the red PROD bar above.
 *
 * SENDING IS CHUNKED BY THIS COMPONENT. A campaign of several hundred cannot go
 * in one request: Gmail SMTP takes about a second per message and a Vercel
 * function stops at 300s. So the selection is walked in batches of 50, which
 * also turns an opaque spinner into a real progress bar and means one failed
 * chunk costs 50 emails rather than the whole campaign.
 *
 * EXPORT IS THE SAME CAMPAIGN, MAILED BY A PERSON. It walks the identical
 * selection through the identical endpoint and gets links back instead of
 * sending them, so a batch can go out of an admin's own inbox. A review request
 * from a classmate's address outperforms one from info@, and the roster is
 * students who have never heard of us. The composer above is skipped in this
 * mode: the message that matters is the one written in Outlook.
 *
 * The downloaded file holds working links. Anyone who opens one can post a
 * review as that student, which is exactly the trust an invited review sells,
 * so the UI says to delete the file once the merge has gone out.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { fmtDate } from "@/components/admin/adminShared";
import RosterPicker from "@/components/admin/reviewInvites/RosterPicker";
import InviteComposer, {
  DEFAULT_SUBJECT,
  DEFAULT_MESSAGE,
} from "@/components/admin/reviewInvites/InviteComposer";

// Must not exceed MAX_PER_REQUEST in /api/admin/review-invites.
const CHUNK = 50;

const STATUS_STYLES = {
  used: "bg-green-100 text-green-800 border-green-200",
  sent: "bg-blue-100 text-blue-800 border-blue-200",
  expired: "bg-gray-100 text-gray-600 border-gray-200",
  pending: "bg-amber-100 text-amber-800 border-amber-200",
};

function StatusPill({ status }) {
  return (
    <span
      className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border uppercase tracking-wide ${
        STATUS_STYLES[status] || STATUS_STYLES.pending
      }`}
    >
      {status}
    </span>
  );
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/*
 * The anti-forwarding notice. sendReviewInviteEmail appends this to every email
 * it sends, because it is a property of the link and not of whatever the admin
 * chose to write above it. An exported batch leaves through a mail merge that
 * knows nothing about that, so the copy is surfaced here to be pasted in. A
 * forwarded link is the one behaviour that breaks the guarantee an invited
 * review makes, and this sentence is the only thing that warns anyone.
 */
const MERGE_FOOTER =
  "This link is personal to you and posts your review under your own email " +
  "address, so please don't forward it. It works for the next 30 days.";

/*
 * Quote anything that would otherwise break the row apart. Names are the reason
 * this is needed rather than a plain join: a roster first name can legitimately
 * contain a comma, and Excel is the thing reading the file.
 */
function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const header = ["first_name", "email", "link", "expires_at"];
  return [
    header,
    ...rows.map((r) => [r.firstName, r.email, r.link, r.expiresAt]),
  ]
    .map((cols) => cols.map(csvCell).join(","))
    .join("\r\n");
}

/*
 * A BOM because Excel assumes the local codepage without one and mangles any
 * name outside ASCII, which on this roster is a lot of them.
 */
function downloadCsv(text, filename) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ReviewInvitesView({ search = "" }) {
  const [tab, setTab] = useState("send");

  // ── Selection ────────────────────────────────────────────────────────────
  // A Map keyed by roster id so it survives searching, filtering and paging in
  // the picker: tick someone, search for someone else, tick them too, and the
  // answer has to be two people rather than one.
  const [selected, setSelected] = useState(new Map());

  const toggle = useCallback((row) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  }, []);

  const addMany = useCallback((rows) => {
    setSelected((prev) => {
      const next = new Map(prev);
      rows.forEach((r) => next.set(r.id, r));
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Map()), []);

  // ── Composer ─────────────────────────────────────────────────────────────
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [pasted, setPasted] = useState("");

  const selectedRows = useMemo(() => [...selected.values()], [selected]);
  const usesFirstName = message.includes("{first_name}");

  /*
   * Anyone selected who has no first name. When the message greets people by
   * name these are dropped before sending rather than mailed "Hi ,", and the
   * count is what the composer warns about.
   */
  const missingFirstName = useMemo(
    () => selectedRows.filter((r) => !r.has_first_name),
    [selectedRows]
  );

  const pastedEmails = useMemo(
    () => [
      ...new Set(
        pasted
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      ),
    ],
    [pasted]
  );

  // Who the send will actually reach, after the first-name rule is applied.
  const sendableRows = usesFirstName
    ? selectedRows.filter((r) => r.has_first_name)
    : selectedRows;
  const totalToSend = sendableRows.length + pastedEmails.length;

  // ── Sending ──────────────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total, sent, failed }
  const [failures, setFailures] = useState([]);
  const [error, setError] = useState(null);

  async function postChunk(payload) {
    const res = await fetch("/api/admin/review-invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Send failed");
    return data;
  }

  async function handleSend() {
    if (!totalToSend || sending) return;
    if (!message.includes("{link}")) {
      setError("Your message needs {link} in it.");
      return;
    }
    const skipNote = usesFirstName && missingFirstName.length
      ? `\n\n${missingFirstName.length} selected student${
          missingFirstName.length === 1 ? "" : "s"
        } will be skipped for having no first name.`
      : "";
    if (
      !confirm(
        `Send this invite to ${totalToSend} student${totalToSend === 1 ? "" : "s"}?` +
          `${skipNote}\n\nEach one gets a personal link that posts a review under their own email.`
      )
    )
      return;

    setSending(true);
    setError(null);
    setFailures([]);

    // Roster picks and pasted addresses are chunked separately: the endpoint
    // takes one shape or the other per request, and roster ids carry the first
    // name the template needs without a second lookup.
    const batches = [
      ...chunk(sendableRows.map((r) => r.id), CHUNK).map((ids) => ({ rosterIds: ids })),
      ...chunk(pastedEmails, CHUNK).map((emails) => ({ emails })),
    ];

    let sent = 0;
    let failed = 0;
    const collected = [];
    setProgress({ done: 0, total: totalToSend, sent: 0, failed: 0 });

    try {
      for (let i = 0; i < batches.length; i++) {
        const size =
          batches[i].rosterIds?.length ?? batches[i].emails?.length ?? 0;
        const data = await postChunk({ ...batches[i], subject, message });
        sent += data.sent || 0;
        failed += data.failed || 0;
        collected.push(...(data.results || []).filter((r) => !r.ok));
        setProgress((p) => ({
          done: (p?.done || 0) + size,
          total: totalToSend,
          sent,
          failed,
        }));
      }
      setFailures(collected);
      // Everyone who got an email is now "contacted", so the picker's status
      // column and the ledger are both stale. Clearing the selection also stops
      // a second click resending to the same people.
      clearSelection();
      setPasted("");
      loadInvites();
    } catch (err) {
      setError(`${err.message} (stopped after ${sent} sent)`);
    } finally {
      setSending(false);
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(null); // { count, filename }

  /*
   * Export takes the whole selection, not sendableRows. The first-name filter
   * exists to stop the composer greeting someone "Hi ,", and the composer is not
   * what sends an export. Dropping people here would silently shrink a batch
   * because of wording in a message that never leaves the browser.
   */
  const totalToExport = selectedRows.length + pastedEmails.length;

  async function handleExport() {
    if (!totalToExport || exporting || sending) return;
    if (
      !confirm(
        `Create ${totalToExport} invite link${totalToExport === 1 ? "" : "s"} and download them as a CSV?\n\n` +
          "No email is sent. These count as invited, so the dashboard will not " +
          "email them again while the links are live.\n\n" +
          "The file contains working links. Delete it once your merge has gone out."
      )
    )
      return;

    setExporting(true);
    setError(null);
    setFailures([]);
    setExported(null);

    const batches = [
      ...chunk(selectedRows.map((r) => r.id), CHUNK).map((ids) => ({ rosterIds: ids })),
      ...chunk(pastedEmails, CHUNK).map((emails) => ({ emails })),
    ];

    const rows = [];
    const collected = [];
    setProgress({ done: 0, total: totalToExport, sent: 0, failed: 0 });

    try {
      for (let i = 0; i < batches.length; i++) {
        const size = batches[i].rosterIds?.length ?? batches[i].emails?.length ?? 0;
        const data = await postChunk({ ...batches[i], mode: "export" });
        rows.push(...(data.results || []).filter((r) => r.ok));
        collected.push(...(data.results || []).filter((r) => !r.ok));
        setProgress((p) => ({
          done: (p?.done || 0) + size,
          total: totalToExport,
          sent: rows.length,
          failed: collected.length,
        }));
      }

      setFailures(collected);
      if (!rows.length) {
        setError("Nothing to export. Everyone selected already has a live invite.");
        return;
      }

      const filename = `review-invite-links-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(toCsv(rows), filename);
      setExported({ count: rows.length, filename });
      clearSelection();
      setPasted("");
      loadInvites();
    } catch (err) {
      /*
       * Whatever already downloaded is not what failed, but the tokens minted in
       * the chunk that threw are gone: the response never arrived, so nobody
       * holds those links and the rows sit unusable until they expire.
       */
      setError(`${err.message} (stopped after ${rows.length} link${rows.length === 1 ? "" : "s"})`);
    } finally {
      setExporting(false);
    }
  }

  // ── Ledger ───────────────────────────────────────────────────────────────
  const [invites, setInvites] = useState([]);
  const [counts, setCounts] = useState({});
  const [loadingInvites, setLoadingInvites] = useState(true);

  const loadInvites = useCallback(async () => {
    setLoadingInvites(true);
    try {
      const res = await fetch("/api/admin/review-invites");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load invites");
      setInvites(data.invites || []);
      setCounts(data.counts || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingInvites(false);
    }
  }, []);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  const q = search.trim().toLowerCase();
  const filteredInvites = q
    ? invites.filter((i) => (i.email || "").toLowerCase().includes(q))
    : invites;

  return (
    <div className="space-y-4">
      <div className="px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
        Invites always use the database this app is running against, not the
        dev/prod switch above. Off production, the outreach guard redirects every
        email to your test inbox.
      </div>

      <div className="flex rounded-lg overflow-hidden border border-gray-300 w-fit">
        {[
          { key: "send", label: "Send" },
          { key: "history", label: `History (${invites.length})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 text-xs font-semibold ${
              tab === t.key ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl">
          {error}
        </div>
      )}

      {tab === "send" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              1. Choose students
            </h3>
            <RosterPicker
              selected={selected}
              onToggle={toggle}
              onAddMany={addMany}
              onClear={clearSelection}
            />
            <div className="mt-3">
              <label htmlFor="invite-paste" className="block text-xs font-semibold text-gray-700 mb-1">
                Or paste addresses that are not on the roster
              </label>
              <textarea
                id="invite-paste"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={2}
                placeholder="one@wustl.edu, two@wustl.edu"
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
              />
              {pastedEmails.length > 0 && (
                <p className="mt-1 text-[11px] text-gray-500">
                  {pastedEmails.length} pasted address
                  {pastedEmails.length === 1 ? "" : "es"}. These have no roster row, so
                  {" {first_name}"} only works if we happen to have them on file.
                </p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              2. Write the message
            </h3>
            <InviteComposer
              subject={subject}
              onSubjectChange={setSubject}
              message={message}
              onMessageChange={setMessage}
              sampleRecipient={sendableRows[0] || null}
              missingFirstNameCount={missingFirstName.length}
            />

            <div className="mt-4 p-4 rounded-xl border border-blue-200 bg-blue-50/50 space-y-2">
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !totalToSend || !message.includes("{link}")}
                className="w-full px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending
                  ? "Sending…"
                  : `Send to ${totalToSend} student${totalToSend === 1 ? "" : "s"}`}
              </button>

              {usesFirstName && missingFirstName.length > 0 && (
                <p className="text-[11px] text-amber-800">
                  {missingFirstName.length} selected student
                  {missingFirstName.length === 1 ? "" : "s"} skipped for having no
                  first name.
                </p>
              )}

              {progress && (
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all"
                      style={{
                        width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-600">
                    {progress.done} of {progress.total} processed · {progress.sent} sent
                    {progress.failed ? ` · ${progress.failed} skipped` : ""}
                  </p>
                </div>
              )}

              {failures.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {failures.map((f) => (
                    <p key={f.email} className="text-[11px] text-red-600">
                      {f.email}: {f.error}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
              <h4 className="text-xs font-semibold text-gray-700">
                Or send it yourself
              </h4>
              <p className="text-[11px] text-gray-600 leading-relaxed">
                Downloads a CSV of personal links for everyone selected, without
                emailing anyone. Mail merge it from your own address when the
                message should come from a person rather than from Proximity. The
                message above is not used.
              </p>

              <button
                type="button"
                onClick={handleExport}
                disabled={exporting || sending || !totalToExport}
                className="w-full px-3 py-2 text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting
                  ? "Creating links…"
                  : `Export ${totalToExport} link${totalToExport === 1 ? "" : "s"} as CSV`}
              </button>

              {missingFirstName.length > 0 && totalToExport > 0 && (
                <p className="text-[11px] text-amber-800">
                  {missingFirstName.length} of these have no first name on file, so
                  their first_name column will be blank. Handle that in your merge
                  or your greeting reads &quot;Hi ,&quot;.
                </p>
              )}

              {exported && (
                <div className="space-y-2 pt-1">
                  <p className="text-[11px] text-green-700 font-medium">
                    {exported.count} link{exported.count === 1 ? "" : "s"} saved to{" "}
                    {exported.filename}. These are now marked invited.
                  </p>
                  <p className="text-[11px] text-red-700">
                    That file contains working review links. Delete it once the
                    merge has gone out.
                  </p>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-700 mb-1">
                      Put this at the bottom of your email:
                    </p>
                    <p className="p-2 rounded border border-gray-300 bg-white text-[11px] text-gray-600 leading-relaxed">
                      {MERGE_FOOTER}
                    </p>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(MERGE_FOOTER)}
                      className="mt-1 px-2 py-1 text-[11px] font-semibold bg-gray-200 hover:bg-gray-300 text-gray-700 rounded"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {filteredInvites.length} of {invites.length} invites
              {Object.keys(counts).length > 0 && (
                <>
                  {" "}
                  ({["used", "sent", "expired", "pending"]
                    .filter((k) => counts[k])
                    .map((k) => `${counts[k]} ${k}`)
                    .join(", ")})
                </>
              )}
            </p>
            <button
              type="button"
              onClick={loadInvites}
              className="px-3 py-1.5 text-xs font-semibold bg-gray-200 hover:bg-gray-300 text-gray-700 rounded"
            >
              Refresh
            </button>
          </div>

          {loadingInvites ? (
            <div className="py-16 text-center text-sm text-gray-400">Loading invites…</div>
          ) : filteredInvites.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">
              No invites yet. Send one from the Send tab to try the flow end to end.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Email</th>
                    <th className="text-left px-3 py-2 font-semibold">Status</th>
                    <th className="text-left px-3 py-2 font-semibold">Sent</th>
                    <th className="text-left px-3 py-2 font-semibold">Reviewed</th>
                    <th className="text-left px-3 py-2 font-semibold">Expires</th>
                    <th className="text-left px-3 py-2 font-semibold">Invited by</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvites.map((i) => (
                    <tr key={i.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium text-gray-900">{i.email}</td>
                      <td className="px-3 py-2">
                        <StatusPill status={i.status} />
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {i.sentAt ? fmtDate(i.sentAt) : "-"}
                        {/*
                          An exported link was handed to an admin's mail merge, so
                          "sent" here means we lost sight of it, not that we
                          delivered it. A bounce lives in their outbox.
                        */}
                        {i.sentVia === "export" && (
                          <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-purple-100 text-purple-700 border border-purple-200">
                            exported
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {i.usedAt
                          ? `${fmtDate(i.usedAt)}${i.reviewKind ? ` (${i.reviewKind})` : ""}`
                          : "-"}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{fmtDate(i.expiresAt)}</td>
                      <td className="px-3 py-2 text-gray-600">{i.invitedBy || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
