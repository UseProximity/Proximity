#!/usr/bin/env node
/*
 * stripe-setup.mjs: create or update the Stripe webhook endpoint the billing
 * integration depends on. Idempotent: run it as often as you like. It finds its
 * endpoint by URL and brings the subscribed events in line with
 * apps/web/src/lib/billing/stripeEvents.mjs instead of adding a second one.
 *
 * Runs against whatever STRIPE_SECRET_KEY points at: the sandbox while
 * developing, live at launch. A live key is refused unless you pass --live, so
 * a pasted live key cannot be used by accident.
 *
 *   node scripts/stripe-setup.mjs --url https://<staging-host>/api/webhooks/stripe
 *   node scripts/stripe-setup.mjs --url https://useproximity.org/api/webhooks/stripe --live
 *   node scripts/stripe-setup.mjs --url ... --dry-run     show what would change
 *
 * Options
 *   --url <url>        the public webhook URL (required)
 *   --live             allow a live-mode key
 *   --dry-run          change nothing in Stripe
 *   --env-file <path>  where to read STRIPE_SECRET_KEY from when it is not
 *                      already in the environment (default apps/web/.env.local)
 *
 * Local development does not need this: `stripe listen --forward-to
 * localhost:3000/api/webhooks/stripe` prints a whsec_ secret for .env.local.
 *
 * Stripe only reveals an endpoint's signing secret when it is created. If the
 * endpoint already exists the secret is unchanged and is read from the
 * dashboard (Developers > Webhooks).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { STRIPE_WEBHOOK_EVENTS } from "../apps/web/src/lib/billing/stripeEvents.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = { managed_by: "proximity-stripe-setup" };

function parseArgs(argv) {
  const args = { live: false, dryRun: false, url: null, envFile: path.join(ROOT, "apps/web/.env.local") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") args.live = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--env-file") args.envFile = path.resolve(argv[++i]);
    else fail(`Unknown argument: ${a}`);
  }
  return args;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function loadSecretKey(envFile) {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  if (!fs.existsSync(envFile)) return null;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*STRIPE_SECRET_KEY\s*=\s*(.*?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) fail("--url is required, e.g. --url https://example.com/api/webhooks/stripe");
  let url;
  try {
    url = new URL(args.url);
  } catch {
    fail(`Not a valid URL: ${args.url}`);
  }
  if (url.protocol !== "https:") {
    fail("Stripe only delivers to https URLs. For localhost use `stripe listen --forward-to` instead.");
  }

  const key = loadSecretKey(args.envFile);
  if (!key) fail(`STRIPE_SECRET_KEY not found in the environment or ${args.envFile}`);
  const isLive = /^(sk|rk)_live_/.test(key);
  if (!isLive && !/^(sk|rk)_test_/.test(key)) fail("STRIPE_SECRET_KEY is not a Stripe secret or restricted key");
  if (isLive && !args.live) fail("That is a LIVE key. Re-run with --live if you mean to configure live mode.");
  if (!isLive && args.live) fail("--live was given but the key is a sandbox key.");

  const stripe = new Stripe(key, { appInfo: { name: "Proximity setup script" } });
  console.log(`Mode:     ${isLive ? "LIVE" : "sandbox"}${args.dryRun ? " (dry run)" : ""}`);
  console.log(`Endpoint: ${url.href}`);

  let existing = null;
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url === url.href) {
      existing = endpoint;
      break;
    }
  }

  const wanted = [...STRIPE_WEBHOOK_EVENTS].sort();

  if (!existing) {
    console.log(`Create:   new endpoint subscribed to ${wanted.length} events`);
    if (args.dryRun) return printChecklist(isLive);
    const created = await stripe.webhookEndpoints.create({
      url: url.href,
      enabled_events: wanted,
      api_version: stripe.getApiField("version"),
      description: "Proximity billing",
      metadata: MARKER,
    });
    console.log(`Created ${created.id}`);
    console.log("\nSigning secret (shown once, copy it now into STRIPE_WEBHOOK_SECRET):");
    console.log(`  ${created.secret}`);
  } else {
    const have = [...existing.enabled_events].sort();
    const missing = wanted.filter((e) => !have.includes(e));
    const extra = have.filter((e) => !wanted.includes(e));
    const disabled = existing.status !== "enabled";
    if (!missing.length && !extra.length && !disabled) {
      console.log(`Up to date: ${existing.id} already subscribes to exactly these events.`);
    } else {
      if (missing.length) console.log(`Add:      ${missing.join(", ")}`);
      if (extra.length) console.log(`Remove:   ${extra.join(", ")}`);
      if (disabled) console.log("Enable:   endpoint was disabled");
      if (!args.dryRun) {
        await stripe.webhookEndpoints.update(existing.id, {
          enabled_events: wanted,
          disabled: false,
          metadata: MARKER,
        });
        console.log(`Updated ${existing.id}`);
      }
    }
    console.log("The signing secret is unchanged (find it in Dashboard > Developers > Webhooks).");
  }

  printChecklist(isLive);
}

// Billing behaviour Stripe only lets you set in the dashboard, so the script
// cannot do it. Listed every run so nothing is configured from memory.
function printChecklist(isLive) {
  const where = isLive ? "live" : "sandbox";
  console.log(`\nDashboard settings to confirm in the ${where} account (not settable by API):`);
  console.log("  [ ] Settings > Billing > Revenue recovery > Smart Retries: OFF");
  console.log("  [ ] Settings > Billing > Revenue recovery > Automatic invoice reminders: as wanted (on by default)");
  console.log("  [ ] Settings > Payment methods: US bank account (ACH) ON, Cards ON");
  console.log("  [ ] Settings > Payment methods > US bank account: Financial Connections verification ON");
}

main().catch((err) => fail(err?.message || String(err)));
