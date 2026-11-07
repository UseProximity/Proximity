/*
 * Shared plumbing for the admin mass email routes (Wyatt, 2026-11-07).
 *
 *   massEmailContext(req)  the admin's session and which database to use. Reads
 *                          follow the admin dashboard's dev/prod switch; sending
 *                          and every other change only touch this site's own
 *                          database, so production emails go out from production.
 *   errorResponse          an expected error becomes its own status and message,
 *                          anything else a generic 500 with the detail logged.
 */
import { NextResponse } from "next/server";
import { requireDbRole } from "@/lib/userRole";
import { adminBillingDb } from "@/lib/billing/adminDb";
import { BillingError } from "@/lib/billing/errors";
import { MassEmailError } from "./send";
import { TemplateError } from "./templates";
import { UnownedError } from "./unowned";

export async function massEmailContext(req, { write = false } = {}) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const ctx = adminBillingDb(req);
  if (write && !ctx.writable) {
    const where = ctx.target === "prod" ? "the production site (useproximity.org)" : "staging or a local copy";
    return {
      response: NextResponse.json(
        { error: `This is the ${ctx.target === "prod" ? "production" : "dev"} database, shown read-only here. Send from ${where}.`, code: "read_only_env" },
        { status: 409 }
      ),
    };
  }
  return { session, db: ctx.db, target: ctx.target, own: ctx.own, writable: ctx.writable };
}

export function errorResponse(err, context) {
  if (err instanceof MassEmailError || err instanceof TemplateError || err instanceof UnownedError || err instanceof BillingError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (["PGRST205", "42P01"].includes(err?.code)) {
    return NextResponse.json(
      { error: "Mass email is not set up in this database yet: its migration has not been applied.", code: "not_set_up" },
      { status: 503 }
    );
  }
  console.error(`mass email: ${context} failed`, err);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
