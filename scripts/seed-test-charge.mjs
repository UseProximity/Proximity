#!/usr/bin/env node
/*
 * seed-test-charge.mjs: create test charges on a landlord account in the DEV
 * database, so the payments dashboard, contest flow, review clock and billing
 * run can be tried before the Triggering project creates real ones.
 *
 *   node scripts/seed-test-charge.mjs                        a $25 Unconfirmed charge
 *   node scripts/seed-test-charge.mjs --amount 120.50 --status pending
 *   node scripts/seed-test-charge.mjs --count 3 --status approved
 *
 * Options
 *   --landlord <email>   default billing-landlord@example.com
 *   --admin <email>      the admin recorded as actor (default billing-admin@example.com)
 *   --amount <dollars>   default 25.00
 *   --trigger <type>     default test_charge
 *   --status <status>    unconfirmed (default), pending, or approved
 *   --count <n>          how many (default 1)
 *   --listing <uuid>     attach a listing (default: one the landlord owns, if any)
 *   --env-file <path>    default apps/web/.env.local
 *
 * Only ever writes to the dev database, and refuses to run unless APP_ENV is
 * development. Charges are flagged is_test.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createCharge, transitionCharge } from "../apps/web/src/lib/billing/charges.js";
import { dollarsToCents, formatCents } from "../apps/web/src/lib/billing/money.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const args = {
  landlord: "billing-landlord@example.com",
  admin: "billing-admin@example.com",
  amount: "25.00",
  trigger: "test_charge",
  status: "unconfirmed",
  count: 1,
  listing: null,
  envFile: path.join(ROOT, "apps/web/.env.local"),
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, "");
  if (!(key in args)) fail(`Unknown argument: ${argv[i]}`);
  args[key] = argv[++i];
}
args.count = Number(args.count);
if (!Number.isInteger(args.count) || args.count < 1 || args.count > 50) fail("--count must be 1 to 50");
if (!["unconfirmed", "pending", "approved"].includes(args.status)) fail("--status must be unconfirmed, pending or approved");
const amountCents = dollarsToCents(args.amount);
if (!amountCents) fail("--amount must be dollars like 25.00");

const env = {};
for (const line of fs.readFileSync(args.envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (env.APP_ENV !== "development") fail("APP_ENV is not development; refusing to run");
if (!env.DEV_SUPABASE_URL || !env.DEV_SUPABASE_SERVICE_KEY) fail("dev Supabase keys missing");

const db = createClient(env.DEV_SUPABASE_URL, env.DEV_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

async function userByEmail(email) {
  const { data, error } = await db.from("users").select("id").eq("email", email.toLowerCase()).is("deleted_at", null).maybeSingle();
  if (error) fail(error.message);
  if (!data) fail(`No account with email ${email}`);
  return data;
}

const landlord = await userByEmail(args.landlord);
const admin = await userByEmail(args.admin);

let listingId = args.listing;
if (!listingId) {
  const { data } = await db.from("listing_landlords").select("listing_id").eq("user_id", landlord.id).limit(1);
  listingId = data?.[0]?.listing_id ?? null;
}

for (let n = 1; n <= args.count; n++) {
  const charge = await createCharge(db, {
    landlordId: landlord.id,
    amountCents,
    triggerType: args.trigger,
    description: `Test charge ${n} of ${args.count}`,
    listingId,
    createdByType: "admin",
    createdById: admin.id,
    isTest: true,
  });
  let status = charge.status;
  if (args.status !== "unconfirmed") {
    const confirmed = await transitionCharge(db, {
      chargeId: charge.id, expectedFrom: "unconfirmed", to: "pending",
      actorType: "admin", actorUserId: admin.id, note: "Confirmed by the seed script",
    });
    status = confirmed.status;
  }
  if (args.status === "approved") {
    const approved = await transitionCharge(db, {
      chargeId: charge.id, expectedFrom: "pending", to: "approved",
      actorType: "admin", actorUserId: admin.id, note: "Approved by the seed script",
    });
    status = approved.status;
  }
  console.log(`${charge.id}  ${formatCents(amountCents)}  ${status}${listingId ? "  (listing attached)" : ""}`);
}
