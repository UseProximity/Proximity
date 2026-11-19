/*
 * Run with: npm test (from apps/web).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractReplyText, fromLeasingAssistant, htmlToPlainText } from "./emailReplyText.js";

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

test("a sign-off and the name under it stay, the signature below goes", () => {
  const text = `Yes, it is available.\n\nBest,\nJessica Nelson\njessica@example.com\n${QUOTE}`;
  assert.equal(extractReplyText({ text, senderName: "Jessica Nelson" }), "Yes, it is available.\n\nBest,\nJessica Nelson");
});

test("a dangling sign-off with nothing under it still goes", () => {
  assert.equal(extractReplyText({ text: `Yes, it is available.\n\nBest,\n${QUOTE}` }), "Yes, it is available.");
});

// Clock Tower's Gmail signature, as its plain-text part arrives (2026-11-18).
const CLOCK_TOWER_SIG = [
  "*Clock Tower Company*",
  "*ClockTowerCompany.com <http://clocktowercompany.com/> - Apply Here",
  "<https://clocktowercompany.com/pages/apply>*",
  "6631 Delmar Blvd, University City, MO 63130",
  "Text: (586) 666-1217",
].join("\n");

test("a signer who is not the account holder keeps their sign-off and name", () => {
  const text = `Hi Lea,\n\nPlease text us to schedule a tour at (586) 666-1217.\n\nThanks,\nAddison\n${CLOCK_TOWER_SIG}\n${QUOTE}`;
  assert.equal(
    extractReplyText({ text, senderName: "Isabella Rossato" }),
    "Hi Lea,\n\nPlease text us to schedule a tour at (586) 666-1217.\n\nThanks,\nAddison",
  );
});

test("a bold name and company block over a signature goes with it", () => {
  const text = `Hi Lea,\n\nAre you still interested in housing for next year?\n\n*Addison Witte*\n${CLOCK_TOWER_SIG}\n${QUOTE}`;
  assert.equal(extractReplyText({ text, senderName: "Isabella Rossato" }), "Hi Lea,\n\nAre you still interested in housing for next year?");
});

test("a bolded company line straight under the message goes with the signature", () => {
  const text = `Good luck!\n\nO-THREE - 6603 UNIVERSITY DRIVE - $1,400/Bedroom NONE Available\n${CLOCK_TOWER_SIG}\n${QUOTE}`;
  assert.equal(extractReplyText({ text }), "Good luck!\n\nO-THREE - 6603 UNIVERSITY DRIVE - $1,400/Bedroom NONE Available");
});

test("more message under a sign-off and name is never cut", () => {
  const text = `Sounds good.\n\nThanks,\nAddison\n\nAlso, parking is $50 a month.\n(586) 666-1217\n${QUOTE}`;
  assert.equal(extractReplyText({ text, senderName: "Isabella Rossato" }), "Sounds good.\n\nThanks,\nAddison\n\nAlso, parking is $50 a month.\n(586) 666-1217");
  const link = `Sounds good.\n\nThanks,\nAddison\n\nHere is the application:\nclocktowercompany.com/pages/apply\n${QUOTE}`;
  assert.equal(extractReplyText({ text: link, senderName: "Isabella Rossato" }), "Sounds good.\n\nThanks,\nAddison\n\nHere is the application:\nclocktowercompany.com/pages/apply");
});

test("a number given as the answer under a sign-off and name stays", () => {
  const text = `Sure, here it is.\n\nThanks,\nAddison\n(586) 666-1217\n${QUOTE}`;
  assert.equal(extractReplyText({ text, senderName: "Isabella Rossato" }), "Sure, here it is.\n\nThanks,\nAddison\n(586) 666-1217");
});

test("a link with a few words after it is the message, a button label is signature", () => {
  assert.equal(extractReplyText({ text: `Apply here:\nclocktowercompany.com - takes 5 min\n${QUOTE}` }), "Apply here:\nclocktowercompany.com - takes 5 min");
  assert.equal(extractReplyText({ text: `You can see more photos there.\nzillow.com - check it out\n${QUOTE}` }), "You can see more photos there.\nzillow.com - check it out");
});

test("a P.S. under a sign-off is never cut", () => {
  const text = `See you then.\n\nThanks,\nAddison\n\nP.S. Bring a photo ID.\n${QUOTE}`;
  assert.equal(extractReplyText({ text }), "See you then.\n\nThanks,\nAddison\n\nP.S. Bring a photo ID.");
});

test("a reply that is only a labelled Text: number is the message", () => {
  assert.equal(extractReplyText({ text: `Text: (586) 666-1217\n${QUOTE}` }), "Text: (586) 666-1217");
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

// An EliseAI reply as it arrived on 2026-11-17 (CRLF line ends, a zero-width
// no-break space after the name), with the unsubscribe token replaced.
const ELISE_BODY = [
  "Hi Wyatt,",
  "",
  "Thanks for your interest in our homes at Kingsbury. We are offering in-person agent-led tours of our community.",
  "",
  "Which layout and budget are you considering?",
  "",
  "",
  "Riley﻿",
  "",
  "Virtual Leasing Assistant",
  "",
  "Mac Properties",
  "",
  "",
  "",
  "",
  'To opt-out of emails reply "Unsubscribe" or use this link UNSUBSCRIBE<https://app.meetelise.com/unsubscribe?stateId=TOKEN>.',
  "",
  "By replying you consent to this Privacy Policy<https://www.eliseai.com/policy>. Replies may be human and/or AI generated. Emails are collected and recorded by a third party. Mac 501 and 525 Clara Avenue St. Louis, MO 63112",
  "",
].join("\r\n");
const ELISE_MESSAGE = [
  "Hi Wyatt,",
  "",
  "Thanks for your interest in our homes at Kingsbury. We are offering in-person agent-led tours of our community.",
  "",
  "Which layout and budget are you considering?",
].join("\n");

test("a leasing assistant's legal footer and signature go", () => {
  assert.equal(extractReplyText({ text: ELISE_BODY, senderName: "Yuki Wang", fromName: "Riley" }), ELISE_MESSAGE);
});

test("a leasing assistant is recognised by its footer, a person is not", () => {
  assert.equal(fromLeasingAssistant({ text: ELISE_BODY }), true);
  assert.equal(fromLeasingAssistant({ text: `Sounds good, see you at 3.\n\nJessica Nelson\n${QUOTE}` }), false);
});

test("a reply that is only an opt-out sentence is kept", () => {
  const text = 'To opt-out of emails reply "Unsubscribe".';
  assert.equal(extractReplyText({ text, senderName: "Yuki Wang" }), text);
});

test("a sentence that mentions a company is not taken for a company line", () => {
  const text = "Yes, that unit is still open.\n\nWe are managed by Mac Properties";
  assert.equal(extractReplyText({ text, senderName: "Yuki Wang" }), text);
});
