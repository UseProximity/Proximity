"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import PaymentMethodsCard from "./PaymentMethodsCard";
import ChargesCard from "./ChargesCard";
import InvoicesCard from "./InvoicesCard";
import AutopayCard from "./AutopayCard";
import AgreementCard, { PublishChecklist } from "./AgreementCard";
import ChangeRequestPanel from "./ChangeRequestPanel";
import ContestChargeModal from "./ContestChargeModal";
import { PaidForAccounts, PayerCard } from "./PayerCards";

const NOTICES = {
  success: { tone: "green", text: "Payment method saved." },
  cancelled: { tone: "gray", text: "Payment method setup was cancelled. Nothing was changed." },
};

async function call(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");
  return body;
}

/*
 * The landlord's payments page, top to bottom: the commission agreement (signed
 * here, through Documenso) with the checklist of what is needed to publish, the
 * payment method (both fold away once done), balance and charges (with Approve
 * and Contest), monthly invoices (with Pay now) and autopay. Emails link to
 * #marketing-agreement.
 *
 * Coming back from Stripe Checkout lands here with ?setup=success&session_id=...
 * (or ?setup=cancelled). The session is synced straight away so the new method
 * is on screen, then the parameters are dropped so a reload does not repeat it.
 */
export default function PaymentsSection() {
  const [methods, setMethods] = useState([]);
  const [charges, setCharges] = useState([]);
  const [requestsKey, setRequestsKey] = useState(0);
  const [invoices, setInvoices] = useState([]);
  const [gate, setGate] = useState(null);
  // Project B: this account's payer (status only), and the accounts this user pays for.
  const [payer, setPayer] = useState(null);
  const [payees, setPayees] = useState([]);
  const [billedTo, setBilledTo] = useState(null);
  const [summary, setSummary] = useState({ balanceCents: 0, inReviewCents: 0 });
  const [contesting, setContesting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // Pay now: the invoice being paid (its button spins), and each invoice's last
  // result, shown on the invoice itself rather than at the top of the page,
  // which is off screen by the time the Invoices card is reached (Simão, 2026-11-07).
  const [payingId, setPayingId] = useState(null);
  const [payResults, setPayResults] = useState({});
  const handledReturn = useRef(false);

  const load = useCallback(async () => {
    const [m, c, i, g, p, a] = await Promise.all([
      call("/api/billing/payment-methods"),
      call("/api/billing/charges"),
      call("/api/billing/invoices"),
      call("/api/billing/gate"),
      call("/api/billing/payer"),
      call("/api/billing/payees"),
    ]);
    setMethods(m.methods);
    setCharges(c.charges);
    setSummary(c.summary);
    setBilledTo(c.billedTo ?? null);
    setInvoices(i.invoices);
    setGate(g);
    setPayer(p.payer ?? null);
    setPayees(a.accounts ?? []);
  }, []);

  useEffect(() => {
    if (handledReturn.current) return;
    handledReturn.current = true;

    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const setup = params.get("setup");
        const sessionId = params.get("session_id");
        if (setup) window.history.replaceState(null, "", "?tab=billing");

        if (setup === "success" && sessionId) {
          const result = await call("/api/billing/payment-methods/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
          setNotice(result.skipped ? null : NOTICES.success);
        } else if (NOTICES[setup]) {
          setNotice(NOTICES[setup]);
        }
        await load();
      } catch (e) {
        setError(e.message);
        await load().catch(() => {});
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  // An action's outcome is a toast, seen wherever the landlord has scrolled to.
  // The banner at the top is kept for what greets them on arrival (back from Stripe, a load failure).
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const add = (type) =>
    run(async () => {
      const { url } = await call("/api/billing/payment-methods/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      window.location.href = url;
    });

  const setDefault = (id) =>
    run(async () => {
      await call(`/api/billing/payment-methods/${id}/default`, { method: "POST" });
      await load();
    });

  const remove = (method) => {
    const only = methods.length === 1;
    const message = only
      ? `Remove ${method.description}? It is your only payment method, so your invoices will have nothing to charge until you add another.`
      : `Remove ${method.description}?`;
    if (!window.confirm(message)) return;
    run(async () => {
      await call(`/api/billing/payment-methods/${method.id}`, { method: "DELETE" });
      await load();
    });
  };

  const approve = (charge) =>
    run(async () => {
      await call(`/api/billing/charges/${charge.id}/approve`, { method: "POST" });
      await load();
      toast.success("Charge approved. It will be on your next monthly invoice.");
    });

  const contest = (reason) =>
    run(async () => {
      try {
        await call(`/api/billing/charges/${contesting.id}/contest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
      } finally {
        setContesting(null);
        await load().catch(() => {});
      }
      toast.success("Charge contested. We will email you the outcome.");
    });

  const PAID_TEXT = {
    paid: "Paid. Thank you. A receipt is on its way to your email.",
    processing: "Payment started. Bank payments take a few business days to clear, and the invoice shows Processing until then.",
    started: "Payment started. This invoice will update in a moment.",
    alreadyPaid: "This invoice is already paid.",
  };

  const payInvoice = async (invoice) => {
    setBusy(true);
    setPayingId(invoice.id);
    setPayResults((r) => ({ ...r, [invoice.id]: null }));
    try {
      const result = await call(`/api/billing/invoices/${invoice.id}/pay`, { method: "POST" });
      const key = result.paid ? "paid" : result.processing ? "processing" : result.alreadyPaid ? "alreadyPaid" : "started";
      setPayResults((r) => ({ ...r, [invoice.id]: { tone: "green", text: PAID_TEXT[key] } }));
      toast.success(key === "paid" ? "Payment received. Thank you." : PAID_TEXT[key]);
    } catch (e) {
      setPayResults((r) => ({ ...r, [invoice.id]: { tone: "red", text: e.message } }));
      toast.error(e.message);
    } finally {
      // A decline still changes the invoice (its reason), so always show the latest.
      await load().catch(() => {});
      setPayingId(null);
      setBusy(false);
    }
  };

  // The signing email links to #marketing-agreement (#commission-agreement in emails
  // sent before 2026-11-07); the card only exists once loaded.
  const scrolledToAgreement = useRef(false);
  useEffect(() => {
    if (!gate || scrolledToAgreement.current || !["#marketing-agreement", "#commission-agreement"].includes(window.location.hash)) return;
    scrolledToAgreement.current = true;
    document.getElementById("marketing-agreement")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [gate]);

  // After the signing dialog: refresh, and say where things stand.
  const agreementChanged = (result) => {
    // A rejection may have opened a change request: show it.
    setRequestsKey((k) => k + 1);
    if (result === "signed") toast.success("Thank you. It is signed, and the properties on it are covered.");
    else if (result === "pending") toast.success("Signed. Your copy is being saved and will appear here in a minute.");
    else if (result === "nothing") toast("Nothing needs signing right now. Your properties are covered.");
    load().catch((e) => toast.error(e.message));
  };

  if (loading) return <p className="text-sm text-gray-500">Loading payments...</p>;

  // Someone else signs and pays for this account (Project B, Wyatt 2026-11-09):
  // the agreement's status and the charges, nothing else.
  if (payer) {
    return (
      <div className="space-y-4 max-w-3xl">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <PayerCard view={payer} onChanged={(next) => (next ? setPayer(next) : load().catch(() => {}))} />
        <ChargesCard charges={charges} summary={summary} busy={busy} onApprove={approve} onContest={setContesting} billedTo={billedTo ?? payer.payer.name} />
        {contesting && <ContestChargeModal charge={contesting} busy={busy} onCancel={() => setContesting(null)} onSubmit={contest} />}
      </div>
    );
  }

  const paidFor = payees.length ? (
    <PaidForAccounts
      accounts={payees}
      hasPaymentMethod={!gate?.requirePaymentMethod || methods.some((m) => m.status === "active")}
      onChanged={(result) => agreementChanged(result ?? "refresh")}
    />
  ) : null;

  return (
    <div className="space-y-4 max-w-3xl">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {notice && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            notice.tone === "green" ? "bg-green-50 text-green-800" : "bg-gray-100 text-gray-700"
          }`}
        >
          {notice.text}
        </div>
      )}
      {gate && !gate.billingOnly && <PublishChecklist gate={gate} hasActivePaymentMethod={methods.some((m) => m.status === "active")} />}
      {gate?.agreement && (
        <AgreementCard
          gate={gate}
          hasActivePaymentMethod={methods.some((m) => m.status === "active")}
          onChanged={agreementChanged}
          busy={busy}
          billingOnly={!!gate.billingOnly}
          paidFor={paidFor}
          changeRequests={
            <ChangeRequestPanel
              key={requestsKey}
              documentKind={gate.agreement?.amendment ? "amendment" : "master"}
              amendmentId={gate.agreement?.amendment?.id ?? undefined}
            />
          }
        />
      )}
      <PaymentMethodsCard
        methods={methods}
        busy={busy}
        onAdd={add}
        onSetDefault={setDefault}
        onRemove={remove}
      />
      <ChargesCard
        charges={charges}
        summary={summary}
        busy={busy}
        onApprove={approve}
        onContest={setContesting}
      />
      <InvoicesCard invoices={invoices} busy={busy} payingId={payingId} results={payResults} onPay={payInvoice} />
      <AutopayCard methods={methods} />
      {contesting && (
        <ContestChargeModal
          charge={contesting}
          busy={busy}
          onCancel={() => setContesting(null)}
          onSubmit={contest}
        />
      )}
    </div>
  );
}
