"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PaymentMethodsCard from "./PaymentMethodsCard";
import ChargesCard from "./ChargesCard";
import InvoicesCard from "./InvoicesCard";
import ContestChargeModal from "./ContestChargeModal";

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
 * The landlord's payments page: balance and charges (with Approve and Contest),
 * monthly invoices (with Pay now), and the payment method card. The agreement
 * joins it when that feature lands.
 *
 * Coming back from Stripe Checkout lands here with ?setup=success&session_id=...
 * (or ?setup=cancelled). The session is synced straight away so the new method
 * is on screen, then the parameters are dropped so a reload does not repeat it.
 */
export default function PaymentsSection() {
  const [methods, setMethods] = useState([]);
  const [charges, setCharges] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [summary, setSummary] = useState({ balanceCents: 0, inReviewCents: 0 });
  const [contesting, setContesting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const handledReturn = useRef(false);

  const load = useCallback(async () => {
    const [m, c, i] = await Promise.all([
      call("/api/billing/payment-methods"),
      call("/api/billing/charges"),
      call("/api/billing/invoices"),
    ]);
    setMethods(m.methods);
    setCharges(c.charges);
    setSummary(c.summary);
    setInvoices(i.invoices);
  }, []);

  useEffect(() => {
    if (handledReturn.current) return;
    handledReturn.current = true;

    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const setup = params.get("setup");
        const sessionId = params.get("session_id");
        if (setup) window.history.replaceState(null, "", "?tab=payments");

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
      setNotice({ tone: "green", text: "Charge approved. It will be on your next monthly invoice." });
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
      setNotice({ tone: "gray", text: "Charge contested. We will email you the outcome." });
    });

  const payInvoice = (invoice) =>
    run(async () => {
      try {
        const result = await call(`/api/billing/invoices/${invoice.id}/pay`, { method: "POST" });
        setNotice({
          tone: "green",
          text: result.alreadyPaid
            ? "That invoice is already paid."
            : "Payment started. A bank payment can take a few business days to complete.",
        });
      } finally {
        // A decline still changes the invoice (its reason), so always show the latest.
        await load().catch(() => {});
      }
    });

  if (loading) return <p className="text-sm text-gray-500">Loading payments...</p>;

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
      <ChargesCard
        charges={charges}
        summary={summary}
        busy={busy}
        onApprove={approve}
        onContest={setContesting}
      />
      <InvoicesCard invoices={invoices} busy={busy} onPay={payInvoice} />
      <PaymentMethodsCard
        methods={methods}
        busy={busy}
        onAdd={add}
        onSetDefault={setDefault}
        onRemove={remove}
      />
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
