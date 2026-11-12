/*
 * Run with: npm test (from apps/web).
 *
 * The license disclosure rules: what a landlord must give before signing, the
 * phone format, and that the public "Listed by" shape never carries the license
 * number.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanDisclosure, formatUsPhone, listedByForListing, pickListedBy, toListedBy } from "./licenseDisclosure.js";

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

describe("pickListedBy (whoever signed for the listing, Wyatt 2026-11-10)", () => {
  const signer = { agentName: "Owner Agent", companyName: "Owner Realty", companyPhone: "(314) 555-0101" };
  const landlord = { agentName: "PM Agent", companyName: "PM Co", companyPhone: "(314) 555-0202" };
  it("shows the signer's details when their agreement covers the listing", () => {
    const out = pickListedBy(["L"], new Map([["L", "S"]]), new Map([["S", signer], ["L", landlord]]));
    assert.deepEqual(out.get("L"), signer);
  });
  it("falls back to the landlord when the signer is not a licensee", () => {
    const out = pickListedBy(["L"], new Map([["L", "S"]]), new Map([["L", landlord]]));
    assert.deepEqual(out.get("L"), landlord);
  });
  it("shows the landlord's when no signer covers the listing yet", () => {
    const out = pickListedBy(["L"], new Map(), new Map([["S", signer], ["L", landlord]]));
    assert.deepEqual(out.get("L"), landlord);
  });
  it("shows nothing when neither is a licensee", () => {
    assert.equal(pickListedBy(["L"], new Map([["L", "S"]]), new Map()).has("L"), false);
  });
  it("picks per landlord on a shared building", () => {
    const out = pickListedBy(["L", "M"], new Map([["L", "S"]]), new Map([["S", signer], ["M", landlord]]));
    assert.deepEqual(out.get("L"), signer);
    assert.deepEqual(out.get("M"), landlord);
  });
});

// A tiny stand-in for the Supabase client: filters rows by eq / in / is.
function fakeDb(tables) {
  return {
    from(name) {
      let rows = [...(tables[name] ?? [])];
      const q = {
        select: () => q,
        eq: (c, v) => ((rows = rows.filter((r) => r[c] === v)), q),
        in: (c, vs) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
        is: (c, v) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), q),
        then: (res) => res({ data: rows, error: null }),
      };
      return q;
    },
  };
}

describe("listedByForListing", () => {
  const lic = (user_id, agent_name) => ({ user_id, is_licensee: true, agent_name, company_name: "Co", company_phone: "(314) 555-0100" });
  const base = {
    billing_payers: [{ landlord_id: "L", payer_id: "S", listing_id: null, status: "active" }],
    landlord_agreements: [{ id: "A", user_id: "S", status: "signed" }],
    agreement_coverage: [{ user_id: "L", listing_id: "X", agreement_id: "A", status: "covered" }],
    landlord_license_disclosures: [lic("S", "Signer"), lic("L", "Landlord")],
  };
  it("uses the signer on a listing their signed agreement covers", async () => {
    assert.equal((await listedByForListing(fakeDb(base), "X", ["L"])).get("L").agentName, "Signer");
  });
  it("uses the landlord on a listing the signer has not covered", async () => {
    assert.equal((await listedByForListing(fakeDb(base), "Y", ["L"])).get("L").agentName, "Landlord");
  });
  it("uses the landlord once the signer's agreement is voided", async () => {
    const db = fakeDb({ ...base, landlord_agreements: [{ id: "A", user_id: "S", status: "voided" }] });
    assert.equal((await listedByForListing(db, "X", ["L"])).get("L").agentName, "Landlord");
  });
  it("uses the landlord once the signer is revoked", async () => {
    const db = fakeDb({ ...base, billing_payers: [{ landlord_id: "L", payer_id: "S", listing_id: null, status: "ended" }] });
    assert.equal((await listedByForListing(db, "X", ["L"])).get("L").agentName, "Landlord");
  });
  it("falls back to the landlord when the signer is not a licensee", async () => {
    const db = fakeDb({ ...base, landlord_license_disclosures: [lic("L", "Landlord")] });
    assert.equal((await listedByForListing(db, "X", ["L"])).get("L").agentName, "Landlord");
  });
});
