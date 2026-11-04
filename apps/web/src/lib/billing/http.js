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
  console.error(`billing: ${context} failed`, err);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID.test(v);
