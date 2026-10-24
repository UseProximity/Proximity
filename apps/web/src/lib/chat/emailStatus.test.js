/*
 * Run with: npm test (from apps/web). Event shapes follow SES event publishing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TRANSITIONS, statusOf } from "./emailStatus.js";

// Mirrors the .in("status", TRANSITIONS[next]) guard on the update.
const apply = (current, type, event) => {
  const next = statusOf(type, event);
  return next && TRANSITIONS[next.status].includes(current) ? next.status : current;
};

test("each SES event maps to a status", () => {
  assert.equal(statusOf("Delivery", { delivery: { smtpResponse: "250 OK" } }).status, "delivered");
  assert.equal(statusOf("DeliveryDelay", { deliveryDelay: { delayType: "MailboxFull" } }).status, "delayed");
  assert.equal(statusOf("Bounce", { bounce: { bounceType: "Permanent", bounceSubType: "General" } }).status, "bounced");
  assert.equal(statusOf("Complaint", { complaint: {} }).status, "complained");
  assert.equal(statusOf("Reject", { reject: { reason: "Bad content" } }).status, "rejected");
  assert.equal(statusOf("Rendering Failure", { failure: { errorMessage: "x" } }).status, "failed");
  assert.equal(statusOf("Send", {}), null);
  assert.equal(statusOf("Open", {}), null);
});

test("a soft bounce is a delay, not a bounce", () => {
  const s = statusOf("Bounce", { bounce: { bounceType: "Transient", bounceSubType: "MailboxFull" } });
  assert.equal(s.status, "delayed");
  assert.match(s.detail, /soft bounce/);
});

test("the bounce detail carries the server's reason", () => {
  const s = statusOf("Bounce", {
    bounce: { bounceType: "Permanent", bounceSubType: "General", bouncedRecipients: [{ diagnosticCode: "550 5.1.1 user unknown" }] },
  });
  assert.equal(s.detail, "Permanent: General: 550 5.1.1 user unknown");
});

test("a status only moves forward", () => {
  assert.equal(apply("sent", "Delivery", {}), "delivered");
  assert.equal(apply("delayed", "Delivery", {}), "delivered");
  // A late delay notice never hides a delivery.
  assert.equal(apply("delivered", "DeliveryDelay", {}), "delivered");
  // A spam complaint after delivery always lands.
  assert.equal(apply("delivered", "Complaint", {}), "complained");
  // An async bounce after delivery lands.
  assert.equal(apply("delivered", "Bounce", { bounce: { bounceType: "Permanent" } }), "bounced");
  // Good news never overwrites bad.
  assert.equal(apply("bounced", "Delivery", {}), "bounced");
  assert.equal(apply("complained", "Delivery", {}), "complained");
  assert.equal(apply("failed", "Delivery", {}), "failed");
});
