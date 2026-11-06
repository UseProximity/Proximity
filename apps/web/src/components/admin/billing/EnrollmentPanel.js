"use client";

import { useCallback, useEffect, useState } from "react";
import { billingFetch } from "@/components/admin/billing/billingFetch";

async function call(url, options) {
  const res = await billingFetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const FIELD = "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500";

/*
 * Launch enrollment. Existing landlords are told that fees are now collected in
 * the app and given a window to add a payment method (and, once the agreement is
 * ready, sign it). Set the window, check the wording with a test email to
 * yourself, then send. Only landlords with something live who have not set up and
 * were not already emailed are included, so pressing Send twice does not email
 * anyone twice. When the deadline arrives the listing requirements switch on by
 * themselves (the daily billing cron): a payment method, and the agreement when
 * it was part of the ask. Live listings stay up.
 */
export default function EnrollmentPanel() {
  const [data, setData] = useState(null);
  const [deadline, setDeadline] = useState("");
  const [includeAgreement, setIncludeAgreement] = useState(false);
  const [again, setAgain] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await call("/api/admin/billing/enrollment");
      setData(d);
      setDeadline(d.deadline ?? "");
      setIncludeAgreement(d.includeAgreement);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await call("/api/admin/billing/enrollment", json("PUT", { deadline: deadline || null, includeAgreement }));
      await load();
      setNotice("Window saved.");
    });

  const sendTest = () =>
    run(async () => {
      const r = await call("/api/admin/billing/enrollment/send", json("POST", { mode: "test" }));
      setNotice(r.sent ? `Test email sent to ${r.to}.` : "The test email was not sent (email is not configured here, or it failed).");
    });

  const sendAll = () => {
    const n = data.counts.toSend;
    if (!window.confirm(`Email ${n} landlord${n === 1 ? "" : "s"} now?\n\nThis sends real email on production. Use "Send test to me" first to check the wording.`)) return;
    return run(async () => {
      const r = await call("/api/admin/billing/enrollment/send", json("POST", { mode: "all", confirm: true, includeAlreadyEmailed: again }));
      await load();
      setNotice(`Sent ${r.sent} of ${r.attempted}${r.failed ? ` (${r.failed} failed)` : ""}.${r.remaining ? ` ${r.remaining} remain: send again to continue.` : ""}`);
    });
  };

  if (!data && !error) return <p className="py-10 text-center text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-4 max-w-2xl">
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</div>}

      {data && (
        <>
          <div className="rounded-lg border border-gray-100 bg-white p-4 space-y-3">
            <p className="text-sm font-medium text-gray-900">Enrollment window</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-sm font-medium text-gray-700">
                Deadline
                <input className={`${FIELD} mt-1 block`} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={save}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-60"
              >
                Save
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={includeAgreement} onChange={(e) => setIncludeAgreement(e.target.checked)} />
              Also ask them to sign the commission agreement (tick once the agreement is ready)
            </label>
            <p className="text-xs text-gray-500">
              The deadline is in the email and shown as a banner on each landlord&apos;s Payments tab until they have set up.
              On the deadline, publishing requires a payment method (and a signed agreement, if ticked) automatically.
              Listings already live stay up.
            </p>
          </div>

          <div className="rounded-lg border border-gray-100 bg-white p-4 space-y-3">
            <p className="text-sm font-medium text-gray-900">Who would be emailed</p>
            <ul className="text-sm text-gray-700 space-y-0.5">
              <li>{data.counts.landlords} landlord accounts</li>
              <li>{data.counts.withLiveListing} have something live on the site</li>
              <li>{data.counts.alreadySetUp} of those are already set up</li>
              <li>{data.counts.alreadyEmailed} have already been emailed</li>
              <li className="font-semibold text-gray-900">{data.counts.toSend} would be emailed now</li>
            </ul>
            {data.sample.length > 0 && (
              <p className="text-xs text-gray-500">
                For example: {data.sample.map((s) => s.name || s.email).join(", ")}
                {data.counts.toSend > data.sample.length ? ", and others" : ""}.
              </p>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />
              Also email landlords who were already emailed (a reminder)
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={sendTest}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Send test to me
              </button>
              <button
                type="button"
                disabled={busy || data.counts.toSend === 0 || !data.deadline}
                onClick={sendAll}
                title={!data.deadline ? "Save a deadline first" : undefined}
                className="px-4 py-2 rounded-lg border border-red-300 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Email {data.counts.toSend} landlord{data.counts.toSend === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
