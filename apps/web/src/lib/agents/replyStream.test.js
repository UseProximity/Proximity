// node --test apps/web/src/lib/agents/replyStream.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { scanFinalJson, replyStreamer } from "./replyStream.js";

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
  const early = JSON.stringify({ reply: "Yes, pets are allowed.", answered_keys: ["policies.pets"], unanswered_questions: [] });
  const seen = [];
  const feed = replyStreamer({ onDelta: (d) => seen.push(d), isUsedKey: () => true, canAsk: true });
  for (let i = 1; i <= early.length; i++) feed(early.slice(0, i));
  assert.deepEqual(seen, ["Yes, pets are allowed."]);
});
