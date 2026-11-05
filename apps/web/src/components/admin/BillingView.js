"use client";

/*
 * Admin billing review. Four queues and a test tool:
 *   To confirm   Unconfirmed charges. Confirming moves one to Pending and starts
 *                the landlord's 7 day review, so the lifecycle depends on this.
 *   Contested    charges a landlord contested, with their reason. Resolved to
 *                Approved or Voided with a written internal note; the landlord is
 *                emailed the outcome.
 *   Chargebacks  Stripe disputes, read-only (answered in the Stripe dashboard).
 *   Invoices     failed or overdue invoices, and ones whose leases were withdrawn:
 *                Retry payment, and Restore leases once settled.
 *   Corrections  refund or credit a wrong Paid charge (the charge is never edited).
 *   Change requests  landlords asking for different wording in the agreement:
 *                reply, accept (then upload their own version) or decline.
 *   Agreements and gate  record commission agreements by hand (sent, signed, void) and
 *                switch on the rules that stop a landlord publishing without a payment
 *                method or a signed agreement.
 *   Launch enrollment  the window existing landlords get to set up payments, and the
 *                notice email (test to yourself first, then send to those who need it).
 *   Billing run  dry run and live run of the monthly billing, and the switch that
 *                lets the first-Monday cron create real invoices.
 *   Test charge  makes a charge on a landlord account (never on production).
 *
 * Every action is recorded in the charge's history with the admin who took it.
 * Always shows this environment's own database: the dashboard's dev/prod switch
 * does not apply, because billing rows go with this environment's Stripe keys.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUrlTab } from "@/components/admin/adminShared";
import ChargeQueue from "@/components/admin/billing/ChargeQueue";
import NoteDialog from "@/components/admin/billing/NoteDialog";
import TestChargeForm from "@/components/admin/billing/TestChargeForm";
import BillingRunPanel from "@/components/admin/billing/BillingRunPanel";
import CorrectionsPanel from "@/components/admin/billing/CorrectionsPanel";
import AgreementsPanel from "@/components/admin/billing/AgreementsPanel";
import ChangeRequestsPanel from "@/components/admin/billing/ChangeRequestsPanel";
import EnrollmentPanel from "@/components/admin/billing/EnrollmentPanel";
import { ChargebackList, InvoiceList } from "@/components/admin/billing/ProblemLists";

const TAB_KEYS = ["confirm", "contest", "chargebacks", "invoices", "corrections", "agreements", "changes", "enrollment", "run", "test"];

async function call(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const post = (url, body) =>
  call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

const DIALOGS = {
  "resolve:approved": {
    title: "Uphold this charge?",
    description:
      "The charge stays and will be collected on the next billing run. The landlord is emailed the outcome (not your note).",
    confirmLabel: "Uphold charge",
  },
  "resolve:voided": {
    title: "Void this charge?",
    description: "The charge is removed and will not be collected. The landlord is emailed the outcome (not your note).",
    confirmLabel: "Void charge",
  },
  void: {
    title: "Void this charge?",
    description: "The charge is removed and will not be collected.",
    confirmLabel: "Void charge",
  },
};

function matches(search, ...values) {
  const q = (search || "").trim().toLowerCase();
  return !q || values.some((v) => String(v ?? "").toLowerCase().includes(q));
}

export default function BillingView({ search }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [urlTab, setTab] = useUrlTab(TAB_KEYS, "confirm");
  const [dialog, setDialog] = useState(null); // { key, charge, outcome? }
  const [changeCounts, setChangeCounts] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await call("/api/admin/billing/review"));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The Change requests badge: requests waiting on the team.
  useEffect(() => {
    call("/api/admin/billing/change-requests?summary=1")
      .then((r) => setChangeCounts(r.counts))
      .catch(() => {});
  }, []);

  const act = async (fn, successText) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (successText) setNotice(successText);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      await load();
    }
  };

  const confirm = (charge) =>
    act(() => post(`/api/admin/billing/charges/${charge.id}/confirm`), "Charge confirmed. The 7 day review has started.");

  const resendInvoice = (invoice) =>
    act(async () => {
      const r = await post(`/api/admin/billing/invoices/${invoice.id}/resend`);
      setNotice(`Invoice email sent to ${r.to}.`);
    }, null);

  const restoreLeases = (invoice) => {
    if (!window.confirm("Put this landlord's withdrawn leases back on the market? Only do this once the invoice is settled.")) return;
    return act(async () => {
      const r = await post(`/api/admin/billing/invoices/${invoice.id}/restore-leases`);
      setNotice(`Restored ${r.restored} of ${r.total} lease(s).`);
    }, null);
  };

  const submitNote = (note) => {
    const { key, charge, outcome } = dialog;
    const request =
      key === "resolve"
        ? post(`/api/admin/billing/charges/${charge.id}/resolve`, { outcome, note })
        : post(`/api/admin/billing/charges/${charge.id}/void`, { note });
    const text = key === "resolve" ? "Contest resolved. The landlord has been emailed." : "Charge voided.";
    setDialog(null);
    return act(() => request, text);
  };

  const filtered = useMemo(() => {
    if (!data) return null;
    const charge = (c) => matches(search, c.landlord.email, c.landlord.name, c.listingLabel, c.studentName, c.triggerLabel);
    const landlordOnly = (x) => matches(search, x.landlord.email, x.landlord.name);
    return {
      unconfirmed: data.unconfirmed.filter(charge),
      contested: data.contested.filter(charge),
      chargebacks: data.chargebacks.filter(landlordOnly),
      invoices: data.invoices.filter(landlordOnly),
    };
  }, [data, search]);

  if (!data && !error) return <div className="py-20 text-center text-sm text-gray-400">Loading billing...</div>;
  if (!data) return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  const tabs = [
    { key: "confirm", label: "To confirm", count: data.unconfirmed.length },
    { key: "contest", label: "Contested", count: data.contested.length },
    { key: "chargebacks", label: "Chargebacks", count: data.chargebacks.length },
    { key: "invoices", label: "Failed or overdue invoices", count: data.invoices.length },
    { key: "corrections", label: "Corrections" },
    { key: "agreements", label: "Landlords and agreements" },
    { key: "changes", label: "Change requests", count: changeCounts?.open ?? 0 },
    { key: "enrollment", label: "Launch enrollment" },
    { key: "run", label: "Billing run" },
    ...(data.testToolEnabled ? [{ key: "test", label: "Test charge" }] : []),
  ];

  // The test tool can be switched off, so a saved ?tab=test falls back.
  const tab = tabs.some((t) => t.key === urlTab) ? urlTab : "confirm";

  const dialogKey = dialog ? (dialog.key === "resolve" ? `resolve:${dialog.outcome}` : "void") : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
              tab === t.key ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tab === t.key ? "bg-white/20" : "bg-amber-100 text-amber-800"}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</div>}

      {tab === "confirm" && (
        <ChargeQueue
          mode="confirm"
          charges={filtered.unconfirmed}
          empty="No charges waiting to be confirmed."
          busy={busy}
          onConfirm={confirm}
          onVoid={(charge) => setDialog({ key: "void", charge })}
        />
      )}
      {tab === "contest" && (
        <ChargeQueue
          mode="contest"
          charges={filtered.contested}
          empty="No contested charges."
          busy={busy}
          onResolve={(charge, outcome) => setDialog({ key: "resolve", charge, outcome })}
        />
      )}
      {tab === "chargebacks" && <ChargebackList chargebacks={filtered.chargebacks} />}
      {tab === "invoices" && (
        <InvoiceList invoices={filtered.invoices} busy={busy} onResend={resendInvoice} onRestore={restoreLeases} />
      )}
      {tab === "corrections" && <CorrectionsPanel search={search} />}
      {tab === "agreements" && <AgreementsPanel search={search} />}
      {tab === "changes" && (
        <ChangeRequestsPanel search={search} onOpenAgreements={() => setTab("agreements")} onCountsChange={setChangeCounts} />
      )}
      {tab === "enrollment" && <EnrollmentPanel />}
      {tab === "run" && <BillingRunPanel />}
      {tab === "test" && <TestChargeForm onCreated={load} />}

      {dialog && (
        <NoteDialog
          {...DIALOGS[dialogKey]}
          busy={busy}
          onCancel={() => setDialog(null)}
          onSubmit={submitNote}
        />
      )}
    </div>
  );
}
