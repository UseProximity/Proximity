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
 *   Create charge  puts a real charge on one landlord's account (production too):
 *                its 7 day review starts and the landlord is emailed.
 *   Test charge  makes a flagged test charge (never on production).
 *
 * The page is grouped into four sections, each with its own sub-tabs (Wyatt,
 * 2026-11-14): Charges, Invoices and payments, Landlords and agreements, Setup.
 * The history lists (charge history, Stripe events, autopay, signer requests,
 * license disclosures) come from lib/admin/lists.js and sit in the section
 * they belong to. The open sub-tab lives in ?tab=, with the same keys as
 * before, so links in team emails still land in the right place.
 *
 * Every action is recorded in the charge's history with the admin who took it.
 * Follows the dashboard's dev/prod switch (Wyatt, 2026-11-06): agreement versions,
 * coverage, charges and invoices are that database's. Billing goes with this
 * site's Stripe and Documenso keys, so the other environment is read-only here
 * (lib/billing/adminDb.js); a banner says so.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUrlTab } from "@/components/admin/adminShared";
import ChargeQueue from "@/components/admin/billing/ChargeQueue";
import NoteDialog from "@/components/admin/billing/NoteDialog";
import TestChargeForm from "@/components/admin/billing/TestChargeForm";
import CreateChargeForm from "@/components/admin/billing/CreateChargeForm";
import BillingRunPanel from "@/components/admin/billing/BillingRunPanel";
import CorrectionsPanel from "@/components/admin/billing/CorrectionsPanel";
import AgreementsPanel from "@/components/admin/billing/AgreementsPanel";
import ChangeRequestsPanel from "@/components/admin/billing/ChangeRequestsPanel";
import EnrollmentPanel from "@/components/admin/billing/EnrollmentPanel";
import { ChargebackList, InvoiceList } from "@/components/admin/billing/ProblemLists";
import { billingFetch, setBillingTarget } from "@/components/admin/billing/billingFetch";
import ListPage from "@/components/admin/lists/ListPage";
import BillingOverview from "@/components/admin/billing/BillingOverview";

// Sub-tabs that are a plain list from lib/admin/lists.js (the key is the list's name).
// "charges" and "all-invoices" are the full lists; the rest are history.
const LIST_TABS = new Set(["charges", "all-invoices", "charge-history", "stripe-events", "payer-requests", "autopay-history", "license-history"]);
const LIST_NAMES = { "all-invoices": "invoices" };
const TAB_KEYS = ["overview", "confirm", "create", "contest", "chargebacks", "invoices", "corrections", "agreements", "versions", "rules", "changes", "enrollment", "run", "test", ...LIST_TABS];

async function call(url, options) {
  const res = await billingFetch(url, options);
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

export default function BillingView({ search, dbTarget = null }) {
  // Every billing request from here on carries the switch (billingFetch). The
  // dashboard remounts this view when the switch changes.
  setBillingTarget(dbTarget);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [urlTab, setTab] = useUrlTab(TAB_KEYS, "overview");
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
      setNotice(
        `Restored ${r.restored} of ${r.total} lease(s).${r.stillHeld ? ` ${r.stillHeld} stay withdrawn: another overdue invoice of this landlord is still unpaid.` : ""}`
      );
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

  const writable = data.env?.writable !== false;
  const sections = [
    { key: "overview", label: "Overview", note: null, tabs: [{ key: "overview", label: "Overview" }] },
    {
      key: "charges",
      label: "Charges",
      note: "Commission charges, from the moment one is created to the day it is paid.",
      tabs: [
        { key: "confirm", label: "To confirm", count: data.unconfirmed.length },
        { key: "contest", label: "Contested", count: data.contested.length },
        { key: "charges", label: "All charges" },
        ...(writable ? [{ key: "create", label: "Create a charge" }] : []),
        { key: "corrections", label: "Refunds and credits" },
        { key: "charge-history", label: "Step by step history" },
        ...(data.testToolEnabled ? [{ key: "test", label: "Test charge" }] : []),
      ],
    },
    {
      key: "invoices",
      label: "Invoices and payments",
      note: "The monthly billing run and what happened to the money afterwards.",
      tabs: [
        { key: "invoices", label: "Failed or overdue", count: data.invoices.length },
        { key: "chargebacks", label: "Chargebacks", count: data.chargebacks.length },
        { key: "all-invoices", label: "All invoices" },
        { key: "run", label: "Billing run" },
        { key: "autopay-history", label: "Autopay" },
        { key: "stripe-events", label: "Stripe events" },
      ],
    },
    {
      key: "landlords",
      label: "Landlords and agreements",
      note: "Who has signed, who can publish, and the agreement itself.",
      tabs: [
        { key: "agreements", label: "Landlords" },
        { key: "changes", label: "Change requests", count: changeCounts?.open ?? 0 },
        { key: "versions", label: "Agreement versions" },
        { key: "payer-requests", label: "Waiting on a signer" },
        { key: "license-history", label: "License disclosures" },
      ],
    },
    {
      key: "setup",
      label: "Setup",
      note: "The rules for publishing and the launch email to existing landlords.",
      tabs: [
        { key: "rules", label: "Publishing rules" },
        { key: "enrollment", label: "Launch enrollment" },
      ],
    },
  ];

  // The test tool and Create can be switched off, so a saved ?tab= falls back.
  const tab = sections.some((sec) => sec.tabs.some((t) => t.key === urlTab)) ? urlTab : "overview";
  const section = sections.find((sec) => sec.tabs.some((t) => t.key === tab));
  const waiting = (sec) => sec.tabs.reduce((n, t) => n + (t.count > 0 ? t.count : 0), 0);

  const dialogKey = dialog ? (dialog.key === "resolve" ? `resolve:${dialog.outcome}` : "void") : null;

  const env = data?.env;
  return (
    <div className="space-y-4">
      {env && !env.writable && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Showing <strong>{env.target === "prod" ? "production" : "dev"}</strong> billing, read only. This site runs on{" "}
          {env.own === "prod" ? "production" : "dev"} Stripe and Documenso keys, so changes to {env.target === "prod" ? "production" : "dev"} billing
          are made on {env.target === "prod" ? "useproximity.org" : "staging or a local copy"}.
        </div>
      )}
      {/* Sections */}
      <div className="flex flex-wrap gap-2">
        {sections.map((sec) => (
          <button
            key={sec.key}
            type="button"
            onClick={() => setTab(sec.tabs[0].key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
              section.key === sec.key ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {sec.label}
            {waiting(sec) > 0 && (
              <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${section.key === sec.key ? "bg-white/20" : "bg-amber-100 text-amber-800"}`}>
                {waiting(sec)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* The open section's sub-tabs */}
      <div className={section.tabs.length > 1 ? "" : "hidden"}>
        <p className="mb-2 text-sm text-gray-500">{section.note}</p>
        <div className="flex flex-wrap gap-1 border-b border-gray-200">
          {section.tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-gray-900 font-semibold text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"}`}
            >
              {t.label}
              {t.count > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{t.count}</span>}
            </button>
          ))}
        </div>
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
      {tab === "agreements" && <AgreementsPanel search={search} part="landlords" />}
      {tab === "versions" && <AgreementsPanel search={search} part="versions" />}
      {tab === "rules" && <AgreementsPanel search={search} part="rules" />}
      {tab === "overview" && (
        <BillingOverview
          queues={{ confirm: data.unconfirmed.length, contest: data.contested.length, invoices: data.invoices.length, chargebacks: data.chargebacks.length, changes: changeCounts?.open ?? 0 }}
          onOpen={setTab}
        />
      )}
      {LIST_TABS.has(tab) && <ListPage key={tab} name={LIST_NAMES[tab] ?? tab} dbTarget={dbTarget ?? "dev"} isProd={dbTarget === "prod"} search={search} />}
      {tab === "changes" && (
        <ChangeRequestsPanel search={search} onOpenAgreements={() => setTab("versions")} onCountsChange={setChangeCounts} />
      )}
      {tab === "enrollment" && <EnrollmentPanel />}
      {tab === "run" && <BillingRunPanel />}
      {tab === "create" && <CreateChargeForm onCreated={load} />}
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
