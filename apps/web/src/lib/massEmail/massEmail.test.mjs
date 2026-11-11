import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bodyToHtml, bodyToText, buttonFor, mergeValues, renderMassEmail, safeHref, unknownMergeFields, wantsSetupLink } from "./render.js";
import { skipReason } from "./audience.js";
import { cleanVersion, DEFAULT_FOOTER_REASON } from "./templates.js";
import { suggestFor } from "./unowned.js";
import { deliveryStatus } from "./history.js";
import { signUnsubscribeToken, unsubscribeHeaders, unsubscribePageUrl, verifyUnsubscribeToken } from "./unsubscribe.js";
import { emailFooter, emailFooterText } from "../emailFooter.js";

process.env.AUTH_SECRET ||= "test-secret";

const BASE = "https://useproximity.org";

describe("render", () => {
  it("fills merge fields, with fallbacks for missing values", () => {
    assert.deepEqual(mergeValues({ name: "Mimi Mackey", email: "m@x.com", company: null }), {
      first_name: "Mimi", name: "Mimi Mackey", email: "m@x.com", company: "your company",
    });
    assert.equal(mergeValues({}).first_name, "there");
  });

  it("escapes everything before formatting, so nothing injects markup", () => {
    const html = bodyToHtml("Hi {{name}} <script>x</script> **bold**", { name: "<b>Eve</b>" }, BASE);
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("<b>Eve</b>"));
    assert.ok(html.includes("&lt;b&gt;Eve&lt;/b&gt;"));
    assert.ok(html.includes("<strong>bold</strong>"));
  });

  it("builds paragraphs, bullets and headings", () => {
    const html = bodyToHtml("One\ntwo\n\n- a\n- b\n\n## Next\nThree", {}, BASE);
    assert.match(html, /<p>One<br>two<\/p>/);
    assert.match(html, /<ul[^>]*><li>a<\/li><li>b<\/li><\/ul>/);
    assert.match(html, /font-weight:600[^>]*>Next<\/p>/);
    assert.match(html, /<p>Three<\/p>/);
  });

  it("links site paths and https, refuses javascript:", () => {
    const html = bodyToHtml("[Billing](/dashboard/landlord?tab=billing&x=1) [bad](javascript:alert(1))", {}, BASE);
    assert.ok(html.includes('href="https://useproximity.org/dashboard/landlord?tab=billing&amp;x=1"'));
    assert.ok(!html.includes("javascript:"));
    assert.equal(safeHref("//evil.com", BASE), null);
    assert.equal(safeHref("mailto:info@useproximity.org", BASE), "mailto:info@useproximity.org");
  });

  it("flags unknown merge fields", () => {
    assert.deepEqual(unknownMergeFields("Hi {{frist_name}} {{name}}"), ["frist_name"]);
  });

  it("swaps the button for a set-password link when given one", () => {
    const v = { button_target: "billing", button_label: "Open Billing" };
    assert.deepEqual(buttonFor(v, { baseUrl: BASE }), { href: `${BASE}/dashboard/landlord?tab=billing`, label: "Open Billing", setup: false });
    assert.equal(buttonFor(v, { baseUrl: BASE, setupUrl: "https://x/reset" }).label, "Set your password");
    assert.equal(buttonFor({ button_target: "none" }, { baseUrl: BASE }), null);
  });

  it("renders a one-line subject with fields filled", () => {
    const out = renderMassEmail({ subject: "Hi {{first_name}}\nthere", body: "x", button_target: "none" }, { name: "Jo Lee" }, { baseUrl: BASE });
    assert.equal(out.subject, "Hi Jo there");
  });
});

describe("cleanVersion", () => {
  const ok = { subject: "S", body: "B", buttonTarget: "billing", buttonLabel: "Go" };
  it("accepts a normal version and fills the footer", () => {
    const v = cleanVersion(ok);
    assert.equal(v.button_target, "billing");
    assert.equal(v.footer_reason, DEFAULT_FOOTER_REASON);
    assert.deepEqual(v.attachments, []);
  });
  it("requires subject, body and a button label", () => {
    assert.throws(() => cleanVersion({ ...ok, subject: " " }), /subject/);
    assert.throws(() => cleanVersion({ ...ok, body: "" }), /Write the email/);
    assert.throws(() => cleanVersion({ ...ok, buttonLabel: "" }), /button/);
  });
  it("refuses unsafe custom links, unknown fields and foreign attachment keys", () => {
    assert.throws(() => cleanVersion({ ...ok, buttonTarget: "custom", buttonUrl: "javascript:alert(1)" }), /link/);
    assert.throws(() => cleanVersion({ ...ok, body: "{{nmae}}" }), /Unknown field/);
    assert.throws(() => cleanVersion({ ...ok, attachments: [{ kind: "file", key: "billing/agreements/x.pdf" }] }), /attachments/);
    const v = cleanVersion({ ...ok, attachments: [{ kind: "mrec" }, { kind: "mrec" }] });
    assert.deepEqual(v.attachments, [{ kind: "mrec" }]);
  });
});

describe("suggestFor", () => {
  const landlord = { id: "u1", name: "Mimi", roles: { name: "landlord" } };
  const student = { id: "u2", name: "Rex", roles: { name: "student" } };
  it("attaches to a live landlord with that email", () => {
    assert.equal(suggestFor({ email: "m@x.com", matches: [landlord] }).action, "attach");
  });
  it("skips student subleases", () => {
    assert.equal(suggestFor({ email: "r@x.com", matches: [student] }).action, "skip");
    assert.equal(suggestFor({ email: null, leases: [{ sublease: true }] }).action, "skip");
    // A student subletting under a landlord account is still skipped.
    assert.equal(suggestFor({ email: "e@x.com", matches: [landlord], leases: [{ sublease: true }] }).action, "skip");
    assert.equal(suggestFor({ email: "m@x.com", matches: [landlord], leases: [{ sublease: false }, { sublease: true }] }).action, "attach");
  });
  it("invites a contact nobody has, and leaves the rest to a person", () => {
    assert.equal(suggestFor({ email: "new@x.com" }).action, "invite");
    assert.equal(suggestFor({ email: null }).action, "manual");
    assert.equal(suggestFor({ email: "d@x.com", matches: [{ ...landlord, deleted_at: "2026-01-01" }] }).action, "manual");
  });
});

describe("deliveryStatus", () => {
  it("prefers the SES report for sent emails only", () => {
    assert.equal(deliveryStatus({ status: "sent" }, { status: "delivered" }), "delivered");
    assert.equal(deliveryStatus({ status: "sent" }, { status: "sent" }), "sent");
    assert.equal(deliveryStatus({ status: "failed" }, { status: "delivered" }), "failed");
    assert.equal(deliveryStatus({ status: "redirected" }, null), "redirected");
  });
});

describe("who a send skips (review of 2026-11-07)", () => {
  const none = new Set();
  const base = { reached: none, sentInBatch: none, suppressed: none, batchId: null, repeatGuardHours: 6 };
  const u = { id: "u1", email: "Lee@Example.com " };

  it("skips an address that bounced or marked us as spam, whatever its case", () => {
    assert.match(skipReason(u, { ...base, suppressed: new Set(["lee@example.com"]) }), /bounced or marked/);
    assert.equal(skipReason(u, base), null);
  });

  it("skips someone who unsubscribed, whatever its case", () => {
    assert.match(skipReason(u, { ...base, unsubscribed: new Set(["lee@example.com"]) }), /unsubscribed/);
  });

  it("skips someone this batch already reached, even when sending again", () => {
    assert.equal(skipReason(u, { ...base, sentInBatch: new Set(["u1"]), batchId: "b1" }), "already sent in this batch");
    assert.match(skipReason(u, { ...base, sentInBatch: new Set(["u1"]) }), /last 6 hours/);
  });

  it("only an email with a button mints a set-password link", () => {
    const noLogin = { password_hash: null, google_account: null, apple_account: null };
    const withButton = { button_target: "billing", button_label: "Open Billing" };
    const noButton = { button_target: "none", button_label: "" };
    assert.equal(wantsSetupLink(noLogin, withButton, { baseUrl: "https://x" }), true);
    assert.equal(wantsSetupLink(noLogin, noButton, { baseUrl: "https://x" }), false, "would cancel an earlier email's link");
    assert.equal(wantsSetupLink({ ...noLogin, password_hash: "h" }, withButton, { baseUrl: "https://x" }), false);
  });
});

describe("unsubscribe (2026-11-08)", () => {
  it("a token names its address and survives a round trip", () => {
    assert.equal(verifyUnsubscribeToken(signUnsubscribeToken(" Lee@Example.com")), "lee@example.com");
  });

  it("refuses a tampered, forged or empty token", () => {
    const [payload, sig] = signUnsubscribeToken("lee@example.com").split(".");
    const other = Buffer.from(JSON.stringify({ p: "mass-unsub", e: "someone@else.com" })).toString("base64url");
    assert.equal(verifyUnsubscribeToken(`${other}.${sig}`), null);
    assert.equal(verifyUnsubscribeToken(`${payload}.x${sig.slice(1)}`), null);
    assert.equal(verifyUnsubscribeToken(""), null);
    assert.equal(verifyUnsubscribeToken(null), null);
  });

  it("builds the page link and the one-click headers", () => {
    assert.match(unsubscribePageUrl("lee@example.com", "https://useproximity.org/"), /^https:\/\/useproximity\.org\/unsubscribe\?t=[\w-]+\.[\w-]+$/);
    const h = unsubscribeHeaders("lee@example.com", "https://useproximity.org", "info@useproximity.org");
    assert.match(h["List-Unsubscribe"], /^<https:\/\/useproximity\.org\/api\/unsubscribe\?t=[^>]+>, <mailto:info@useproximity\.org\?subject=unsubscribe>$/);
    assert.equal(h["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  });

  it("the footer carries the link in both parts", () => {
    const url = "https://useproximity.org/unsubscribe?t=a.b";
    assert.match(emailFooter({ reason: "Why", unsubscribeUrl: url }), /href="https:\/\/useproximity\.org\/unsubscribe\?t=a\.b"[^>]*>Unsubscribe<\/a>/);
    assert.ok(!emailFooter({ reason: "Why", unsubscribeUrl: url, commercial: true }).includes("Reply to this email"));
    assert.match(emailFooterText({ reason: "Why", unsubscribeUrl: url }), /Unsubscribe: https:\/\/useproximity\.org\/unsubscribe\?t=a\.b/);
  });

  it("the email has a plain-text part with links spelled out", () => {
    const text = bodyToText("## Hi {{first_name}}\n**Bold** and [Billing](/dashboard/landlord?tab=billing)", { first_name: "Lee" }, BASE);
    assert.equal(text, "Hi Lee\nBold and Billing (https://useproximity.org/dashboard/landlord?tab=billing)");
    const out = renderMassEmail(
      { subject: "S", body: "Hello", button_target: "billing", button_label: "Open Billing" },
      { name: "Lee" },
      { baseUrl: BASE, footerText: "--\nfooter" }
    );
    assert.equal(out.text, "Hello\n\nOpen Billing: https://useproximity.org/dashboard/landlord?tab=billing\n\n--\nfooter");
  });
});
