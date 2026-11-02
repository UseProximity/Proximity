"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, fmtDate } from "@/components/admin/adminShared";
import { formatCents } from "@/lib/billing/money";
import { BUTTON, call, openFile, postJson } from "./shared";

const FILTERS = [
  ["all", "All"],
  ["live", "Has a live listing"],
  ["unsigned", "Not signed"],
  ["needs_resign", "Needs to re-sign"],
  ["in_progress", "Signing started"],
  ["no_method", "No usable payment method"],
  ["blocked", "Cannot publish"],
];

const AGREEMENT = {
  signed: ["green", "Signed"],
  needs_resign: ["amber", "Needs to re-sign"],
  in_progress: ["blue", "Signing started"],
  not_signed: ["gray", "Not signed"],
};

const PAYMENT = {
  active: ["green", "Payment method active"],
  verifying: ["blue", "Bank verifying"],
  attention: ["red", "Payment method failed or expired"],
  none: ["gray", "No payment method"],
};

const MISSING = {
  payment_method: "payment method",
  agreement: "agreement",
  overdue_invoice: "overdue invoice",
};

function AgreementDetail({ a }) {
  if (a.status === "signed" || a.status === "needs_resign") {
    return (
      <span>
        Signed {fmtDate(a.signedAt)}
        {a.signerName ? ` by ${a.signerName}` : ""}
        {a.signerTitle ? `, ${a.signerTitle}` : ""}
        {a.signedVersionLabel ? ` · ${a.signedVersionLabel}` : ""}
        {a.signedBy === "admin" ? " · recorded by an admin" : ""}
      </span>
    );
  }
  if (a.status === "in_progress") return <span>Opened the agreement {fmtDate(a.pendingSince)}, not finished</span>;
  if (a.lastEndedReason) return <span>Last attempt: {a.lastEndedReason}</span>;
  return <span>Has not started</span>;
}

function LandlordRow({ row, busy, run, canEmail }) {
  const [agColor, agLabel] = AGREEMENT[row.agreement.status] ?? AGREEMENT.not_signed;
  const [payColor, payLabel] = PAYMENT[row.payment.state] ?? PAYMENT.none;

  const email = () => {
    if (!window.confirm(`Email ${row.email} a link to sign the commission agreement, with the PDF attached?`)) return;
    return run(() => postJson("/api/admin/billing/landlords/agreement-email", { landlordId: row.id }), `Emailed ${row.email}.`);
  };

  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-900">
            {row.name || "Unnamed landlord"}
            {row.email && <span className="text-xs text-gray-400"> ({row.email})</span>}
          </p>
          <p className="text-xs text-gray-500">
            <AgreementDetail a={row.agreement} />
          </p>
        </div>
        {row.hasLiveListing ? <Badge color="purple">Live listing</Badge> : <Badge>Nothing live</Badge>}
        <Badge color={agColor}>{agLabel}</Badge>
        <Badge color={payColor}>{payLabel}</Badge>
        {row.publishing.allowed ? (
          <Badge color="green">Can publish</Badge>
        ) : (
          <Badge color="red" title="What stops them publishing">
            Blocked: {row.publishing.missing.map((m) => MISSING[m] ?? m).join(", ")}
          </Badge>
        )}
      </div>

      <div className="grid gap-1 text-xs text-gray-600 sm:grid-cols-2">
        <div>
          {row.payment.methods.length === 0
            ? "No payment methods saved."
            : row.payment.methods.map((m) => (
                <p key={`${m.description}-${m.isDefault}`}>
                  {m.description}
                  {m.isDefault ? " (default)" : ""} · {m.status}
                </p>
              ))}
        </div>
        <div>
          {row.invoices.unpaidCount === 0 ? (
            <p>No unpaid invoices.</p>
          ) : (
            <p>
              {row.invoices.unpaidCount} unpaid invoice(s), {formatCents(row.invoices.unpaidCents)}
              {row.invoices.failedCount ? ` · ${row.invoices.failedCount} failed` : ""}
              {row.invoices.overdue ? " · overdue, leases withdrawn" : ""}
            </p>
          )}
          <p>
            {row.lastAgreementEmailAt
              ? `Signing email sent ${fmtDate(row.lastAgreementEmailAt)}${row.lastAgreementEmailStatus && row.lastAgreementEmailStatus !== "sent" ? ` (${row.lastAgreementEmailStatus})` : ""}`
              : "Never emailed the agreement"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {row.agreement.signedAgreementId && (
          <button
            type="button"
            disabled={busy}
            className={BUTTON}
            onClick={() => run(() => openFile(`/api/admin/billing/agreements/${row.agreement.signedAgreementId}/file`))}
          >
            View signed agreement
          </button>
        )}
        {row.agreement.status !== "signed" && row.email && (
          <button type="button" disabled={busy || !canEmail} className={BUTTON} onClick={email} title={canEmail ? "" : "Make a version live first"}>
            {row.lastAgreementEmailAt ? "Resend signing email" : "Email signing link"}
          </button>
        )}
      </div>
    </li>
  );
}

/*
 * Every landlord: their commission agreement, payment methods, unpaid invoices and
 * whether they can publish, with the signing email to send or resend.
 */
export default function LandlordAgreementList({ search, busy, run, reloadKey }) {
  const [filter, setFilter] = useState("live");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ filter, search: search || "" });
      setData(await call(`/api/admin/billing/landlords?${params}`));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [filter, search]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const canEmail = !!data?.liveVersion;

  const emailAll = () => {
    const n = data.bulkAudienceCount;
    if (!window.confirm(`Email ${n} landlord(s) with a live listing who have not signed (and were not emailed in the last 3 days) a link to sign, with the PDF attached?`)) return;
    return run(async () => {
      const r = await postJson("/api/admin/billing/landlords/agreement-email", { all: true, confirm: true });
      return `Sent ${r.sent} of ${r.attempted}${r.failed ? `, ${r.failed} failed` : ""}${r.remaining ? `. ${r.remaining} left: send again to continue.` : "."}`;
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-sm font-semibold text-gray-900">Landlords</h3>
        <button
          type="button"
          disabled={busy || !canEmail || !data?.bulkAudienceCount}
          className={BUTTON}
          onClick={emailAll}
          title={canEmail ? "" : "Make a version live first"}
        >
          Email everyone who has not signed ({data?.bulkAudienceCount ?? 0})
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
              filter === key ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {label} {data?.counts?.[key] != null && <span className="opacity-70">{data.counts[key]}</span>}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {!data && !error && <p className="py-6 text-center text-sm text-gray-400">Loading landlords...</p>}
      {data && data.rows.length === 0 && (
        <p className="rounded-lg border border-gray-100 bg-white px-4 py-6 text-sm text-gray-500">No landlords match.</p>
      )}
      {data && data.rows.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
          {data.rows.map((row) => (
            <LandlordRow key={row.id} row={row} busy={busy} run={run} canEmail={canEmail} />
          ))}
        </ul>
      )}
    </section>
  );
}
