import test from "node:test";
import assert from "node:assert/strict";
import { firecrawlRequest, resetFirecrawlState } from "./firecrawl.js";

const env = { FIRECRAWL_API_KEY: "main", FIRECRAWL_API_KEY_BACKUP: "backup" };

function harness(statusFor) {
  const calls = [];
  const alerts = [];
  let t = 1_000_000;
  const deps = {
    env,
    now: () => t,
    notify: async (kind) => alerts.push(kind),
    fetchImpl: async (_url, init) => {
      const key = init.headers.Authorization.replace("Bearer ", "");
      calls.push(key);
      const status = statusFor(key);
      return new Response(JSON.stringify({ ok: status === 200 }), { status });
    },
  };
  return { deps, calls, alerts, advance: (ms) => (t += ms) };
}

test("main key with credits: backup never touched, no alert", async () => {
  resetFirecrawlState();
  const h = harness(() => 200);
  const res = await firecrawlRequest("/v2/scrape", {}, { deps: h.deps });
  assert.equal(res.status, 200);
  assert.deepEqual(h.calls, ["main"]);
  assert.deepEqual(h.alerts, []);
});

test("main out of credits: same request goes to backup, one alert, main rests", async () => {
  resetFirecrawlState();
  const h = harness((k) => (k === "main" ? 402 : 200));
  assert.equal((await firecrawlRequest("/v2/scrape", {}, { deps: h.deps })).status, 200);
  assert.equal((await firecrawlRequest("/v2/scrape", {}, { deps: h.deps })).status, 200);
  assert.deepEqual(h.calls, ["main", "backup", "backup"]);
  assert.deepEqual(h.alerts, ["switched"]);
});

test("main is tried again after an hour and used once it has credits", async () => {
  resetFirecrawlState();
  let mainEmpty = true;
  const h = harness((k) => (k === "main" && mainEmpty ? 402 : 200));
  await firecrawlRequest("/v2/scrape", {}, { deps: h.deps });
  mainEmpty = false;
  h.advance(61 * 60 * 1000);
  await firecrawlRequest("/v2/scrape", {}, { deps: h.deps });
  assert.deepEqual(h.calls, ["main", "backup", "main"]);
});

test("every key out: returns null and sends the all-out alert", async () => {
  resetFirecrawlState();
  const h = harness(() => 402);
  assert.equal(await firecrawlRequest("/v2/scrape", {}, { deps: h.deps }), null);
  assert.equal(await firecrawlRequest("/v2/scrape", {}, { deps: h.deps }), null);
  assert.deepEqual(h.calls, ["main", "backup"]);
  assert.deepEqual(h.alerts, ["allOut"]);
});

test("other errors are returned to the caller, not treated as an empty account", async () => {
  resetFirecrawlState();
  const h = harness((k) => (k === "main" ? 500 : 200));
  assert.equal((await firecrawlRequest("/v2/scrape", {}, { deps: h.deps })).status, 500);
  assert.deepEqual(h.calls, ["main"]);
});

test("no backup set: behaves like before", async () => {
  resetFirecrawlState();
  const h = harness(() => 402);
  h.deps.env = { FIRECRAWL_API_KEY: "main" };
  assert.equal(await firecrawlRequest("/v2/scrape", {}, { deps: h.deps }), null);
  assert.equal(await firecrawlRequest("/v2/scrape", {}, { deps: { ...h.deps, env: {} } }), null);
  assert.deepEqual(h.calls, ["main"]);
});

test("FIRECRAWL_API_KEY_2 also works as the backup name", async () => {
  resetFirecrawlState();
  const h = harness((k) => (k === "main" ? 402 : 200));
  h.deps.env = { FIRECRAWL_API_KEY: "main", FIRECRAWL_API_KEY_2: "backup" };
  assert.equal((await firecrawlRequest("/v2/scrape", {}, { deps: h.deps })).status, 200);
  assert.deepEqual(h.calls, ["main", "backup"]);
});
