"use client";

/*
 * The two pieces every draft surface shares: the amber "Draft" marker and the
 * Publish button. One look everywhere, so a landlord learns once that amber
 * means "students can't see this yet".
 *
 * Publishing is one-way (see /api/landlord/publish), so the button asks first
 * and says so. Withdraw is how a live offering comes back off the market.
 */

import { useState } from "react";
import toast from "react-hot-toast";
import { Send } from "lucide-react";

export function DraftBadge({ className = "" }) {
  return (
    <span
      className={`rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ${className}`}
    >
      Draft
    </span>
  );
}

const WHAT = {
  property: "this property",
  unit: "this unit",
  lease: "this listing",
};

export function PublishButton({
  kind,
  id,
  scope,
  label = "Publish",
  disabledReason = null,
  confirmText,
  successText = "Published. Students can see it now.",
  onPublished,
  size = "sm",
}) {
  const [busy, setBusy] = useState(false);
  const disabled = busy || !!disabledReason;

  const publish = async (e) => {
    e?.stopPropagation();
    if (disabled) return;
    if (
      !confirm(
        confirmText ??
          `Publish ${WHAT[kind]}? Students will be able to see it right away. Once published it can't go back to being a draft, but you can still edit or withdraw it.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/landlord/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, scope }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Couldn't publish that.");
      toast.success(typeof successText === "function" ? successText(data.published) : successText);
      await onPublished?.();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(false);
    }
  };

  const pad = size === "md" ? "px-3.5 py-2 text-sm" : "px-3 py-1.5 text-xs";
  // Greyed out rather than hidden, with the reason on hover, so a landlord
  // can see the step exists and what comes first.
  const look = disabledReason
    ? "bg-gray-200 text-gray-500 cursor-not-allowed"
    : "bg-green-600 text-white hover:bg-green-700 disabled:opacity-60";
  return (
    <button
      type="button"
      onClick={publish}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabledReason ?? undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg font-semibold transition ${look} ${pad}`}
    >
      <Send className="h-3.5 w-3.5" />
      {busy ? "Publishing…" : label}
    </button>
  );
}
