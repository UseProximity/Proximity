"use client";

import { createContext, useCallback, useContext } from "react";
import toast from "react-hot-toast";

/*
 * Billing while an admin views as a landlord (Wyatt, 2026-11-11): the admin sees
 * the landlord's own Billing tab, read-only.
 *
 * Reads carry ?viewAs=<landlord id> (the API answers for that landlord only when
 * the caller is an admin). Writes never do: the billing write routes act on the
 * signed-in user and require the landlord role, so they refuse an admin anyway.
 * The guard below is the matching UI: action buttons and links look disabled
 * and do nothing. Anything that only shows something (expand a card, open a
 * signed PDF, download a file) is marked data-readonly-ok and still works.
 */
const BillingViewAsContext = createContext(null);

export const BillingViewAsProvider = BillingViewAsContext.Provider;

/** Adds ?viewAs= to a billing read URL while viewing as someone, else returns it unchanged. */
export const withViewAs = (url, viewAsId) =>
  viewAsId ? `${url}${url.includes("?") ? "&" : "?"}viewAs=${encodeURIComponent(viewAsId)}` : url;

/** withViewAs for components under BillingViewAsProvider. */
export function useBillingUrl() {
  const viewAsId = useContext(BillingViewAsContext);
  return useCallback((url) => withViewAs(url, viewAsId), [viewAsId]);
}

const BLOCKED = "button:not([data-readonly-ok]), a:not([data-readonly-ok])";

export function ReadOnlyGuard({ name, children }) {
  const block = (e) => {
    const el = e.type === "submit" ? e.target : e.target.closest?.(BLOCKED);
    if (!el || (e.type !== "submit" && el.closest("[data-readonly-ok]"))) return;
    e.preventDefault();
    e.stopPropagation();
    toast("Read-only while viewing as this landlord.", { id: "billing-read-only" });
  };
  return (
    <div
      onClickCapture={block}
      onSubmitCapture={block}
      className="space-y-4 [&_a:not([data-readonly-ok])]:cursor-not-allowed [&_a:not([data-readonly-ok])]:opacity-50 [&_button:not([data-readonly-ok])]:cursor-not-allowed [&_button:not([data-readonly-ok])]:opacity-50"
    >
      <div className="max-w-3xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Read-only. This is {name ? `${name}'s` : "this landlord's"} Billing tab exactly as they see it. Buttons are turned off;
        you can still expand sections and open signed documents.
      </div>
      {children}
    </div>
  );
}
