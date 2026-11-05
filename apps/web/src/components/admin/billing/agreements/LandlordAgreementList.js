"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, fmtDate } from "@/components/admin/adminShared";
import { formatCents } from "@/lib/billing/money";
import { BUTTON, call, openFile, postJson } from "./shared";
import AdminAutopayLine from "../AdminAutopayLine";

const FILTERS = [
  ["all", "All"],
  ["live", "Has a live listing"],
  ["unsigned", "Not signed"],
  ["needs_resign", "Needs to re-sign"],
  ["in_progress", "Signing started"],
  ["no_method", "No usable payment method"],
  ["blocked", "Cannot publish"],
  ["uncovered", "Live leases not under agreement"],
  ["review", "Needs review"],
];

const AGREEMENT = {
  signed: ["green", "Signed"],
  needs_resign: ["amber", "Needs to re-sign"],
  expired: ["amber", "Term ended"],
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

const rate = (r) => (r == null ? null : `${Number(r).toLocaleString("en-US", { maximumFractionDigits: 3 })}%`);

function AgreementDetail({ a }) {
  if (a.status === "signed" || a.status === "needs_resign" || a.status === "expired") {
    return (
      <span>
        Signed {fmtDate(a.signedAt)}
        {a.signerName ? ` by ${a.signerName}` : ""}
        {a.signerTitle ? `, ${a.signerTitle}` : ""}
        {a.signedVersionLabel ? ` · ${a.signedVersionLabel}` : ""}
        {a.negotiated ? " (negotiated)" : ""}
        {a.commissionRatePercent != null ? ` · ${rate(a.commissionRatePercent)}` : ""}
        {a.termEnd ? ` · term ends ${fmtDate(a.termEnd)}` : ""}
        {a.signedBy === "admin" ? " · recorded by an admin" : ""}
      </span>
    );
  }
  if (a.status === "in_progress") return <span>Opened the agreement {fmtDate(a.pendingSince)}, not finished</span>;
  if (a.lastEndedReason) return <span>Last attempt: {a.lastEndedReason}</span>;
  return <span>Has not started</span>;
}

// One landlord's documents: every master and amendment, with what each covered and its files.
const VOIDABLE = ["signed", "sent", "not_sent"];

function DocumentHistory({ landlordId, landlordName, busy, run }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    call(`/api/admin/billing/landlords/${landlordId}/documents`)
      .then((d) => setDocs(d.documents))
      .catch((e) => setError(e.message));
  }, [landlordId, tick]);
  const voidDoc = (d) => {
    const what = d.kind === "amendment" ? "this Exhibit A amendment" : "this commission agreement";
    const effect =
      d.status === "signed"
        ? d.kind === "amendment"
          ? "The properties it added stop being covered."
          : "Every property on its Exhibit A stops being covered, and the landlord has to sign again before publishing new properties while the agreement requirement is on."
        : "The copy waiting in Documenso is cancelled.";
    if (!window.confirm(`Void ${what} for ${landlordName}?\n\n${effect} The signed PDFs are kept. This cannot be undone.`)) return;
    return run(async () => {
      const r = await postJson(`/api/admin/billing/landlords/${landlordId}/documents`, { action: "void", kind: d.kind, id: d.id });
      setTick((t) => t + 1);
      return `Voided${r.released ? `. ${r.released} ${r.released === 1 ? "property is" : "properties are"} no longer covered.` : "."}`;
    });
  };
  if (error) return <p className="text-xs text-red-700">{error}</p>;
  if (!docs) return <p className="text-xs text-gray-400">Loading documents...</p>;
  if (!docs.length) return <p className="text-xs text-gray-500">No agreement documents yet.</p>;
  const open = (d, part) =>
    run(() => openFile(`/api/admin/billing/landlords/${landlordId}/documents/file?${new URLSearchParams({ kind: d.kind, id: d.id, part })}`));
  return (
    <ul className="space-y-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700">
      {docs.map((d) => {
        const before = new Set((d.previous ?? []).map((e) => e.listingId));
        const added = d.kind === "amendment" ? d.properties.filter((e) => !before.has(e.listingId)) : [];
        return (
          <li key={`${d.kind}:${d.id}`} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 font-medium text-gray-900">
                {d.kind === "amendment" ? "Exhibit A amendment" : "Master agreement"}
                {d.versionLabel ? ` · ${d.versionLabel}` : ""}
                {d.negotiated ? " (negotiated)" : ""} · {d.status}
                {d.signedAt ? ` ${fmtDate(d.signedAt)}` : ` (made ${fmtDate(d.createdAt)})`}
                {d.endedReason ? ` · ${d.endedReason}` : ""}
              </span>
              {d.hasSignedFile && (
                <button type="button" disabled={busy} className={BUTTON} onClick={() => open(d, "agreement")}>
                  {d.kind === "amendment" ? "Amendment" : "Agreement"}
                </button>
              )}
              {d.hasSignedExhibit && (
                <button type="button" disabled={busy} className={BUTTON} onClick={() => open(d, "exhibit")}>
                  Exhibit A
                </button>
              )}
              {VOIDABLE.includes(d.status) && (
                <button type="button" disabled={busy} className={`${BUTTON} text-red-700`} onClick={() => voidDoc(d)}>
                  Void
                </button>
              )}
            </div>
            <p className="text-gray-600">
              {d.kind === "amendment"
                ? `Adds ${added.map((e) => e.address).join("; ") || "nothing"} (${d.previous.length} before, ${d.properties.length} after)`
                : `Exhibit A: ${d.properties.map((e) => e.address).join("; ") || "no properties"}`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

// Real estate license disclosure: the current answer (row.license) on the row.
function LicenseLine({ license }) {
  if (!license) return <p>License: not answered yet (asked right before signing).</p>;
  if (!license.isLicensee) return <p>License: not a licensee (confirmed {fmtDate(license.confirmedAt)}).</p>;
  return (
    <p>
      License: {license.agentName}, {license.companyName}, {license.companyPhone} · MO #{license.licenseNumber} · owner listing
      agreement confirmed {fmtDate(license.confirmedAt)}
    </p>
  );
}

// Every license answer they have given, newest first.
function LicenseHistory({ landlordId }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    call(`/api/admin/billing/landlords/${landlordId}/license-disclosure`)
      .then((d) => setRows(d.history))
      .catch((e) => setError(e.message));
  }, [landlordId]);
  if (error) return <p className="text-xs text-red-700">{error}</p>;
  if (!rows) return <p className="text-xs text-gray-400">Loading license history...</p>;
  if (!rows.length) return <p className="text-xs text-gray-500">No license answers yet.</p>;
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700">
      <p className="font-medium text-gray-900">License disclosure history</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((r, i) => (
          <li key={`${r.createdAt}-${i}`}>
            {fmtDate(r.createdAt)} · {r.source === "signing" ? "before signing" : "from Profile"} ·{" "}
            {r.isLicensee ? `${r.agentName}, ${r.companyName}, ${r.companyPhone}, MO #${r.licenseNumber}` : "not a licensee"}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CoverageDetail({ c, a }) {
  if (!c) return null;
  return (
    <div className="space-y-1 text-xs text-gray-600">
      <p>
        {c.liveProperties} live {c.liveProperties === 1 ? "property" : "properties"}, {c.coveredCount} covered
        {a.amendmentPendingSince ? ` · amendment started ${fmtDate(a.amendmentPendingSince)}` : ""}
      </p>
      {c.uncovered.length > 0 && (
        <div className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">
          Not under agreement:
          <ul className="ml-4 list-disc">
            {c.uncovered.map((p) => (
              <li key={p.listingId}>
                {p.address} · {p.offerings} live {p.offerings === 1 ? "lease" : "leases"}
                {p.units?.length ? ` (${p.units.join(", ")})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.addressChanged.length > 0 && (
        <div className="rounded-md bg-blue-50 px-2 py-1 text-blue-900">
          Address changed since signing:
          <ul className="ml-4 list-disc">
            {c.addressChanged.map((p) => (
              <li key={p.listingId}>
                {p.signedAddress}, now {p.currentAddress}
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.flaggedForReview && (
        <p className="rounded-md bg-blue-50 px-2 py-1 text-blue-900">
          On a negotiated version. A newer standard version asked everyone to sign again: review whether theirs needs updating.
        </p>
      )}
    </div>
  );
}

function LandlordRow({ row, busy, run, canEmail }) {
  const [showDocs, setShowDocs] = useState(false);
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
        {row.coverage?.uncovered?.length > 0 && <Badge color="amber">{row.coverage.uncoveredOfferings} uncovered</Badge>}
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
          <AdminAutopayLine key={row.autopay?.authorizedAt ?? "off"} landlordId={row.id} autopay={row.autopay ?? null} />
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

      <div className="text-xs text-gray-600">
        <LicenseLine license={row.license} />
      </div>

      <CoverageDetail c={row.coverage} a={row.agreement} />

      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} onClick={() => setShowDocs((s) => !s)}>
          {showDocs ? "Hide documents" : "Documents"}
        </button>
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
      {showDocs && (
        <>
          <DocumentHistory landlordId={row.id} landlordName={row.name || row.email || "this landlord"} busy={busy} run={run} />
          <LicenseHistory landlordId={row.id} />
        </>
      )}
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

      {data?.uncoveredOfferingsTotal > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {data.uncoveredOfferingsTotal} live {data.uncoveredOfferingsTotal === 1 ? "lease is" : "leases are"} on a property the
          landlord&apos;s agreement does not cover. They stay up; the &quot;Live leases not under agreement&quot; filter lists them.
        </p>
      )}

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
