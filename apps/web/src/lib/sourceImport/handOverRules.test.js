import { test } from "node:test";
import assert from "node:assert/strict";
import { contactPatch, handOverCandidates, refusal } from "./handOverRules.js";

const team = { name: "Proximity Team", email: "Team@UseProximity.org", phone: "(314) 555-0100" };
const landlord = { name: "Mills Properties", email: "leasing@mills.example", phone: "314-555-0199" };

test("contact details that are still the importer's pass to the landlord", () => {
  assert.deepEqual(
    contactPatch({ contact_email: "team@useproximity.org", contact_name: "Proximity Team", contact_phone: "3145550100" }, team, landlord),
    { contact_email: landlord.email, contact_name: landlord.name, contact_phone: landlord.phone }
  );
});

test("contact details read from the website, or typed in, are kept", () => {
  assert.deepEqual(contactPatch({ contact_email: "office@everly.example", contact_name: "Everly Leasing", contact_phone: "314-555-0142" }, team, landlord), {});
  // Only the field that matches moves.
  assert.deepEqual(contactPatch({ contact_email: "office@everly.example", contact_name: "proximity team", contact_phone: null }, team, landlord), { contact_name: landlord.name });
});

test("an importer with no phone never matches an empty phone", () => {
  assert.deepEqual(contactPatch({ contact_email: null, contact_name: null, contact_phone: null }, { name: null, email: null, phone: null }, landlord), {});
});

test("only finished drafts this import created are candidates", () => {
  const jobs = [
    { id: "a", status: "done", listing_id: "L1", target: {} },
    { id: "b", status: "running", listing_id: "L2", target: {} },
    { id: "c", status: "done", listing_id: "L3", target: { alreadyListed: { id: "L3", mine: "owner" } } },
    { id: "d", status: "done", listing_id: "L1", target: { sync: true } },
    { id: "e", status: "cancelled", listing_id: null, target: { cancelMarker: true } },
    { id: "f", status: "done", listing_id: "L1", target: {} },
    { id: "g", status: "failed", listing_id: "L4", target: {} },
  ];
  assert.deepEqual(handOverCandidates(jobs).map((j) => j.id), ["a"]);
});

test("a draft is refused when it is live, gone, shared or already moved", () => {
  const draft = { published_at: null, deleted_at: null };
  const ids = { fromId: "team", toId: "landlord" };
  assert.equal(refusal({ listing: draft, ownerIds: ["team"], ...ids }), null);
  assert.match(refusal({ listing: null, ownerIds: ["team"], ...ids }), /no longer exists/);
  assert.match(refusal({ listing: { ...draft, deleted_at: "2026-11-15" }, ownerIds: ["team"], ...ids }), /no longer exists/);
  assert.match(refusal({ listing: { ...draft, published_at: "2026-11-15" }, ownerIds: ["team"], ...ids }), /published/);
  assert.match(refusal({ listing: draft, ownerIds: ["landlord"], ...ids }), /Already theirs/);
  assert.match(refusal({ listing: draft, ownerIds: ["other"], ...ids }), /No longer owned/);
  assert.match(refusal({ listing: draft, ownerIds: ["team", "other"], ...ids }), /Someone else/);
});
