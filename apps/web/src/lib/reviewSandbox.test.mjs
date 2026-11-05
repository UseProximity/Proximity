import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutSandboxReviews, stripSandboxReviews } from "./reviewSandbox.js";

// A stand-in for the service-role client: users.review_sandbox = true returns `ids`.
const fakeClient = (ids, { fail = false } = {}) => ({
  from: () => ({
    select: () => ({
      eq: async () => (fail ? { data: null, error: { message: "down" } } : { data: ids.map((id) => ({ id })), error: null }),
    }),
  }),
});

const rows = [
  { id: "r1", user_id: "real" },
  { id: "r2", user_id: "sandbox" },
  { id: "r3", user_id: null },
];

test("a sandbox account's review is left out for everyone else", async () => {
  const out = await withoutSandboxReviews(rows, "someone", { client: fakeClient(["sandbox"]) });
  assert.deepEqual(out.map((r) => r.id), ["r1", "r3"]);
});

test("a sandbox account's review is shown to its author", async () => {
  const out = await withoutSandboxReviews(rows, "sandbox", { client: fakeClient(["sandbox"]) });
  assert.deepEqual(out.map((r) => r.id), ["r1", "r2", "r3"]);
});

test("a signed-out viewer never sees a sandbox review", async () => {
  const out = await withoutSandboxReviews(rows, null, { client: fakeClient(["sandbox"]) });
  assert.deepEqual(out.map((r) => r.id), ["r1", "r3"]);
});

test("no sandbox accounts means nothing is filtered", async () => {
  const out = await withoutSandboxReviews(rows, null, { client: fakeClient([]) });
  assert.equal(out, rows);
});

test("a failed lookup returns the rows unfiltered rather than failing the page", async () => {
  const out = await withoutSandboxReviews(rows, null, { client: fakeClient([], { fail: true }) });
  assert.equal(out, rows);
});

test("embedded listing reviews lose the sandbox ones, so ratings leave them out", async () => {
  const listings = [
    { id: "l1", listing_reviews: [{ rating: 5, user_id: "real" }, { rating: 1, user_id: "sandbox" }] },
    { id: "l2", listing_reviews: [] },
  ];
  await stripSandboxReviews(listings, { client: fakeClient(["sandbox"]) });
  assert.deepEqual(listings[0].listing_reviews, [{ rating: 5, user_id: "real" }]);
  assert.deepEqual(listings[1].listing_reviews, []);
});
