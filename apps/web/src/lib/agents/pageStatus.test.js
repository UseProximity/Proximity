// node --test apps/web/src/lib/agents/pageStatus.test.js
// Relative import: node --test does not know the @/ alias.
import test from "node:test";
import assert from "node:assert/strict";
import { copyReadStatus } from "./pageStatus.js";

test("a removed page that now shows the unchanged home page counts as read", () => {
  // /fees 301s to /, which has not changed: /fees's own stored text was the
  // fee page, so its facts must still be on the site to stay.
  assert.equal(copyReadStatus({ twinStatus: "unchanged", fetched: true, ownUnchanged: false }), "read");
  // A copy whose own text is the same as last time is unchanged.
  assert.equal(copyReadStatus({ twinStatus: "unchanged", fetched: true, ownUnchanged: true }), "unchanged");
  assert.equal(copyReadStatus({ twinStatus: "read", fetched: true, ownUnchanged: true }), "read");
});

test("a fetched copy whose twin has no status still gets one", () => {
  // /es/sobre-nosotros beside /about-us: /sobre-nosotros was never crawled.
  assert.equal(copyReadStatus({ twinStatus: null, fetched: true, ownUnchanged: false }), "read");
  assert.equal(copyReadStatus({ twinStatus: null, fetched: true, ownUnchanged: true }), "unchanged");
});

test("a known copy not fetched follows its twin", () => {
  assert.equal(copyReadStatus({ twinStatus: "read", fetched: false }), "read");
  assert.equal(copyReadStatus({ twinStatus: "unchanged", fetched: false }), "unchanged");
  assert.equal(copyReadStatus({ twinStatus: null, fetched: false }), null);
});
