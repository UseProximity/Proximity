import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mrecFormEligible, sendMrecFormOnce, MREC_FORM_SETTING } from "./mrecForm.js";

const landlord = (extra = {}) => ({
  id: "u1",
  email: "owner@example.com",
  name: "Pat Owner",
  deleted_at: null,
  email_verified: true,
  google_account: false,
  apple_account: false,
  review_sandbox: false,
  roles: { name: "landlord" },
  ...extra,
});

// A stand-in for the service-role client covering the three reads sendMrecFormOnce makes.
function fakeDb({ user = landlord(), form = { key: "billing/mrec-form/x.pdf", fileName: "f.pdf" }, sent = [] } = {}) {
  return {
    from(table) {
      const filters = {};
      const q = {
        select: () => q,
        eq: (col, val) => ((filters[col] = val), q),
        neq: (col, val) => ((filters[`!${col}`] = val), q),
        limit: () => Promise.resolve({ data: sent.filter((r) => r.user_id === filters.user_id && r.status !== filters["!status"]), error: null }),
        maybeSingle: () => {
          if (table === "users") return Promise.resolve({ data: user, error: null });
          if (table === "billing_settings") {
            return Promise.resolve({ data: filters.key === MREC_FORM_SETTING && form ? { value: form } : null, error: null });
          }
          throw new Error(`unexpected table ${table}`);
        },
      };
      return q;
    },
  };
}

function deps() {
  const calls = [];
  return {
    calls,
    deps: {
      readFile: async (key) => ((calls.push(["read", key])), new Uint8Array([37, 80, 68, 70, 45])),
      send: async (args) => calls.push(["send", args.email, args.userId]),
    },
  };
}

describe("mrecFormEligible", () => {
  const as = (u) => ({ ...u, role: u.roles.name });
  it("a verified landlord gets it", () => assert.equal(mrecFormEligible(as(landlord())), true));
  it("a Google or Apple landlord counts as confirmed", () => {
    assert.equal(mrecFormEligible(as(landlord({ email_verified: false, google_account: true }))), true);
    assert.equal(mrecFormEligible(as(landlord({ email_verified: false, apple_account: true }))), true);
  });
  it("not an unverified, student, deleted or review sandbox account", () => {
    assert.equal(mrecFormEligible(as(landlord({ email_verified: false }))), false);
    assert.equal(mrecFormEligible(as(landlord({ roles: { name: "student" } }))), false);
    assert.equal(mrecFormEligible(as(landlord({ deleted_at: "2026-11-01" }))), false);
    assert.equal(mrecFormEligible(as(landlord({ review_sandbox: true }))), false);
  });
});

describe("sendMrecFormOnce", () => {
  it("sends the uploaded form to a new landlord", async () => {
    const d = deps();
    assert.equal(await sendMrecFormOnce(fakeDb(), "u1", { deps: d.deps }), "sent");
    assert.deepEqual(d.calls, [["read", "billing/mrec-form/x.pdf"], ["send", "owner@example.com", "u1"]]);
  });

  it("sends nothing until a form is uploaded", async () => {
    const d = deps();
    assert.equal(await sendMrecFormOnce(fakeDb({ form: null }), "u1", { deps: d.deps }), "no_form");
    assert.equal(d.calls.length, 0);
  });

  it("sends once per account, but again after a failed attempt", async () => {
    const d = deps();
    const done = fakeDb({ sent: [{ user_id: "u1", status: "sent" }] });
    assert.equal(await sendMrecFormOnce(done, "u1", { deps: d.deps }), "already_sent");
    const failed = fakeDb({ sent: [{ user_id: "u1", status: "failed" }] });
    assert.equal(await sendMrecFormOnce(failed, "u1", { deps: d.deps }), "sent");
  });

  it("never throws: a failed send is logged and reported", async () => {
    const boom = { readFile: async () => { throw new Error("R2 down"); }, send: async () => {} };
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(await sendMrecFormOnce(fakeDb(), "u1", { deps: boom }), "error");
    } finally {
      console.error = original;
    }
  });
});
