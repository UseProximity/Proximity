// node --test apps/web/src/lib/agents/replyStream.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { scanFinalJson, replyStreamer, normalizeFinal, withoutAskClaims, saysNothingSent } from "./replyStream.js";

const FULL = JSON.stringify({
  intent: "question", answered_keys: ["fees.application"], unanswered_questions: [], clarifier_reply: false,
  reply: "The fee is $60 \"per\" person.\nPaid online \u2014 once.", nudged: false, offered_question: "",
});

test("scanFinalJson reads complete fields and the reply so far", () => {
  const cut = FULL.indexOf("per") + 2;
  const { done, reply } = scanFinalJson(FULL.slice(0, cut));
  assert.equal(done.intent, "question");
  assert.deepEqual(done.answered_keys, ["fees.application"]);
  assert.deepEqual(done.unanswered_questions, []);
  assert.equal(reply, 'The fee is $60 "pe');
});

test("scanFinalJson survives a cut inside an escape", () => {
  const at = FULL.indexOf("\\n") + 1; // stop right after the backslash
  assert.equal(scanFinalJson(FULL.slice(0, at)).reply, 'The fee is $60 "per" person.');
  const u = '{"answered_keys":[],"unanswered_questions":[],"reply":"caf\\u00';
  assert.equal(scanFinalJson(u).reply, "caf");
});

test("scanFinalJson ignores braces and keys inside strings", () => {
  const src = '{"unanswered_questions":[{"question":"is \\"reply\\": {x} ok?","lease_number":0}],"answered_keys":[],"reply":"Hi';
  const { done, reply } = scanFinalJson(src);
  assert.equal(done.unanswered_questions[0].question, 'is "reply": {x} ok?');
  assert.equal(reply, "Hi");
});

test("every prefix rebuilds the reply in order, never going back", () => {
  let shown = "";
  const feed = replyStreamer({ onDelta: (d) => { shown += d; }, isUsedKey: () => true, canAsk: true });
  for (let i = 1; i <= FULL.length; i++) feed(FULL.slice(0, i));
  assert.equal(shown, 'The fee is $60 "per" person.\nPaid online, once.');
});

test("nothing streams when the whole question goes to the landlord", () => {
  const asked = JSON.stringify({ intent: "question", answered_keys: [], unanswered_questions: [{ question: "Can I paint?", lease_number: 0 }], reply: "I don't have that yet." });
  let shown = "";
  const feed = replyStreamer({ onDelta: (d) => { shown += d; }, isUsedKey: () => true, canAsk: true });
  for (let i = 1; i <= asked.length; i++) feed(asked.slice(0, i));
  assert.equal(shown, "");
});

test("a reply written before the keys waits for them", () => {
  const early = JSON.stringify({ reply: "Yes, pets are allowed.", answered_keys: ["policies.pets"], unanswered_questions: [], intent: "question" });
  const seen = [];
  const feed = replyStreamer({ onDelta: (d) => seen.push(d), isUsedKey: () => true, canAsk: true });
  for (let i = 1; i <= early.length; i++) feed(early.slice(0, i));
  assert.deepEqual(seen, ["Yes, pets are allowed."]);
});

test("replyStreamer waits for the intent, and streams an apply reply", () => {
  const shown = [];
  const feed = replyStreamer({ onDelta: (t) => shown.push(t), isUsedKey: () => false, canAsk: true });
  const head = '{"answered_keys":[],"unanswered_questions":[{"question":"Can I apply?","lease_number":0}],"intent":"apply","reply":"Great, I have';
  feed(head.replace(',"intent":"apply"', ""));
  assert.equal(shown.join(""), "");
  feed(head);
  assert.equal(shown.join(""), "Great, I have");
});

test("replyStreamer still hides a reply that becomes the asking line", () => {
  const shown = [];
  const feed = replyStreamer({ onDelta: (t) => shown.push(t), isUsedKey: () => false, canAsk: true });
  feed('{"intent":"question","answered_keys":[],"unanswered_questions":[{"question":"Pets?","lease_number":0}],"reply":"I do not have');
  assert.equal(shown.join(""), "");
});

test("normalizeFinal fixes fields of the wrong type", () => {
  assert.equal(normalizeFinal(null), null);
  assert.equal(normalizeFinal("hi"), null);
  const f = normalizeFinal({ answered_keys: "fees.application", unanswered_questions: ["Pets?", 3, { question: " " }, { question: "Parking?", lease_number: 2 }], reply: 5 });
  assert.deepEqual(f.answered_keys, []);
  assert.deepEqual(f.unanswered_questions, [{ question: "Pets?", lease_number: 0 }, { question: "Parking?", lease_number: 2 }]);
  assert.equal(f.reply, "");
  assert.equal(f.intent, "question");
});

test("withoutAskClaims cuts claims that the landlord was asked", () => {
  const r = withoutAskClaims("Apt N is unfurnished. I don't have information on subletting. I've asked the landlord about both and will post the answer here.");
  assert.equal(r.removed, true);
  assert.equal(r.text, "Apt N is unfurnished. I don't have information on subletting.");
  const e = withoutAskClaims("I'm passing your Early Access request on to the landlord, and I'll post their answer here. In the meantime, tap the calendar button to tour.");
  assert.equal(e.text, "Tap the calendar button to tour.");
});

test("withoutAskClaims leaves ordinary answers alone", () => {
  const t = "Yes, you can tour in person. Booking a tour through Proximity also puts you in touch with the owner directly.";
  assert.deepEqual(withoutAskClaims(t), { text: t, removed: false });
});

test("replyStreamer holds the reply when nothing can be sent to the landlord", () => {
  let shown = "";
  const feed = replyStreamer({ onDelta: (d) => { shown += d; }, isUsedKey: () => true, canAsk: false });
  feed('{"intent":"question","answered_keys":["a"],"unanswered_questions":[{"question":"Sublets?"}],"reply":"Unfurnished. I\'ve asked the landlord');
  assert.equal(shown, "");
});

// Cases from the PR 473 review.
test("withoutAskClaims catches curly apostrophes, passive and pass-along claims", () => {
  for (const t of [
    "Sure. I’ve asked the landlord about parking.",
    "Good question! Your question has been sent to the landlord.",
    "The landlord has been notified.",
    "Thanks, I've passed it along.",
    "I've passed your question about parking to the landlord.",
  ]) {
    const r = withoutAskClaims(t);
    assert.equal(r.removed, true, t);
    assert.ok(!/landlord|passed/i.test(r.text), `${t} -> ${r.text}`);
  }
});

test("withoutAskClaims keeps answers that only mention the landlord", () => {
  for (const t of [
    "I've checked the listing and the landlord doesn't allow pets.",
    "I am happy to let you know the owner covers water.",
    "I can't pass this on to the landlord right now.",
    "Want me to ask the landlord?",
  ]) assert.deepEqual(withoutAskClaims(t), { text: t, removed: false }, t);
});

test("withoutAskClaims does not split at St. Louis or a price", () => {
  const r = withoutAskClaims("Rent is $1,295.50 a month. I've asked the landlord whether the St. Louis parking permit is included.");
  assert.equal(r.text, "Rent is $1,295.50 a month.");
});

test("withoutAskClaims drops a dangling lead-in after a cut, not only at the start", () => {
  const r = withoutAskClaims("Apt N is unfurnished. I've asked the landlord about subletting. In the meantime, tap the calendar button to tour.");
  assert.equal(r.text, "Apt N is unfurnished. Tap the calendar button to tour.");
});

test("replyStreamer shows nothing live when nothing can be sent, even a full answer", () => {
  let shown = "";
  const feed = replyStreamer({ onDelta: (d) => { shown += d; }, isUsedKey: () => true, canAsk: false });
  feed('{"intent":"question","answered_keys":["fees.application"],"unanswered_questions":[],"reply":"The fee is $50. I\'ve passed your other question to the landlord.');
  assert.equal(shown, "");
});

test("withoutAskClaims catches a long gap before the landlord and \"I'll post their answer\"", () => {
  const r = withoutAskClaims("I'm passing your Early Access request for Apt N with a July 1, 2027 start on to the landlord. I'll post their answer here.");
  assert.equal(r.text, "");
});

// Cases from the PR 478 review.
test("withoutAskClaims cuts a claim even when another part of the sentence is negative", () => {
  for (const [t, want] of [
    ["Parking isn't listed, so I've asked the landlord and will post their answer here.", "Parking isn't listed."],
    ["That isn't listed, so I've passed your question to the landlord.", "That isn't listed."],
    ["I can't confirm the move-in date, but I've asked the landlord about it.", "I can't confirm the move-in date."],
    ["Laundry doesn't come up in the listing, so I've asked the owner.", "Laundry doesn't come up in the listing."],
  ]) assert.deepEqual(withoutAskClaims(t), { text: want, removed: true }, t);
});

test("withoutAskClaims keeps sentences that say nothing was sent", () => {
  for (const t of [
    "This is a test chat, so nothing was sent to the landlord.",
    "Questions can't be sent to the landlord right now.",
    "I'm not able to pass this on to the landlord.",
  ]) assert.deepEqual(withoutAskClaims(t), { text: t, removed: false }, t);
  assert.equal(saysNothingSent("This is a test chat, so nothing was sent to the landlord."), true);
  assert.equal(saysNothingSent("Parking isn't listed, so I've asked the landlord."), false);
});

test("withoutAskClaims cuts \"I've let the landlord know\" claims", () => {
  assert.deepEqual(withoutAskClaims("Thanks! I've let the landlord know you'd like to apply."), { text: "Thanks!", removed: true });
  assert.deepEqual(withoutAskClaims("I'll let the landlord know you're interested."), { text: "", removed: true });
});

test("withoutAskClaims cuts only the claiming clause and keeps the answer", () => {
  for (const [t, want] of [
    ["The application fee is $50, and I've passed your parking question to the landlord.", "The application fee is $50."],
    ["The building is at 6609 Delmar Blvd. I've passed your parking question to the landlord.", "The building is at 6609 Delmar Blvd."],
    ["No. I've asked the landlord about other options.", "No."],
    ["Apt N. I've asked the landlord about it.", "Apt N."],
    ["Pets are allowed; I've asked the landlord about the deposit.", "Pets are allowed."],
  ]) assert.deepEqual(withoutAskClaims(t), { text: want, removed: true }, t);
});

test("withoutAskClaims leaves true sentences about the landlord responding", () => {
  for (const t of [
    "Once they respond to your application, you'll sign the lease online.",
    "It is No. 5 on the second floor.",
  ]) assert.deepEqual(withoutAskClaims(t), { text: t, removed: false }, t);
  assert.equal(withoutAskClaims("Once the landlord replies, you'll see it here.").removed, true);
});

test("withoutAskClaims cuts the whole clarifier pass-on line", () => {
  assert.deepEqual(withoutAskClaims("Thanks, I've passed that on to the landlord and will post their answer here."), { text: "", removed: true });
});

test("withoutAskClaims keeps one honest test-chat line", () => {
  const r = withoutAskClaims("This is a test chat, so nothing was sent to the landlord. I'll pass your question on to the landlord.");
  assert.equal(r.text, "This is a test chat, so nothing was sent to the landlord.");
  assert.equal(saysNothingSent(r.text), true);
});
