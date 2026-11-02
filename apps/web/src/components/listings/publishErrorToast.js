"use client";

import toast from "react-hot-toast";

const PAYMENTS_URL = "/dashboard/landlord?tab=payments#commission-agreement";

/*
 * Show why a save or publish was refused. When the listing gate refused it
 * (code billing_setup_required: payment method, agreement or an overdue invoice),
 * the toast links straight to the Payments tab where it is fixed.
 */
export function publishErrorToast(data, fallback) {
  if (data?.code === "billing_setup_required") {
    return toast.error(
      <span>
        {data.error}{" "}
        <a href={PAYMENTS_URL} className="font-semibold underline">
          Go to Payments
        </a>
      </span>,
      { duration: 10000 }
    );
  }
  return toast.error(data?.error || fallback);
}
