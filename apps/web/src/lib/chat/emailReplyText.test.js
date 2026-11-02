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

test("a phone number under a lead-in or sign-off is the message, not a signature", () => {
  assert.equal(extractReplyText({ text: `My number is:\n(314) 555-0123\n${QUOTE}` }), "My number is:\n(314) 555-0123");
  assert.equal(extractReplyText({ text: `Thanks,\n3145550123\n${QUOTE}` }), "Thanks,\n3145550123");
  assert.equal(extractReplyText({ text: `Text me here\n\nCell: 314-555-0123\n${QUOTE}` }), "Text me here\n\nCell: 314-555-0123");
  assert.equal(
    extractReplyText({ text: `Here you go:\nJessica Nelson\n(314) 555-0123\n${QUOTE}`, senderName: "Jessica Nelson" }),
    "Here you go:\nJessica Nelson\n(314) 555-0123",
  );
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

test("an Outlook signature with linked labels goes, under a Last, First display name", () => {
  const text = `Cobalt is paintable, yes\n\nWyatt Ogle\n(442) 515-0724 | Portfolio<https://www.wyatt-ogle.com/> | LinkedIn<https://www.linkedin.com/in/wyattogle28/>\n\nFrom: Proxy at Proximity <info@useproximity.org>\nSent: Sunday, November 1, 2026 2:17 PM`;
  assert.equal(extractReplyText({ text, senderName: "Test Landlord", fromName: "Ogle, Wyatt" }), "Cobalt is paintable, yes");
});

test("a name line over a removed signature goes even when no name matches", () => {
  const text = `Thanks! Also, is there a gym in the building?\n\nWyatt Ogle\n(442) 515-0724 | Portfolio<https://www.wyatt-ogle.com/>\n${QUOTE}`;
  assert.equal(extractReplyText({ text, senderName: "Proximity Tester" }), "Thanks! Also, is there a gym in the building?");
});

test("a short last line that is the message itself stays", () => {
  assert.equal(extractReplyText({ text: `Sounds good.\n\nSee You Then\n${QUOTE}`, senderName: "Jessica Nelson" }), "Sounds good.\n\nSee You Then");
});

const ROBERTS = [
  "Thanks for your interest. When are you available to view this property?",
  "When are you looking to move in?",
  "-Andy",
  "",
  "Andrew Roberts",
  "Roberts Realty",
  "3229 S. Brentwood Blvd.",
  "St. Louis, MO 63119-1731",
  "(314) 918-0800",
  "(314) 568-8917 mobile",
  "(314) 918-1127 fax",
  "Listing Site: https://robertsrealtystl.com/",
  "<http://www.robertsrealtycompany.com>",
  "",
  'The information in this electronic mail ("e-mail") message is confidential',
  "and for use of only the named recipient. The information may be protected by",
  "privilege, work product immunity or other applicable law. If you are not the",
  "intended recipient of this e-mail, the retention, dissemination,",
  "distribution or copying of this e-mail message is strictly prohibited. If",
  "you receive this message in error, please notify us immediately by using any",
  "of the above referenced methods of contact.",
].join("\n");

test("a signature under a confidentiality notice goes with the notice", () => {
  assert.equal(
    extractReplyText({ text: `${ROBERTS}\n${QUOTE}`, senderName: "Andy Roberts", senderCompany: "Roberts Realty" }),
    "Thanks for your interest. When are you available to view this property?\nWhen are you looking to move in?\n-Andy",
  );
});

test("phone numbers labelled after the number and labelled links are signature lines", () => {
  const text = `Yes, still open.\n\nRoberts Realty\n(314) 568-8917 mobile\n(314) 918-1127 fax\nListing Site: https://robertsrealtystl.com/\n${QUOTE}`;
  assert.equal(extractReplyText({ text, senderCompany: "Roberts Realty" }), "Yes, still open.");
});

test("a message that mentions confidentiality is not taken for a notice", () => {
  const text = `Please keep my number confidential, I'd rather chat here.\n${QUOTE}`;
  assert.equal(extractReplyText({ text }), "Please keep my number confidential, I'd rather chat here.");
});

test("a link inside the message stays", () => {
  const text = `Here's the application: https://example.com/apply\nLet me know once it's in.\n${QUOTE}`;
  assert.equal(extractReplyText({ text }), "Here's the application: https://example.com/apply\nLet me know once it's in.");
});
