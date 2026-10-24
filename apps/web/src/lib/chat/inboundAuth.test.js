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

// Google Workspace, SPF record that forgets Google, no DMARC: the reply lost on 2026-10-24.
const WORKSPACE_SPF_SOFTFAIL = header(
  [
    "spf=softfail (spfCheck: transitioning domain of landlordco.com does not designate 209.85.217.49 as permitted sender) client-ip=209.85.217.49; envelope-from=vic@landlordco.com; helo=mail-vs1-f49.google.com;",
    "dkim=pass header.i=@landlordco-com.20251104.gappssmtp.com;",
    "dmarc=none header.from=landlordco.com;",
  ].join("\n ")
);

test("Google Workspace's default DKIM signature proves its own domain", () => {
  assert.equal(authenticated(WORKSPACE_SPF_SOFTFAIL, "vic@landlordco.com"), true);
});

test("a Workspace signature for one domain does not vouch for another", () => {
  assert.equal(authenticated(WORKSPACE_SPF_SOFTFAIL, "vic@other-co.com"), false);
});

test("only a plain name.tld domain is proven by a Workspace signature, since landlord-co.com and landlord.co.com share one", () => {
  const h = header("spf=softfail; envelope-from=vic@landlord-co.com;\n dkim=pass header.i=@landlord-co-com.20251104.gappssmtp.com;\n dmarc=none header.from=landlord-co.com;");
  assert.equal(authenticated(h, "vic@landlord-co.com"), false);
  assert.equal(authenticated(h, "vic@landlord.co.com"), false);
});

test("a look-alike signing domain is refused", () => {
  const h = header("spf=fail; envelope-from=x@landlordco.com;\n dkim=pass header.i=@landlordco-com.20251104.gappssmtp.com.evil.net;\n dmarc=none header.from=landlordco.com;");
  assert.equal(authenticated(h, "vic@landlordco.com"), false);
});

test("DMARC fail still wins over a Workspace signature", () => {
  const h = header("spf=fail; envelope-from=x@landlordco.com;\n dkim=pass header.i=@landlordco-com.20251104.gappssmtp.com;\n dmarc=fail header.from=landlordco.com;");
  assert.equal(authenticated(h, "vic@landlordco.com"), false);
});
