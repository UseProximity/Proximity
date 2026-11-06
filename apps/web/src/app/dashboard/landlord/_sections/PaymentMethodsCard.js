"use client";

import { Building2, CreditCard } from "lucide-react";
import CollapsibleSection from "./CollapsibleSection";

const STATUS = {
  active: { label: "Active", className: "bg-green-100 text-green-800" },
  verifying: { label: "Verifying", className: "bg-amber-100 text-amber-800" },
  expired: { label: "Expired", className: "bg-red-100 text-red-800" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800" },
};

// "Failed" covers a bank account that failed verification and a method whose
// payment failed; which one is not recorded, so the wording covers both (Wyatt, 2026-11-06).
const ATTENTION_COPY = {
  expired: "has expired",
  failed: "can't be used: it failed verification or a payment didn't go through",
};

function MethodRow({ method, busy, onSetDefault, onRemove }) {
  const status = STATUS[method.status] ?? STATUS.active;
  const Icon = method.type === "card" ? CreditCard : Building2;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Icon className="h-5 w-5 text-gray-400 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{method.description}</p>
        {method.status === "verifying" && (
          <p className="text-xs text-gray-500">
            Stripe is verifying this bank account. This can take 1 to 2 business days.
          </p>
        )}
        {ATTENTION_COPY[method.status] && (
          <p className="text-xs text-red-700">
            This {method.type === "card" ? "card" : "bank account"} {ATTENTION_COPY[method.status]}. Remove it, or add it again.
          </p>
        )}
      </div>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>{status.label}</span>
      {method.isDefault && (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">Default</span>
      )}
      <div className="flex items-center gap-2">
        {!method.isDefault && method.status === "active" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSetDefault(method.id)}
            className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Make default
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemove(method)}
          className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

export default function PaymentMethodsCard({ methods, busy, onAdd, onSetDefault, onRemove }) {
  const needsAttention = methods.filter((m) => m.needsAttention);
  const hasActive = methods.some((m) => m.status === "active");
  const current = methods.find((m) => m.isDefault && m.status === "active") ?? methods.find((m) => m.status === "active");
  // The red banner only when nothing active can pay the invoices: the default
  // failed or expired, or no method is active. A failed method beside an active
  // default just says so on its own row (Wyatt, 2026-11-06).
  const defaultBroken = methods.some((m) => m.isDefault && m.needsAttention);
  const showBanner = needsAttention.length > 0 && (!hasActive || defaultBroken);
  // Folded when an active method can pay and nothing needs fixing.
  const needsAction = !hasActive || showBanner;

  return (
    <CollapsibleSection
      id="payment-method"
      title="Payment method"
      defaultOpen={needsAction}
      badge={
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${needsAction ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
          {needsAction ? (methods.length ? "Needs attention" : "Not added") : "Active"}
        </span>
      }
      summary={current ? `${current.description} is charged for your monthly invoice.` : "No active payment method yet."}
    >
      <p className="px-4 pt-4 text-sm text-gray-500">
        Your monthly invoice is charged automatically to your default payment method. A bank account (ACH) is
        recommended. Card and bank details are entered on Stripe&apos;s secure page and never reach Proximity.
      </p>

      {/* One line: each method's own row says what is wrong with it. */}
      {showBanner && (
        <div className="mx-4 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {needsAttention.length === 1 && !hasActive
            ? `Your ${needsAttention[0].description} ${ATTENTION_COPY[needsAttention[0].status]}.`
            : hasActive
              ? "Your default payment method can't be used."
              : "None of your payment methods can be used right now."}{" "}
          Please add a new payment method{hasActive ? " or make another one the default" : ""} so your invoices can be paid.
        </div>
      )}

      {methods.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-600">
          You have no payment method yet. Add one before you create a listing.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {methods.map((m) => (
            <MethodRow key={m.id} method={m} busy={busy} onSetDefault={onSetDefault} onRemove={onRemove} />
          ))}
        </ul>
      )}

      {methods.length > 0 && !hasActive && !needsAttention.length && (
        <p className="px-4 pb-2 text-sm text-gray-500">
          You can create listings once a payment method is active.
        </p>
      )}

      <div className="flex flex-wrap gap-2 px-4 py-4 border-t border-gray-100">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAdd("us_bank_account")}
          className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
        >
          Add bank account (recommended)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAdd("card")}
          className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Add card
        </button>
      </div>
    </CollapsibleSection>
  );
}
