/*
 * Run with: npm test (from apps/web).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { decisionFrom, domainApprovable, patternFor, patternMatches } from "./replySenders.js";

test("an address approves only itself, a domain approves everyone there", () => {
  assert.equal(patternFor("Vic@RevivalSTL.com", "address"), "vic@revivalstl.com");
  assert.equal(patternFor("vic@revivalstl.com", "domain"), "@revivalstl.com");
  assert.equal(patternMatches("vic@revivalstl.com", "VIC@revivalstl.com"), true);
  assert.equal(patternMatches("vic@revivalstl.com", "amy@revivalstl.com"), false);
  assert.equal(patternMatches("@revivalstl.com", "amy@revivalstl.com"), true);
  assert.equal(patternMatches("@revivalstl.com", "amy@notrevivalstl.com"), false);
  assert.equal(patternMatches("@revivalstl.com", "amy@mail.revivalstl.com"), false);
});

test("shared mail domains can only be approved one address at a time", () => {
  assert.equal(domainApprovable("someone@gmail.com"), false);
  assert.equal(domainApprovable("student@wustl.edu"), false);
  assert.equal(patternFor("someone@gmail.com", "domain"), null);
  assert.equal(patternFor("someone@gmail.com", "address"), "someone@gmail.com");
  assert.equal(domainApprovable("vic@revivalstl.com"), true);
});

test("garbage is never a pattern", () => {
  assert.equal(patternFor("not an email", "address"), null);
  assert.equal(patternFor("", "domain"), null);
  assert.equal(patternMatches("@revivalstl.com", "not an email"), false);
});

test("a decline on the address beats an approved domain", () => {
  const rows = [
    { pattern: "@revivalstl.com", decision: "approved" },
    { pattern: "mallory@revivalstl.com", decision: "declined" },
  ];
  assert.equal(decisionFrom(rows, "vic@revivalstl.com"), "approved");
  assert.equal(decisionFrom(rows, "mallory@revivalstl.com"), "declined");
  assert.equal(decisionFrom(rows, "vic@other.com"), null);
});

test("no rows means nobody has decided", () => {
  assert.equal(decisionFrom([], "vic@revivalstl.com"), null);
});
