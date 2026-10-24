/*
 * Run with: npm test (from apps/web).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractReplyText, htmlToPlainText } from "./emailReplyText.js";

const QUOTE = [
  "",
  "On Sat, Oct 24, 2026 at 2:30 PM Jessica via Proximity <info@useproximity.org>",
  "wrote:",
  "",
  "> Reply above this line to message Jessica Nelson.",
  ">",
  "> What's your contact information?",
].join("\n");

test("a reply that is only a phone number is the message, not a signature", () => {
  assert.equal(extractReplyText({ text: `3145550123\n${QUOTE}`, senderName: "Sam Student" }), "3145550123");
  assert.equal(extractReplyText({ text: `(314) 555-0123\n${QUOTE}` }), "(314) 555-0123");
});

test("a signature under a real message is still removed", () => {
  const text = `Sounds good, see you at 3.\n\nJessica Nelson\nLeasing Manager\n(314) 555-0123\n${QUOTE}`;
  assert.equal(extractReplyText({ text, senderName: "Jessica Nelson" }), "Sounds good, see you at 3.");
});

test("a dangling sign-off and signature still go", () => {
  const text = `Yes, it is available.\n\nBest,\nJessica Nelson\njessica@example.com\n${QUOTE}`;
  assert.equal(extractReplyText({ text, senderName: "Jessica Nelson" }), "Yes, it is available.");
});

test("iPhone Mail's footer is removed even though it shares no line break in the source", () => {
  const html =
    '<html><body dir="auto">What\'s your contact information? I can show this to you' +
    '<br id="lineBreakAtBeginningOfSignature"><div dir="ltr">Sent from my iPhone</div>' +
    '<div dir="ltr"><br><blockquote type="cite">On Oct 24, 2026, at 10:37 AM, Sam via Proximity wrote:</blockquote></div></body></html>';
  assert.equal(extractReplyText({ html, senderName: "Vic A" }), "What's your contact information? I can show this to you");
});

test("tags with attributes still break lines", () => {
  assert.equal(htmlToPlainText('one<br class="x">two<div dir="ltr">three</div>').split("\n").filter(Boolean).join("|"), "one|two|three");
});

test("a reply that is only a signature delimiter stays empty", () => {
  assert.equal(extractReplyText({ text: `\n-- \nJessica Nelson\n${QUOTE}` }), "");
});
