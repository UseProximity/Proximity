"use client";

import toast from "react-hot-toast";
import { needsCoverageOnly, openCoverageDialog } from "./CoverageSignDialog";

const PAYMENTS_URL = "/dashboard/landlord?tab=billing#marketing-agreement";

/*
 * Show why a save or publish was refused. When the listing gate refused it
 * (code billing_setup_required: payment method, agreement or an overdue invoice),
 * the toast links straight to the Payments tab where it is fixed.
 *
 * When the only problem is that the properties are not on the landlord's
 * commission agreement yet, and the caller passes `retry`, the signing dialog
 * opens instead: they sign the agreement or an Exhibit A amendment for exactly
 * those properties, and `retry` runs the publish again.
 */
export function publishErrorToast(data, fallback, { retry } = {}) {
  if (retry && needsCoverageOnly(data)) {
    openCoverageDialog({ uncovered: data.uncovered, onSigned: retry });
    return null;
  }
  if (data?.code === "billing_setup_required") {
    return toast.error(
      <span>
        {data.error}{" "}
        <a href={PAYMENTS_URL} className="font-semibold underline">
          Go to Billing
        </a>
      </span>,
      { duration: 10000 }
    );
  }
  return toast.error(data?.error || fallback);
}
