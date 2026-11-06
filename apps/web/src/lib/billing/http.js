/*
 * Shared plumbing for the billing API routes: an expected BillingError becomes
 * its own status and message, anything else a generic 500. Stripe and database
 * detail is logged, never returned.
 */
import { NextResponse } from "next/server";
import { BillingError } from "./errors";

export function billingErrorResponse(err, context) {
  if (err instanceof BillingError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  // A database without the billing tables yet (production before its billing
  // migrations): said plainly, not as a crash.
  if (["PGRST205", "42P01"].includes(err?.code)) {
    return NextResponse.json(
      { error: "Billing is not set up in this database yet: its billing migrations have not been applied.", code: "billing_not_set_up" },
      { status: 503 }
    );
  }
  console.error(`billing: ${context} failed`, err);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID.test(v);
