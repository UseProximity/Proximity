/*
 * Run with: npm test (from apps/web). The headers are copied from real SES
 * receipts, with the sender's domain swapped for a placeholder.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { authenticated } from "./inboundAuth.js";

const header = (results) => [{ key: "authentication-results", line: `Authentication-Results: amazonses.com;\n ${results}` }];

// Google Workspace without a DMARC record or custom DKIM key: the reply that was lost on 2026-10-20.
const WORKSPACE_NO_DMARC = header(
  [
    "spf=pass (spfCheck: domain of landlord-co.com designates 209.85.167.171 as permitted sender) client-ip=209.85.167.171; envelope-from=leasing@landlord-co.com; helo=mail-oi1-f171.google.com;",
    "dkim=pass header.i=@landlord-co-com.20251104.gappssmtp.com;",
    "dmarc=none header.from=landlord-co.com;",
  ].join("\n ")
);

test("SPF pass for the From domain, read from SES's envelope-from, is accepted", () => {
  assert.equal(authenticated(WORKSPACE_NO_DMARC, "leasing@landlord-co.com"), true);
});

test("the same receipt does not vouch for a different From domain", () => {
  assert.equal(authenticated(WORKSPACE_NO_DMARC, "leasing@someone-else.com"), false);
});

test("SPF pass for an unrelated envelope domain is refused", () => {
  const h = header(
    "spf=pass (spfCheck: ok) client-ip=1.2.3.4; envelope-from=bounce@mailer.example.net; helo=x;\n dkim=none;\n dmarc=none header.from=landlord-co.com;"
  );
  assert.equal(authenticated(h, "leasing@landlord-co.com"), false);
});

test("SPF fail with no aligned DKIM is refused", () => {
  const h = header(
    "spf=fail (spfCheck: not permitted) client-ip=1.2.3.4; envelope-from=leasing@landlord-co.com; helo=x;\n dkim=none;\n dmarc=none header.from=landlord-co.com;"
  );
  assert.equal(authenticated(h, "leasing@landlord-co.com"), false);
});

test("DMARC fail is refused even with an aligned SPF pass", () => {
  const h = header(
    "spf=pass (spfCheck: ok) client-ip=1.2.3.4; envelope-from=leasing@landlord-co.com; helo=x;\n dkim=fail header.i=@landlord-co.com;\n dmarc=fail header.from=landlord-co.com;"
  );
  assert.equal(authenticated(h, "leasing@landlord-co.com"), false);
});

test("DMARC pass is accepted", () => {
  const h = header(
    "spf=pass (spfCheck: ok) client-ip=1.2.3.4; envelope-from=bounce@sendgrid.net; helo=x;\n dkim=pass header.i=@gmail.com;\n dmarc=pass header.from=gmail.com;"
  );
  assert.equal(authenticated(h, "student@gmail.com"), true);
});

test("an aligned DKIM pass is accepted without DMARC", () => {
  const h = header(
    "spf=softfail (spfCheck: no) client-ip=1.2.3.4; envelope-from=bounce@mailer.example.net; helo=x;\n dkim=pass header.i=@landlord-co.com;\n dmarc=none header.from=landlord-co.com;"
  );
  assert.equal(authenticated(h, "leasing@landlord-co.com"), true);
});

test("the RFC smtp.mailfrom spelling still works", () => {
  const h = header("spf=pass smtp.mailfrom=leasing@landlord-co.com;\n dmarc=none header.from=landlord-co.com;");
  assert.equal(authenticated(h, "leasing@landlord-co.com"), true);
});

test("a header from anyone but SES is ignored", () => {
  const h = [{ key: "authentication-results", line: "Authentication-Results: evil.example; dmarc=pass header.from=landlord-co.com;" }];
  assert.equal(authenticated(h, "leasing@landlord-co.com"), false);
});
