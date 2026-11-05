/*
 * Run with: npm test (from apps/web).
 *
 * The license disclosure rules: what a landlord must give before signing, the
 * phone format, and that the public "Listed by" shape never carries the license
 * number.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanDisclosure, formatUsPhone, toListedBy } from "./licenseDisclosure.js";

const licensee = {
  isLicensee: true,
  agentName: "  Jane   Smith ",
  companyName: "West End Management",
  companyPhone: "314.494.2393",
  licenseNumber: "2001234567",
  ownerAgreementConfirmed: true,
};

describe("formatUsPhone", () => {
  it("formats 10 digits and drops a leading 1", () => {
    assert.equal(formatUsPhone("3144942393"), "(314) 494-2393");
    assert.equal(formatUsPhone("+1 (314) 494-2393"), "(314) 494-2393");
  });
  it("refuses anything else", () => {
    assert.equal(formatUsPhone("494-2393"), null);
    assert.equal(formatUsPhone(""), null);
    assert.equal(formatUsPhone("2 314 494 2393"), null);
  });
});

describe("cleanDisclosure", () => {
  it("requires an answer", () => {
    assert.throws(() => cleanDisclosure(null), { code: "license_disclosure_required" });
    assert.throws(() => cleanDisclosure({}), { code: "license_disclosure_required" });
  });
  it("needs the confirmation for not licensed, and stores nothing else", () => {
    assert.throws(() => cleanDisclosure({ isLicensee: false }), { code: "license_disclosure_invalid" });
    const row = cleanDisclosure({ isLicensee: false, notLicensedConfirmed: true, agentName: "ignored" });
    assert.equal(row.is_licensee, false);
    assert.equal(row.agent_name, null);
    assert.equal(row.license_number, null);
  });
  it("cleans a complete licensee answer", () => {
    const row = cleanDisclosure(licensee);
    assert.equal(row.agent_name, "Jane Smith");
    assert.equal(row.company_phone, "(314) 494-2393");
    assert.equal(row.owner_agreement_confirmed, true);
  });
  it("refuses a licensee answer with anything missing", () => {
    for (const key of ["agentName", "companyName", "companyPhone", "licenseNumber"]) {
      assert.throws(() => cleanDisclosure({ ...licensee, [key]: " " }), { code: "license_disclosure_invalid" }, key);
    }
    assert.throws(() => cleanDisclosure({ ...licensee, ownerAgreementConfirmed: false }), { code: "license_disclosure_invalid" });
    assert.throws(() => cleanDisclosure({ ...licensee, companyPhone: "12345" }), /10 digit/);
  });
});

describe("toListedBy", () => {
  it("shows name, company and phone for a licensee, never the license number", () => {
    const listed = toListedBy(cleanDisclosure(licensee));
    assert.deepEqual(listed, { agentName: "Jane Smith", companyName: "West End Management", companyPhone: "(314) 494-2393" });
  });
  it("shows nothing for a landlord who is not licensed", () => {
    assert.equal(toListedBy(cleanDisclosure({ isLicensee: false, notLicensedConfirmed: true })), null);
    assert.equal(toListedBy(null), null);
  });
});
