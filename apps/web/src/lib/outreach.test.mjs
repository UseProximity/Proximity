// Run with: node --test apps/web/src/lib/outreach.test.mjs
//
// Covers sendMailSafe's destination rules, which both the web "Test emails"
// picker (cookie) and the mobile one (x-staging-email-to header) rely on.
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sendMailSafe, stagingEmailHeader } from "./outreach.js";

const ENV_KEYS = ["APP_ENV", "VERCEL_ENV", "OUTREACH_TEST_RECIPIENT"];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function fakeTransporter() {
  const sent = [];
  return { sent, sendMail: async (m) => (sent.push(m), { messageId: "id" }) };
}
const reqWith = (value) => ({
  headers: { get: (name) => (name === "x-staging-email-to" && value !== undefined ? value : null) },
});
const message = () => ({ to: "landlord@real.example", cc: "student@real.example", subject: "Hello" });

describe("stagingEmailHeader", () => {
  it("returns the raw header value, or null when absent", () => {
    assert.equal(stagingEmailHeader(reqWith("tester@test.example")), "tester@test.example");
    assert.equal(stagingEmailHeader(reqWith(undefined)), null);
    assert.equal(stagingEmailHeader(undefined), null);
    assert.equal(stagingEmailHeader(null), null);
  });
});

describe("production", () => {
  it("sends to the original recipient and ignores the override header", async () => {
    process.env.APP_ENV = "production";
    process.env.OUTREACH_TEST_RECIPIENT = "env@test.example";
    const t = fakeTransporter();
    await sendMailSafe(t, message(), reqWith("tester@test.example"));
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].to, "landlord@real.example");
    assert.equal(t.sent[0].cc, "student@real.example");
    assert.equal(t.sent[0].subject, "Hello");
  });
});

describe("production, header value captured earlier (the after() path)", () => {
  it("still sends to the original recipient", async () => {
    process.env.APP_ENV = "production";
    const t = fakeTransporter();
    await sendMailSafe(t, message(), "tester@test.example");
    assert.equal(t.sent[0].to, "landlord@real.example");
    assert.equal(t.sent[0].subject, "Hello");
  });
});

describe("staging", () => {
  beforeEach(() => {
    process.env.APP_ENV = "staging";
  });

  it("accepts the captured header value in place of a request", async () => {
    process.env.OUTREACH_TEST_RECIPIENT = "env@test.example";
    const t = fakeTransporter();
    await sendMailSafe(t, message(), "tester@test.example");
    assert.equal(t.sent[0].to, "tester@test.example");
    assert.equal(t.sent[0].cc, undefined);
  });

  it("ignores an empty or invalid captured value and falls back or suppresses", async () => {
    for (const value of ["", "not-an-email", null]) {
      const t = fakeTransporter();
      await sendMailSafe(t, message(), value);
      assert.equal(t.sent.length, 0);
    }
    process.env.OUTREACH_TEST_RECIPIENT = "env@test.example";
    const t = fakeTransporter();
    await sendMailSafe(t, message(), "nope");
    assert.equal(t.sent[0].to, "env@test.example");
  });

  it("redirects to the header destination and drops cc", async () => {
    const t = fakeTransporter();
    await sendMailSafe(t, message(), reqWith("tester@test.example"));
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].to, "tester@test.example");
    assert.equal(t.sent[0].cc, undefined);
    assert.equal(t.sent[0].subject, "[TEST → was: landlord@real.example] Hello");
  });

  it("prefers the header over OUTREACH_TEST_RECIPIENT", async () => {
    process.env.OUTREACH_TEST_RECIPIENT = "env@test.example";
    const t = fakeTransporter();
    await sendMailSafe(t, message(), reqWith("tester@test.example"));
    assert.equal(t.sent[0].to, "tester@test.example");
  });

  it("falls back to OUTREACH_TEST_RECIPIENT when the header is empty or invalid", async () => {
    process.env.OUTREACH_TEST_RECIPIENT = "env@test.example";
    for (const value of [undefined, "", "not-an-email", "a b@c.d"]) {
      const t = fakeTransporter();
      await sendMailSafe(t, message(), reqWith(value));
      assert.equal(t.sent.length, 1);
      assert.equal(t.sent[0].to, "env@test.example");
    }
  });

  it("suppresses the email when no valid destination exists", async () => {
    for (const value of [undefined, "", "not-an-email"]) {
      const t = fakeTransporter();
      const result = await sendMailSafe(t, message(), reqWith(value));
      assert.equal(t.sent.length, 0);
      assert.deepEqual(result, { suppressed: true });
    }
    // Also with no request at all (cron and webhook contexts).
    const t = fakeTransporter();
    await sendMailSafe(t, message());
    assert.equal(t.sent.length, 0);
  });

  it("treats an invalid OUTREACH_TEST_RECIPIENT as unset", async () => {
    process.env.OUTREACH_TEST_RECIPIENT = "broken";
    const t = fakeTransporter();
    await sendMailSafe(t, message(), reqWith(undefined));
    assert.equal(t.sent.length, 0);
  });
});

// ---- One ordinary address only: validation regression tests -------------------------

const VALID = ["tester@test.example", "first.last+tag@sub.test.example", "a_b-c@x.co"];
const MALFORMED = ["", "plain", "a@b", "@b.co", "a@", "a b@c.de", "a@b.c d", "a@@b.co"];
const MULTIPLE = [
  "a@b.co,c@d.co",
  "a@b.co;c@d.co",
  "x,victim@real.example", // second recipient hidden before the @
  "a@b.co,",
  "<a@b.co>",
  "Name <a@b.co>",
  "a@b.co>,<c",
];

// The three copies of the pattern (server, web picker, mobile) must stay identical.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const COPIES = {
  server: "apps/web/src/lib/outreach.js",
  webPicker: "apps/web/src/components/layout/StagingEmailPicker.js",
  mobile: "apps/mobile/src/lib/stagingEmail.js",
};
function patternOf(file) {
  const m = readFileSync(repoRoot + file, "utf8").match(/const EMAIL_RE = \/(.+)\/;/);
  assert.ok(m, `no EMAIL_RE in ${file}`);
  return m[1];
}

describe("destination validation is the same in every layer", () => {
  it("uses an identical pattern in server, web picker and mobile", () => {
    const patterns = Object.values(COPIES).map(patternOf);
    assert.equal(new Set(patterns).size, 1, `patterns differ: ${patterns.join(" | ")}`);
  });

  for (const [layer, file] of Object.entries(COPIES)) {
    it(`${layer}: accepts ordinary addresses, rejects malformed and multiple-recipient input`, () => {
      const re = new RegExp(patternOf(file));
      for (const v of VALID) assert.equal(re.test(v), true, `should accept ${v}`);
      for (const v of [...MALFORMED, ...MULTIPLE]) assert.equal(re.test(v), false, `should reject ${v}`);
    });
  }
});

describe("staging: multiple-recipient input never becomes a destination", () => {
  beforeEach(() => {
    process.env.APP_ENV = "staging";
  });

  it("ignores a multi-recipient header and suppresses when there is no fallback", async () => {
    for (const value of MULTIPLE) {
      const t = fakeTransporter();
      await sendMailSafe(t, message(), reqWith(value));
      assert.equal(t.sent.length, 0, `header ${value} must not send`);
      const t2 = fakeTransporter();
      await sendMailSafe(t2, message(), value); // captured-string form
      assert.equal(t2.sent.length, 0, `captured ${value} must not send`);
    }
  });

  it("falls back to a valid OUTREACH_TEST_RECIPIENT, never to the list", async () => {
    process.env.OUTREACH_TEST_RECIPIENT = "env@test.example";
    for (const value of MULTIPLE) {
      const t = fakeTransporter();
      await sendMailSafe(t, message(), reqWith(value));
      assert.equal(t.sent.length, 1);
      assert.equal(t.sent[0].to, "env@test.example");
    }
  });

  it("treats a multi-recipient OUTREACH_TEST_RECIPIENT as unset", async () => {
    for (const value of MULTIPLE) {
      process.env.OUTREACH_TEST_RECIPIENT = value;
      const t = fakeTransporter();
      await sendMailSafe(t, message(), reqWith(undefined));
      assert.equal(t.sent.length, 0, `env ${value} must not send`);
    }
  });

  it("still redirects an ordinary address", async () => {
    for (const value of VALID) {
      const t = fakeTransporter();
      await sendMailSafe(t, message(), reqWith(value));
      assert.equal(t.sent[0].to, value);
    }
  });
});

describe("production ignores multi-recipient input too", () => {
  it("sends only to the original recipient", async () => {
    process.env.APP_ENV = "production";
    const t = fakeTransporter();
    await sendMailSafe(t, message(), reqWith("a@b.co,c@d.co"));
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].to, "landlord@real.example");
  });
});
