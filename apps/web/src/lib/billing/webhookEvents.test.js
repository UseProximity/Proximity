/*
 * Run with: npm test (from apps/web).
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { processStripeEvent } from "./webhookEvents.js";
import { handlers } from "./webhookHandlers.js";
import { paymentMethodHandlers } from "./paymentMethodHandlers.js";
import { invoiceHandlers } from "./invoiceHandlers.js";
import { getStripe } from "./stripe.js";
import { STRIPE_EVENT_ALIASES, STRIPE_WEBHOOK_EVENTS } from "./stripeEvents.mjs";

// The few supabase-js calls webhookEvents makes, over an in-memory table.
function fakeDb() {
  const rows = new Map();
  return {
    rows,
    from(table) {
      assert.equal(table, "stripe_webhook_events");
      return {
        insert: async (row) => {
          if (rows.has(row.stripe_event_id)) return { error: { code: "23505" } };
          rows.set(row.stripe_event_id, { processed_at: null, error: null, ...row });
          return { error: null };
        },
        select: () => ({
          eq: (_col, id) => ({ single: async () => ({ data: rows.get(id), error: null }) }),
        }),
        update: (patch) => ({
          eq: async (_col, id) => {
            Object.assign(rows.get(id), patch);
            return { error: null };
          },
        }),
      };
    },
  };
}

const event = (id = "evt_1", type = "invoice.paid") => ({ id, type, livemode: false });

afterEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
});

describe("processStripeEvent", () => {
  it("claims a new event, runs its handler once and stamps processed_at", async () => {
    const db = fakeDb();
    let calls = 0;
    handlers["invoice.paid"] = async () => { calls += 1; };

    assert.deepEqual(await processStripeEvent(db, event()), { status: "handled" });
    assert.equal(calls, 1);
    assert.ok(db.rows.get("evt_1").processed_at);
  });

  it("skips a duplicate delivery of a processed event", async () => {
    const db = fakeDb();
    let calls = 0;
    handlers["invoice.paid"] = async () => { calls += 1; };

    await processStripeEvent(db, event());
    assert.deepEqual(await processStripeEvent(db, event()), { status: "duplicate" });
    assert.equal(calls, 1);
  });

  it("records the error and rethrows when the handler fails, then retries on redelivery", async () => {
    const db = fakeDb();
    let fail = true;
    handlers["invoice.paid"] = async () => {
      if (fail) throw new Error("boom");
    };

    await assert.rejects(() => processStripeEvent(db, event()), /boom/);
    assert.equal(db.rows.get("evt_1").processed_at, null);
    assert.equal(db.rows.get("evt_1").error, "boom");

    fail = false;
    assert.deepEqual(await processStripeEvent(db, event()), { status: "handled" });
    assert.ok(db.rows.get("evt_1").processed_at);
    assert.equal(db.rows.get("evt_1").error, null);
  });

  it("acknowledges an event type with no handler as ignored", async () => {
    const db = fakeDb();
    assert.deepEqual(await processStripeEvent(db, event("evt_2", "customer.updated")), { status: "ignored" });
    assert.ok(db.rows.get("evt_2").processed_at);
  });
});

describe("getStripe", () => {
  const saved = { key: process.env.STRIPE_SECRET_KEY, app: process.env.APP_ENV, vercel: process.env.VERCEL_ENV };
  afterEach(() => {
    for (const [k, v] of [["STRIPE_SECRET_KEY", saved.key], ["APP_ENV", saved.app], ["VERCEL_ENV", saved.vercel]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("refuses a live key outside production", () => {
    process.env.APP_ENV = "staging";
    process.env.STRIPE_SECRET_KEY = "sk_live_" + "x".repeat(24);
    assert.throws(() => getStripe(), /non-sandbox/);
  });

  it("accepts a sandbox key and a live key only on production", () => {
    process.env.APP_ENV = "development";
    process.env.STRIPE_SECRET_KEY = "sk_test_" + "x".repeat(24);
    assert.equal(typeof getStripe().webhooks.constructEvent, "function");

    process.env.APP_ENV = "production";
    process.env.STRIPE_SECRET_KEY = "rk_live_" + "x".repeat(24);
    assert.equal(typeof getStripe().webhooks.constructEvent, "function");
  });

  it("fails clearly when the key is missing", () => {
    process.env.APP_ENV = "development";
    delete process.env.STRIPE_SECRET_KEY;
    assert.throws(() => getStripe(), /Missing STRIPE_SECRET_KEY/);
  });
});

describe("webhook signature", () => {
  it("accepts a correctly signed payload and rejects a tampered one", () => {
    process.env.APP_ENV = "development";
    process.env.STRIPE_SECRET_KEY = "sk_test_" + "x".repeat(24);
    const stripe = getStripe();
    const secret = "whsec_testsecret";
    const payload = JSON.stringify({ id: "evt_sig", object: "event", type: "invoice.paid" });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });

    assert.equal(stripe.webhooks.constructEvent(payload, header, secret).id, "evt_sig");
    assert.throws(() => stripe.webhooks.constructEvent(payload + " ", header, secret));
    assert.throws(() => stripe.webhooks.constructEvent(payload, header, "whsec_other"));
  });
});

describe("STRIPE_WEBHOOK_EVENTS", () => {
  it("lists each event once", () => {
    assert.equal(new Set(STRIPE_WEBHOOK_EVENTS).size, STRIPE_WEBHOOK_EVENTS.length);
  });

  it("covers every event a handler is written for, so none is silently never delivered", () => {
    for (const type of [...Object.keys(paymentMethodHandlers), ...Object.keys(invoiceHandlers)]) {
      assert.ok(STRIPE_WEBHOOK_EVENTS.includes(STRIPE_EVENT_ALIASES[type] ?? type), `${type} has a handler but is not subscribed`);
    }
  });
});
