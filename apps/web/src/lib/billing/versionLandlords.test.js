/*
 * A custom agreement version for a chosen set of landlords, changeable after
 * upload (Wyatt, 2026-11-22): agreementVersions.uploadVersion / publishVersion /
 * setVersionLandlords and versionLandlords.landlordFlags / cancelOpenCopies,
 * against the in-memory database in billingFakes.testutil.js.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { addCustomVersion, fakeDb, fakeDocumenso } from "./billingFakes.testutil.js";
import { getLiveVersion, publishVersion, setVersionLandlords, uploadVersion, versionLandlordRows } from "./agreementVersions.js";
import { cancelOpenCopies, landlordFlags } from "./versionLandlords.js";

const STANDARD = { id: "vstd", label: "November 2026", kind: "master", audience: "everyone", status: "live", published_at: "2026-11-01T00:00:00Z" };
const users = () => [
  { id: "jess", name: "Jessica Nelson", email: "j@example.com" },
  { id: "vic", name: "Victor Alston", email: "v@example.com" },
  { id: "pat", name: "Pat Landlord", email: "p@example.com" },
];

function world() {
  return fakeDb({ users: users(), agreement_versions: [{ ...STANDARD }], agreement_version_landlords: [], landlord_agreements: [], agreement_amendments: [], billing_payers: [] });
}

async function blankPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return pdf.save();
}

const documensoForUpload = () => ({ createTemplate: async () => `tpl_${Math.random().toString(36).slice(2)}`, getEnvelope: async (id) => ({ id }) });

async function upload(db, extra = {}) {
  return uploadVersion(db, documensoForUpload(), {
    adminId: "admin",
    label: "November 2026",
    fileName: "custom.pdf",
    bytes: await blankPdf(),
    storePdf: async () => "billing/versions/custom.pdf",
    ...extra,
  });
}

const ready = (db, id) => {
  db.tables.agreement_versions.find((v) => v.id === id).status = "ready";
};

describe("uploading a custom version", () => {
  it("one upload for several landlords: one document, each landlord on it, nothing live yet", async () => {
    const db = world();
    const v = await upload(db, { audience: "selected", landlordIds: ["jess", "vic"] });
    assert.equal(v.audience, "selected");
    assert.equal(db.tables.agreement_versions.length, 2, "one new version row, not one per landlord");
    const rows = await versionLandlordRows(db, v.id);
    assert.deepEqual(rows.map((r) => [r.landlord_id, r.live]), [["jess", false], ["vic", false]]);
    assert.equal((await getLiveVersion(db, { landlordId: "jess" })).id, "vstd", "the standard one until it is live");
  });

  it("can start with nobody, and a change request's single landlord counts as a list of one", async () => {
    const db = world();
    const empty = await upload(db, { audience: "selected" });
    assert.equal(empty.audience, "selected");
    assert.equal((await versionLandlordRows(db, empty.id)).length, 0);
    const one = await upload(db, { landlordId: "pat" });
    assert.equal(one.audience, "selected");
    assert.deepEqual((await versionLandlordRows(db, one.id)).map((r) => r.landlord_id), ["pat"]);
  });

  it("refuses a landlord that does not exist", async () => {
    const db = world();
    await assert.rejects(() => upload(db, { audience: "selected", landlordIds: ["ghost"] }), (e) => e.code === "not_found");
  });
});

describe("making a custom version live", () => {
  it("applies to its landlords only and leaves the standard version live", async () => {
    const db = world();
    const v = await upload(db, { audience: "selected", landlordIds: ["jess", "vic"] });
    ready(db, v.id);
    await publishVersion(db, { versionId: v.id, adminId: "admin" });
    assert.equal((await getLiveVersion(db, { landlordId: "jess" })).id, v.id);
    assert.equal((await getLiveVersion(db, { landlordId: "vic" })).id, v.id);
    assert.equal((await getLiveVersion(db, { landlordId: "pat" })).id, "vstd");
    assert.equal((await getLiveVersion(db)).id, "vstd");
    assert.equal(db.tables.agreement_versions.find((x) => x.id === "vstd").status, "live");
  });

  it("replaces a landlord's earlier custom version, retiring it once nobody is left on it", async () => {
    const db = world();
    addCustomVersion(db, { id: "vold", label: "Old", published_at: "2026-10-01T00:00:00Z" }, ["jess"]);
    addCustomVersion(db, { id: "vshared", label: "Shared", published_at: "2026-10-01T00:00:00Z" }, ["vic", "pat"]);
    const v = await upload(db, { audience: "selected", landlordIds: ["jess", "vic"] });
    ready(db, v.id);
    await publishVersion(db, { versionId: v.id, adminId: "admin" });
    assert.equal(db.tables.agreement_versions.find((x) => x.id === "vold").status, "retired", "nobody left on it");
    assert.equal(db.tables.agreement_versions.find((x) => x.id === "vshared").status, "live", "Pat is still on it");
    assert.equal((await getLiveVersion(db, { landlordId: "pat" })).id, "vshared");
    assert.equal((await getLiveVersion(db, { landlordId: "vic" })).id, v.id);
  });
});

describe("changing who a version applies to", () => {
  it("before it is live: the change waits for Make live", async () => {
    const db = world();
    const v = await upload(db, { audience: "selected", landlordIds: ["jess"] });
    const r = await setVersionLandlords(db, { versionId: v.id, add: ["vic"], remove: ["jess"], adminId: "admin" });
    assert.deepEqual(r.changed, [], "nobody's version changes yet");
    const active = (await versionLandlordRows(db, v.id)).filter((x) => !x.removed_at).map((x) => x.landlord_id);
    assert.deepEqual(active, ["vic"]);
  });

  it("on a live version: added landlords get it now, removed ones go back to the standard one", async () => {
    const db = world();
    const v = addCustomVersion(db, { id: "vc", label: "Custom" }, ["jess"]);
    const added = await setVersionLandlords(db, { versionId: v.id, add: ["vic"], adminId: "admin" });
    assert.deepEqual(added.changed, ["vic"]);
    assert.equal((await getLiveVersion(db, { landlordId: "vic" })).id, "vc");
    const removed = await setVersionLandlords(db, { versionId: v.id, remove: ["jess"], adminId: "admin" });
    assert.deepEqual(removed.changed, ["jess"]);
    assert.equal((await getLiveVersion(db, { landlordId: "jess" })).id, "vstd");
    const row = db.tables.agreement_version_landlords.find((x) => x.landlord_id === "jess");
    assert.ok(row.removed_at && row.removed_by_id === "admin", "the removal is kept as a record");
  });

  it("removing everyone leaves it live for nobody, never the standard version", async () => {
    const db = world();
    const v = addCustomVersion(db, { id: "vc", label: "Custom" }, ["jess"]);
    await setVersionLandlords(db, { versionId: v.id, remove: ["jess"], adminId: "admin" });
    assert.equal(db.tables.agreement_versions.find((x) => x.id === "vc").status, "live");
    assert.equal((await getLiveVersion(db)).id, "vstd");
    assert.equal((await getLiveVersion(db, { landlordId: "pat" })).id, "vstd");
    // And people can be added back.
    await setVersionLandlords(db, { versionId: v.id, add: ["jess"], adminId: "admin" });
    assert.equal((await getLiveVersion(db, { landlordId: "jess" })).id, "vc");
  });

  it("making a custom version live that is not ready is refused", async () => {
    const db = world();
    const v = await upload(db, { audience: "selected", landlordIds: ["jess"] });
    await assert.rejects(() => publishVersion(db, { versionId: v.id, adminId: "admin" }), (e) => e.code === "not_ready");
  });

  it("refuses the standard version and a retired one", async () => {
    const db = world();
    await assert.rejects(() => setVersionLandlords(db, { versionId: "vstd", add: ["jess"], adminId: "admin" }), (e) => e.code === "not_custom");
    addCustomVersion(db, { id: "vr", label: "Retired", status: "retired" }, []);
    await assert.rejects(() => setVersionLandlords(db, { versionId: "vr", add: ["jess"], adminId: "admin" }), (e) => e.code === "retired");
  });
});

describe("open copies when a landlord's version changes (cancelled right away)", () => {
  it("cancels an unsigned copy on another version, keeps paper and hand-recorded copies, and one already on the new version", async () => {
    const db = world();
    addCustomVersion(db, { id: "vc", label: "Custom" }, ["jess", "vic", "pat"]);
    const documenso = fakeDocumenso();
    db.tables.landlord_agreements.push(
      { id: "m-jess", user_id: "jess", status: "sent", provider: "documenso", version_id: "vstd", provider_envelope_id: "env_jess" },
      { id: "m-vic", user_id: "vic", status: "sent", provider: "paper", version_id: "vstd", provider_envelope_id: null },
      { id: "m-pat", user_id: "pat", status: "sent", provider: "documenso", version_id: "vc", provider_envelope_id: "env_pat" }
    );
    documenso.envelopes.set("env_jess", { id: "env_jess", status: "PENDING" });
    const n = await cancelOpenCopies(db, documenso, { landlordIds: ["jess", "vic", "pat"], kind: "master" });
    assert.equal(n, 1);
    assert.equal(db.tables.landlord_agreements.find((m) => m.id === "m-jess").status, "voided");
    assert.deepEqual(documenso.calls.cancelled, ["env_jess"]);
    assert.equal(db.tables.landlord_agreements.find((m) => m.id === "m-vic").status, "sent", "paper keeps its wording");
    assert.equal(db.tables.landlord_agreements.find((m) => m.id === "m-pat").status, "sent", "already the right version");
  });

  it("an addendum is cancelled for the person who signs it, not for the account it adds to", async () => {
    const db = world();
    const documenso = fakeDocumenso();
    addCustomVersion(db, { id: "vca", label: "Custom amendment", kind: "amendment" }, ["jess"]);
    db.tables.agreement_amendments.push({ id: "a1", user_id: "jess", signer_id: "vic", status: "sent", version_id: "va", provider_envelope_id: null });
    assert.equal(await cancelOpenCopies(db, documenso, { landlordIds: ["jess"], kind: "amendment" }), 0, "Victor signs it, and his version did not change");
    assert.equal(await cancelOpenCopies(db, documenso, { landlordIds: ["vic"], kind: "amendment" }), 1);
  });
});

describe("what to flag about a landlord", () => {
  it("signer, accounts they sign for, a signed agreement, another custom version, copies out", async () => {
    const db = world();
    addCustomVersion(db, { id: "vc", label: "Clocktower terms" }, ["pat"]);
    db.tables.billing_payers.push({ landlord_id: "jess", payer_id: "vic", signer_name: "Victor Alston", status: "active", listing_id: null });
    db.tables.landlord_agreements.push(
      { id: "m1", user_id: "pat", status: "signed", provider: "documenso", version_id: "vstd", signed_at: "2026-11-02T00:00:00Z" },
      { id: "m2", user_id: "pat", status: "sent", provider: "documenso", version_id: "vc" },
      { id: "m3", user_id: "vic", status: "sent", provider: "paper", version_id: "vstd" }
    );
    const flags = await landlordFlags(db, ["jess", "vic", "pat"]);
    assert.deepEqual(flags.get("jess").signer, { id: "vic", name: "Victor Alston" });
    assert.deepEqual(flags.get("vic").signsFor, [{ id: "jess", name: "Jessica Nelson" }]);
    assert.equal(flags.get("vic").paperOut, true);
    assert.equal(flags.get("vic").inProgress, false, "a paper copy is not a Documenso copy to cancel");
    assert.deepEqual(flags.get("pat").liveCustom.master, { versionId: "vc", label: "Clocktower terms" });
    assert.equal(flags.get("pat").signed.custom, false);
    assert.equal(flags.get("pat").signed.label, "November 2026");
    assert.equal(flags.get("pat").inProgress, true);
    assert.deepEqual(flags.get("pat").openCopies, { master: ["vc"], amendment: [] });
  });

  it("a live row left on a retired version (after a snapshot) is not shown as their custom version", async () => {
    const db = world();
    addCustomVersion(db, { id: "vr", label: "Retired one", status: "retired" }, []);
    db.tables.agreement_version_landlords.push({ id: "x", version_id: "vr", landlord_id: "pat", kind: "master", live: true, removed_at: null });
    const flags = await landlordFlags(db, ["pat"]);
    assert.equal(flags.get("pat").liveCustom.master, null);
  });
});
