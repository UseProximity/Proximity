/*
 * Run with: npm test (from apps/web).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildEmailRow, redactSecrets } from "./emailLog.js";
import { categoryOf, kindLabel } from "./emailKinds.js";

const RAW = "f3a9c1e07b2d4e6f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f";

test("every kind of emailed login link loses its token", () => {
  const links = [
    `https://useproximity.org/reset-password?token=${RAW}`,
    `https://useproximity.org/api/auth/verify-email?token=${RAW}&next=%2Fdashboard`,
    `https://useproximity.org/review/finish?token=${RAW}`,
    `https://useproximity.org/review-invite/t/${RAW}`,
    `https://useproximity.org/chat-link?token=abc_DEF-123&t=4b9125f6-7587-4cb3-9e03-0b9fdca78b6a`,
    `https://useproximity.org/contact-verify?token=${RAW}`,
    `https://useproximity.org/api/auto-unavailable/undo?token=${RAW}`,
    `https://useproximity.org/api/availability/confirm?token=${RAW}&answer=yes`,
  ];
  for (const link of links) {
    const out = redactSecrets(link);
    assert.ok(!out.includes(RAW) && !out.includes("abc_DEF-123"), out);
    assert.ok(out.includes("[removed]"), out);
  }
});

test("HTML-escaped and percent-encoded tokens are caught too", () => {
  assert.equal(
    redactSecrets(`<a href="https://x.org/chat-link?t=1&amp;token=${RAW}">open</a>`),
    `<a href="https://x.org/chat-link?t=1&amp;token=[removed]">open</a>`
  );
  assert.ok(!redactSecrets(`/login?callbackUrl=%2Freview%2Fclaim%3Ftoken%3D${RAW}`).includes(RAW));
});

test("a long opaque value under an unknown name is removed, ids stay readable", () => {
  assert.ok(!redactSecrets(`https://x.org/a?magic=${RAW}`).includes(RAW));
  const ids = "https://useproximity.org/messages?thread=4b9125f6-7587-4cb3-9e03-0b9fdca78b6a&listing=12";
  assert.equal(redactSecrets(ids), ids);
});

test("ordinary text is untouched", () => {
  const text = "Hi Jessica, is the 2 bed still available? Rent is $1,200 & utilities.";
  assert.equal(redactSecrets(text), text);
  assert.equal(redactSecrets(""), null);
  assert.equal(redactSecrets(undefined), null);
});

test("a row carries the category, recipients and redacted body", () => {
  const row = buildEmailRow(
    {
      from: '"Proximity" <info@useproximity.org>',
      to: "student@example.com",
      cc: ["a@example.com"],
      bcc: { address: "b@example.com" },
      subject: "Reset your Proximity password",
      html: `<a href="https://useproximity.org/reset-password?token=${RAW}">Reset</a>`,
    },
    { kind: "password_reset", userId: "u1" },
    { provider: "gmail", providerMessageId: "<id@gmail>", status: "sent" }
  );
  assert.equal(row.category, "account");
  assert.equal(row.to_email, "student@example.com");
  assert.equal(row.cc, "a@example.com, b@example.com");
  assert.ok(!row.body_html.includes(RAW));
  assert.equal(row.user_id, "u1");
  assert.equal(row.status, "sent");
});

test("an unlabelled email is still logged, as Other", () => {
  const row = buildEmailRow({ to: "x@example.com", subject: "Hi" }, undefined, { status: "suppressed" });
  assert.equal(row.category, "other");
  assert.equal(row.kind, "other");
  assert.equal(categoryOf("chat_alert"), "chat");
  assert.equal(kindLabel("chat_alert"), "New message alert");
  assert.equal(kindLabel("something_new"), "something new");
});
