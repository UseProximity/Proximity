/*
 * Run with: npm test (from apps/web).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildInquiryEmail, stripOwnerGreeting, studentLine, unitLabel } from "./inquiryEmail.js";
import { buildTourCancelledByLandlordEmail, buildTourCancelledEmail, buildTourConfirmedEmail, buildTourRequestEmail } from "./agents/tourEmails.js";
import { extractReplyText } from "./chat/emailReplyText.js";

const CONTACT = /@(?!useproximity\.org)[a-z0-9-]+\.[a-z]{2,}|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/i;

test("the student's words come first, the Proximity details after the -- line", () => {
  const { text } = buildInquiryEmail({
    messages: [{ body: "Is the 2 bed still available?" }],
    signature: "Jordan Lee",
    details: ["Message sent through Proximity (useproximity.org)", "WashU student, class of 2028"],
    reason: "Why you got this.",
  });
  const lines = text.split("\n");
  assert.equal(lines[0], "Is the 2 bed still available?");
  assert.ok(text.indexOf("Jordan Lee") < text.indexOf("\n-- \n"));
  assert.ok(!text.includes("Reply above this line"));
  assert.ok(text.indexOf("Message sent through Proximity") > text.indexOf("\n-- \n"));
});

test("a reminder line sits above the original message", () => {
  const { text } = buildInquiryEmail({ lead: "Reminder, Jordan is still waiting on your reply.", messages: [{ body: "Is parking included?" }], signature: "Jordan Lee" });
  assert.ok(text.startsWith("Reminder, Jordan is still waiting on your reply.\n\nIs parking included?"));
});

test("message text is escaped and keeps its line breaks in HTML", () => {
  const { html } = buildInquiryEmail({ messages: [{ body: "line one\n<b>two</b>" }] });
  assert.match(html, /line one<br>&lt;b&gt;two&lt;\/b&gt;/);
});

test("a landlord's reply above the quoted email comes back clean", () => {
  const { text } = buildInquiryEmail({ messages: [{ body: "Is parking included?" }], signature: "Jordan Lee", details: ["Message sent through Proximity (useproximity.org)"] });
  const quoted = text.split("\n").map((l) => `> ${l}`).join("\n");
  const reply = `Yes, one spot per unit.\n\nOn Tue, Nov 18, 2026 at 3:00 PM Jordan Lee <reply+abc@reply.useproximity.org> wrote:\n${quoted}`;
  assert.equal(extractReplyText({ text: reply, senderName: "Sam Patel" }), "Yes, one spot per unit.");
  // A client that pastes the details without a quote header still stops at the first details line.
  const bare = `Yes, one spot per unit.\n\n${text.slice(text.indexOf("Message sent through"))}`;
  assert.equal(extractReplyText({ text: bare, senderName: "Sam Patel" }), "Yes, one spot per unit.");
});

test("the greeting to the account owner loses the name, nothing else changes", () => {
  assert.equal(stripOwnerGreeting("Hi Yuki, is it available?", "Yuki"), "Hi, is it available?");
  assert.equal(stripOwnerGreeting("hello José! Is it open?", "José"), "hello! Is it open?");
  assert.equal(stripOwnerGreeting("Hi Yukiko, is it available?", "Yuki"), "Hi Yukiko, is it available?");
  assert.equal(stripOwnerGreeting("Is Yuki around?", "Yuki"), "Is Yuki around?");
  assert.equal(stripOwnerGreeting("Hi Yuki", null), "Hi Yuki");
});

test("the unit line uses what is known, and says when rent is per person", () => {
  assert.equal(
    unitLabel({ rent: 1850, unit: { bedrooms: 2, name: "Apt 304", area: 980 } }),
    "2 bed, Apt 304, 980 sq ft, $1,850/month",
  );
  assert.equal(unitLabel({ rent: 900, rent_is_per_person: true, unit: { bedrooms: 3 } }), "3 bed, $900/month per person");
  assert.equal(unitLabel({ rent: null, unit: { bedrooms: 0 } }), "Studio");
  assert.equal(unitLabel({ rent: null, unit: {} }), null);
  assert.equal(unitLabel(null), null);
});

test("the student line never needs more than school and class year", () => {
  assert.equal(studentLine({ school: "WashU", graduationYear: 2028 }), "WashU student, class of 2028");
  assert.equal(studentLine({ school: "WashU" }), "WashU student");
  assert.equal(studentLine({}), "Student");
});

test("a tour request reads like the student asked, and its reminder repeats it", () => {
  const input = {
    firstName: "Jordan", listingLabel: "The Ceylon", unit: { bedrooms: 2 },
    slots: ["Thu, Nov 20, 2 to 5 PM"], details: ["WashU student"], dashboardUrl: "https://useproximity.org/dashboard", canReply: true,
  };
  const req = buildTourRequestEmail(input);
  assert.equal(req.subject, "Tour request for The Ceylon");
  assert.equal(req.fromName, "Jordan");
  assert.ok(req.text.startsWith("Hi, I'd like to tour the 2 bed at The Ceylon. I'm free:\n• Thu, Nov 20, 2 to 5 PM\nCould you let me know a time that works?\n\nJordan\n"));
  assert.equal(buildTourRequestEmail({ ...input, firstName: null }).fromName, "A student");
  const rem = buildTourRequestEmail({ ...input, reminderDay: 1 });
  assert.equal(rem.subject, req.subject);
  assert.ok(rem.text.startsWith("Reminder, a student is still waiting on your reply about touring.\n\nHi, I'd like to tour"));
});

test("tour announcements open with the fact", () => {
  const c = buildTourConfirmedEmail({ studentName: "Jordan Lee", listingLabel: "The Ceylon", unit: { name: "Unit 3B" }, when: "Thu, Nov 20 at 3:00 PM", address: "5700 Waterman Blvd", chatUrl: "https://x", canReply: true });
  assert.ok(c.text.startsWith("Jordan Lee is touring Unit 3B at The Ceylon on Thu, Nov 20 at 3:00 PM.\n5700 Waterman Blvd"));
});

test("a cancellation is in the student's words, with the booked time when there was one", () => {
  const base = { firstName: "Jordan", listingLabel: "The Ceylon", unit: { bedrooms: 2 }, dashboardUrl: "https://x" };
  const booked = buildTourCancelledEmail({ ...base, when: "Thursday 11/20 at 3 PM" });
  assert.ok(booked.text.startsWith("Hi, I need to cancel my tour of the 2 bed at The Ceylon on Thursday 11/20 at 3 PM.\n\nJordan\n"));
  assert.equal(booked.fromName, "Jordan");
  assert.ok(buildTourCancelledEmail(base).text.startsWith("Hi, I need to cancel my tour request for the 2 bed at The Ceylon."));
  const mine = buildTourCancelledByLandlordEmail({ ...base, when: "Thursday 11/20 at 3 PM" });
  assert.ok(mine.text.startsWith("You cancelled Jordan's tour of the 2 bed at The Ceylon on Thursday 11/20 at 3 PM. We let Jordan know."));
});

test("no landlord email carries contact details", () => {
  const all = [
    buildTourRequestEmail({ firstName: "Jordan", listingLabel: "The Ceylon", slots: ["Thu"], dashboardUrl: "https://useproximity.org/d", canReply: true }),
    buildTourConfirmedEmail({ studentName: "Jordan Lee", listingLabel: "The Ceylon", when: "Thu", address: "5700 Waterman Blvd", chatUrl: "https://useproximity.org/c" }),
  ];
  for (const e of all) {
    const body = e.text.replace(/Proximity LLC.*$/m, "");
    assert.doesNotMatch(body, CONTACT);
  }
});
