/*
 * Versions of the marketing agreement document (agreement_versions). An admin
 * takes a version from upload to live in four steps, all on the admin dashboard:
 *
 *   1. upload      the PDF is stored in R2 and pushed to Documenso as a template.
 *                  If Documenso is not connected, or the push fails, the version
 *                  waits as a draft and "Connect to Documenso" retries it.
 *   2. boxes       the admin places the signature boxes on it in Documenso's editor
 *   3. check       we read the template back: it needs a signature box for the
 *                  signer. An optional text box labelled "Title" is filled in with
 *                  the signer's title. The version becomes ready.
 *   4. make live   chosen per version: whether existing signers must re-sign it.
 *                  The previous live version is retired.
 *
 * Two kinds, each with its own live version (decisions of 2026-11-04):
 *   master     the marketing agreement, signed once with Exhibit A attached
 *   amendment  the short amendment signed when a landlord adds a property later
 * A version's audience is "everyone" (the standard one) or "selected": a custom
 * version (different wording or fee agreed with them) for the landlords listed in
 * agreement_version_landlords. The admin picks them at upload and can add or
 * remove them at any time (Wyatt, 2026-11-22). Each landlord is on at most one
 * live custom version per kind, and signs it instead of the standard one.
 * (agreement_versions.landlord_id, one landlord per version, is no longer written.)
 *
 * Needs migration 202611220001 (the audience column and the
 * agreement_version_landlords table) wherever this code runs. Reads tolerate the
 * agreement tables being missing altogether: no table reads as no version.
 *
 * `db` is a service-role Supabase client and `documenso` a client from
 * documenso.js, passed in so this stays testable.
 */
import { BillingError } from "./errors.js";
import { DocumensoError, splitExhibit, templateEditorUrl, templateFieldSummary } from "./documenso.js";
import { preparePlaceholders } from "./placeholders.js";

export const VERSION_COLUMNS =
  "id, label, kind, audience, commission_rate_percent, change_request_id, based_on_version_id, file_key, file_name, file_bytes, status, requires_resign, provider_template_id, provider_recipient_id, provider_title_field_id, provider_rate_field_id, provider_address_field_id, provider_brokerage_field_id, provider_license_field_id, provider_editor_url, provider_error, fields_checked_at, published_at, created_at";

export const VERSION_KINDS = ["master", "amendment"];

const missingTable = (error) => error?.code === "PGRST205" || error?.code === "42P01";

export const isCustom = (v) => v?.audience === "selected";

export async function listVersions(db) {
  const { data, error } = await db.from("agreement_versions").select(VERSION_COLUMNS).order("created_at", { ascending: false });
  if (missingTable(error)) return [];
  if (error) throw error;
  return data;
}

export async function getVersion(db, id) {
  const { data, error } = await db.from("agreement_versions").select(VERSION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new BillingError("not_found", "That agreement version was not found.", 404);
  return data;
}

/*
 * The version a landlord signs now: the custom version of this kind they are on
 * when one is live, otherwise the standard one. Without a landlord, the standard one.
 */
export async function getLiveVersion(db, { kind = "master", landlordId = null } = {}) {
  if (landlordId) {
    const own = (await liveLandlordVersions(db, { kind, landlordIds: [landlordId] })).get(landlordId);
    if (own) return own;
  }
  const { data, error } = await db
    .from("agreement_versions")
    .select(VERSION_COLUMNS)
    .eq("status", "live")
    .eq("kind", kind)
    .neq("audience", "selected")
    .maybeSingle();
  if (missingTable(error)) return null;
  if (error) throw error;
  return data;
}

/*
 * Each landlord's live custom version of this kind, by landlord id (all landlords
 * on one, or only `landlordIds`). Lets a list of landlords pick each one's version
 * in two queries instead of one getLiveVersion each.
 */
export async function liveLandlordVersions(db, { kind = "master", landlordIds = null } = {}) {
  let q = db.from("agreement_version_landlords").select("version_id, landlord_id").eq("kind", kind).eq("live", true);
  if (landlordIds) {
    if (!landlordIds.length) return new Map();
    q = q.in("landlord_id", landlordIds);
  }
  const { data: on, error } = await q;
  if (missingTable(error)) return new Map();
  if (error) throw error;
  if (!on.length) return new Map();
  const { data: versions, error: vError } = await db
    .from("agreement_versions")
    .select(VERSION_COLUMNS)
    .in("id", [...new Set(on.map((r) => r.version_id))])
    .eq("status", "live");
  if (vError) throw vError;
  const byId = new Map(versions.map((v) => [v.id, v]));
  return new Map(on.filter((r) => byId.has(r.version_id)).map((r) => [r.landlord_id, byId.get(r.version_id)]));
}

/*
 * When signatures stopped counting: the publish time of the newest version that
 * was made live with "existing signers must re-sign". A signature on a version
 * published before it no longer satisfies the listing gate. Null when no version
 * ever asked for that.
 */
export async function resignCutoff(db) {
  const { data, error } = await db
    .from("agreement_versions")
    .select("published_at")
    .eq("requires_resign", true)
    .eq("kind", "master")
    .neq("audience", "selected")
    .in("status", ["live", "retired"])
    .order("published_at", { ascending: false })
    .limit(1);
  if (missingTable(error)) return null;
  if (error) throw error;
  return data[0]?.published_at ?? null;
}

// The pure rule: does a signature made on a version published at `signedVersionPublishedAt` still count?
export function signatureStillValid(signedVersionPublishedAt, cutoff) {
  if (!cutoff) return true;
  if (!signedVersionPublishedAt) return false; // recorded by hand before any version existed
  return new Date(signedVersionPublishedAt).getTime() >= new Date(cutoff).getTime();
}

const LABEL_MAX = 80;

// "8.5%": how a rate reads on the document and on invoices.
export const formatRate = (rate) => (rate == null ? null : `${Number(rate).toLocaleString("en-US", { maximumFractionDigits: 3 })}%`);

/*
 * Step 1. `storePdf(bytes)` stores the file and returns its key
 * (agreementFiles.storeAgreementVersion). A custom version (`audience:
 * "selected"`) starts with `landlordIds`, which may be empty: landlords can be
 * added later. `landlordId` (one landlord, from a change request) is the same
 * as a list of one. A custom version names, when it answers one, the change request.
 */
export async function uploadVersion(
  db,
  documenso,
  { adminId, label, fileName, bytes, storePdf, kind = "master", audience = "everyone", landlordIds = [], landlordId = null, changeRequestId = null, basedOnVersionId = null }
) {
  const name = String(label ?? "").trim();
  if (!name) throw new BillingError("label_required", "Give this version a name, like \"December 2026\".");
  if (name.length > LABEL_MAX) throw new BillingError("label_too_long", `Keep the name under ${LABEL_MAX} characters.`);
  if (!VERSION_KINDS.includes(kind)) throw new BillingError("bad_kind", "Choose whether this is the agreement or the amendment.");
  const ids = [...new Set([...(landlordIds ?? []), ...(landlordId ? [landlordId] : [])].filter(Boolean))];
  const custom = audience === "selected" || ids.length > 0;
  if (!custom && changeRequestId) throw new BillingError("bad_audience", "A version answering a change request is for chosen landlords.");
  await assertLandlords(db, ids);

  const fileKey = await storePdf(bytes);
  const { data: version, error } = await db
    .from("agreement_versions")
    .insert({
      label: name,
      kind,
      audience: custom ? "selected" : "everyone",
      // The commission rate lives only in the document's wording (Wyatt, 2026-11-06).
      commission_rate_percent: null,
      change_request_id: changeRequestId || null,
      based_on_version_id: basedOnVersionId || null,
      file_key: fileKey,
      file_name: String(fileName ?? "").slice(0, 200) || null,
      file_bytes: bytes.length,
      status: "draft",
      created_by_id: adminId,
    })
    .select(VERSION_COLUMNS)
    .single();
  if (error) throw error;
  if (ids.length) await insertAssignments(db, version, ids, adminId);
  return connectVersion(db, documenso, version, bytes);
}

// Every id must be a landlord account that still exists.
async function assertLandlords(db, ids) {
  if (!ids.length) return;
  const { data, error } = await db.from("users").select("id, deleted_at, roles!role_id(name)").in("id", ids);
  if (error) throw error;
  const ok = new Set((data ?? []).filter((u) => !u.deleted_at && (u.roles?.name ?? "landlord") === "landlord").map((u) => u.id));
  if (ids.some((id) => !ok.has(id))) throw new BillingError("not_found", "One of those landlords was not found.", 404);
}

async function insertAssignments(db, version, ids, adminId, now = new Date()) {
  if (!ids.length) return;
  const { error } = await db.from("agreement_version_landlords").insert(
    ids.map((landlordId) => ({ version_id: version.id, landlord_id: landlordId, kind: version.kind, live: false, added_by_id: adminId, added_at: now.toISOString() }))
  );
  if (error) {
    if (error.code === "23505") throw new BillingError("status_changed", "That landlord was just added. Refresh and try again.", 409);
    throw error;
  }
}

// Every landlord row of these versions, oldest first, including landlords taken off
// (removed_at set): filter with activeOn for who is on it now.
export async function versionLandlordRows(db, versionIds) {
  const ids = [].concat(versionIds).filter(Boolean);
  if (!ids.length) return [];
  const { data, error } = await db
    .from("agreement_version_landlords")
    .select("id, version_id, landlord_id, kind, live, added_at, removed_at")
    .in("version_id", ids)
    .order("added_at", { ascending: true });
  if (missingTable(error)) return [];
  if (error) throw error;
  return data;
}

const activeOn = (rows) => rows.filter((r) => !r.removed_at);

// What agreement_version_set_landlords raises, as an error the admin can read.
const MOVE_ERRORS = {
  not_found: ["not_found", "That agreement version was not found.", 404],
  not_custom: ["not_custom", "The standard version is for everyone. Upload a custom version to choose landlords.", 409],
  retired: ["retired", "This version is retired. Upload it again to use it.", 409],
  not_ready: ["not_ready", "Check the signature boxes before making this version live.", 409],
};

/*
 * Adds and takes off landlords and, when the version is live (or `publish`
 * makes it live), moves everyone on it onto it: each leaves any other live
 * custom version of the same kind (one live per landlord per kind), and a custom
 * version left with nobody that way is retired, as replacing a landlord's version
 * always did. One database transaction (agreement_version_set_landlords,
 * 202611220001), so a failure part way changes nothing. Returns { changed, left }:
 * the landlords whose version to sign changed now, and the versions they left.
 */
async function moveLandlords(db, { versionId, add = [], remove = [], adminId, publish = false, now }) {
  const { data, error } = await db.rpc("agreement_version_set_landlords", {
    p_version_id: versionId,
    p_add: add,
    p_remove: remove,
    p_admin_id: adminId ?? null,
    p_publish: publish,
    p_now: now.toISOString(),
  });
  if (error) {
    const known = MOVE_ERRORS[error.message];
    if (known) throw new BillingError(...known);
    if (error.code === "23505") throw new BillingError("status_changed", "Another custom version was just made live for one of them. Refresh and try again.", 409);
    throw error;
  }
  return { changed: data?.changed ?? [], left: data?.left ?? [] };
}

/*
 * Add or take off landlords on a custom version (Wyatt, 2026-11-22). Before the
 * version is live the change waits for Make live; on a live version it applies
 * now. Taking someone off never touches what they signed: they sign the standard
 * version next. Returns { version, changed }: the landlords whose version to sign
 * changed now (their open copies are cancelled by the caller).
 */
export async function setVersionLandlords(db, { versionId, add = [], remove = [], adminId, now = new Date() }) {
  const version = await getVersion(db, versionId);
  if (!isCustom(version)) throw new BillingError(...MOVE_ERRORS.not_custom);
  if (version.status === "retired") throw new BillingError(...MOVE_ERRORS.retired);
  const current = new Set(activeOn(await versionLandlordRows(db, versionId)).map((r) => r.landlord_id));
  const adding = [...new Set(add.filter((id) => id && !current.has(id)))];
  const removing = [...new Set(remove.filter((id) => id && current.has(id) && !adding.includes(id)))];
  await assertLandlords(db, adding);
  const { changed } = await moveLandlords(db, { versionId, add: adding, remove: removing, adminId, now });
  return { version, changed };
}
/*
 * Push a draft to Documenso as a template (step 1, or retrying it). A failure is
 * saved on the version for the admin to see instead of losing the upload.
 * `bytes` is optional; without it `readPdf(key)` reads the stored file.
 */
export async function connectVersion(db, documenso, version, bytes = null, { readPdf } = {}) {
  if (version.provider_template_id) return version;
  if (version.status !== "draft") throw new BillingError("not_draft", "Only a draft can be connected.", 409);
  try {
    const original = bytes ?? (await readPdf(version.file_key));
    // [Placeholders] in the PDF become labelled boxes in their place (placeholders.js).
    const { bytes: pdfBytes, boxes } = await preparePlaceholders(original);
    const what = version.kind === "amendment" ? "Exhibit A amendment" : "marketing agreement";
    const templateId = await documenso.createTemplate({
      title: `Proximity ${what} (${version.label})${isCustom(version) ? " [custom]" : ""}`,
      pdfBytes,
      fileName: version.file_name || "marketing-agreement.pdf",
      externalId: `agreement-version:${version.id}`,
    });
    if (boxes.length && documenso.addTemplateBoxes) await documenso.addTemplateBoxes(templateId, boxes);
    const envelope = await documenso.getEnvelope(templateId).catch(() => ({ id: templateId }));
    const { data, error } = await db
      .from("agreement_versions")
      .update({ provider_template_id: templateId, provider_editor_url: templateEditorUrl(envelope), provider_error: null })
      .eq("id", version.id)
      .select(VERSION_COLUMNS)
      .single();
    if (error) throw error;
    // With its boxes in place it can be checked straight away: ready to go live
    // when the Signature and Exhibit A boxes are there.
    if (boxes.length) return (await checkVersionFields(db, documenso, data.id)).version;
    return data;
  } catch (err) {
    if (!(err instanceof DocumensoError)) throw err;
    const message = err.status === 503 ? "Documenso is not connected yet. Add the API key, then press Connect to Documenso." : err.message;
    const { data } = await db
      .from("agreement_versions")
      .update({ provider_error: message.slice(0, 500) })
      .eq("id", version.id)
      .select(VERSION_COLUMNS)
      .single();
    return data ?? version;
  }
}

/*
 * A test fill (Wyatt, 2026-11-07): a throwaway copy of the template filled the way
 * a landlord's would be, with long sample values and a full Exhibit A, then
 * deleted. Anything Documenso would refuse on a real copy is refused here first.
 * Returns null when it went through, else what was refused, in words.
 */
export async function testFillTemplate(documenso, envelope, summary) {
  if (!documenso.prepareSigningCopy) return null;
  const sample = {
    title: "Property Manager and Authorized Signatory",
    name: "Alexandra Testington-Whitmore",
    company: "Testington Whitmore Property Holdings LLC",
    owner: "Testington Whitmore Property Holdings LLC",
    email: "alexandra.testington-whitmore@example.com",
    address1: "12345 South Brentwood Boulevard, Suite 1200",
    address2: "St. Louis, MO 63117",
    address: "12345 South Brentwood Boulevard, Suite 1200, St. Louis, MO 63117",
    agreementDate: "11/07/2026",
    exhibitBefore: "6105 Delmar Boulevard, St. Louis, Missouri 63112\nWhole building",
  };
  // A full Exhibit A: as many properties as the boxes hold (at least a dozen).
  const count = Math.max(12, summary.exhibitCapacity || 0);
  const blocks = Array.from({ length: count }, (_, i) => `${6100 + i} Pershing Avenue, St. Louis, Missouri 63112\nUnits: Apt ${i + 1}A, Apt ${i + 1}B, Apt ${i + 1}C`);
  const prefill = [
    ...Object.entries(sample).flatMap(([k, value]) => (summary.allIds?.[k] ?? []).map((id) => ({ id, value }))),
    ...splitExhibit(blocks, summary.exhibitBoxes ?? []),
  ];
  let copy = null;
  try {
    copy = await documenso.prepareSigningCopy({
      templateId: envelope.id,
      recipientId: summary.recipientId,
      email: "test-fill@proximity.test",
      name: sample.name,
      externalId: `test-fill:${envelope.id}`,
      prefill,
      autofill: { name: sample.name, email: sample.email, date: "11/07/2026" },
      dropRateBox: true,
      exhibit: null,
      title: "Test fill (deleted automatically)",
    });
    return null;
  } catch (err) {
    if (!(err instanceof DocumensoError)) throw err;
    const issue = err.body?.issues?.[0];
    return issue ? `${issue.message} (${(issue.path ?? []).join(".")})` : err.message;
  } finally {
    if (copy?.envelopeId) await documenso.discard?.(copy.envelopeId, "test fill").catch(() => {});
  }
}

// Step 3: read the template back and check its boxes (and, unless `quick`, test-fill it).
export async function checkVersionFields(db, documenso, versionId, { quick = false } = {}) {
  const version = await getVersion(db, versionId);
  if (!version.provider_template_id) {
    throw new BillingError("not_connected", "Connect this version to Documenso first.", 409);
  }
  const envelope = await documenso.getEnvelope(version.provider_template_id);
  const summary = templateFieldSummary(envelope);
  // Just showing the boxes found (the admin page opening, any version): no test fill, no change.
  if (quick) return { version, summary };
  if (version.status !== "draft" && version.status !== "ready") {
    throw new BillingError("not_draft", "A live or retired version cannot be changed.", 409);
  }
  // A template that has its boxes is test-filled before it can go live.
  if (summary.ok) {
    const refused = await testFillTemplate(documenso, envelope, summary);
    if (refused) {
      summary.ok = false;
      summary.missing = [...(summary.missing ?? []), `a test fill to go through (Documenso refused it: ${refused})`];
    }
  }
  if (!summary.ok) {
    const { error } = await db
      .from("agreement_versions")
      .update({ status: "draft", fields_checked_at: null, provider_error: null })
      .eq("id", version.id);
    if (error) throw error;
    return { version: await getVersion(db, versionId), summary };
  }
  const { data, error } = await db
    .from("agreement_versions")
    .update({
      status: "ready",
      provider_recipient_id: summary.recipientId,
      provider_title_field_id: summary.titleFieldId,
      provider_rate_field_id: summary.rateFieldId,
      provider_address_field_id: summary.addressFieldId,
      provider_brokerage_field_id: summary.brokerageFieldId,
      provider_license_field_id: summary.licenseFieldId,
      provider_editor_url: templateEditorUrl(envelope),
      fields_checked_at: new Date().toISOString(),
      provider_error: null,
    })
    .eq("id", version.id)
    .select(VERSION_COLUMNS)
    .single();
  if (error) throw error;
  return { version: data, summary };
}

/*
 * Step 4. The standard version of the same kind is retired first (one live per
 * kind). A custom version goes live for the landlords on it, each leaving any
 * other live custom version of that kind. The re-sign choice applies to standard
 * master versions only: an amendment never asks anyone to re-sign, and a custom
 * version is signed by its landlords anyway. Returns the version, with `changed`:
 * the landlords a custom version now applies to (the caller cancels their open copies).
 */
export async function publishVersion(db, { versionId, adminId, requiresResign, now = new Date() }) {
  const version = await getVersion(db, versionId);
  const custom = isCustom(version);
  const asksResign = version.kind === "master" && !custom;
  if (asksResign && typeof requiresResign !== "boolean") {
    throw new BillingError("resign_choice_required", "Choose whether existing signers must sign this version again.");
  }
  if (version.status !== "ready") {
    throw new BillingError("not_ready", "Check the signature boxes before making this version live.", 409);
  }
  if (custom) {
    const { changed } = await moveLandlords(db, { versionId, adminId, publish: true, now });
    return { ...(await getVersion(db, versionId)), changed };
  }
  const { error: retireError } = await db
    .from("agreement_versions")
    .update({ status: "retired" })
    .eq("status", "live")
    .eq("kind", version.kind)
    .neq("audience", "selected");
  if (retireError) throw retireError;
  const { data, error } = await db
    .from("agreement_versions")
    .update({ status: "live", requires_resign: asksResign ? requiresResign : false, published_at: now.toISOString(), published_by_id: adminId })
    .eq("id", versionId)
    .eq("status", "ready")
    .select(VERSION_COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new BillingError("status_changed", "Another version was just made live. Refresh and try again.", 409);
    throw error;
  }
  if (!data) throw new BillingError("status_changed", "This version changed meanwhile. Refresh and try again.", 409);
  return { ...data, changed: [] };
}

// A draft (or ready) version that will not be used. The Documenso template is left
// for the admin to delete there; nothing was ever signed on it.
export async function discardVersion(db, versionId) {
  const version = await getVersion(db, versionId);
  if (version.status !== "draft" && version.status !== "ready") {
    throw new BillingError("not_draft", "Only a version that was never live can be discarded.", 409);
  }
  const { error } = await db.from("agreement_versions").delete().eq("id", versionId).in("status", ["draft", "ready"]);
  if (error) throw error;
  return { discarded: versionId };
}

/*
 * For the admin list: what each version looks like, without storage keys.
 * `landlordRows` are this version's agreement_version_landlords rows and
 * `landlordNames` names by user id.
 */
export function versionView(v, signedCounts = new Map(), landlordNames = new Map(), landlordRows = []) {
  const custom = isCustom(v);
  // A retired version lists who it was for; any other, who is on it now.
  const shown = custom ? (v.status === "retired" ? landlordRows : activeOn(landlordRows)) : [];
  const landlords = [...new Map(shown.map((r) => [r.landlord_id, r])).values()].map((r) => ({
    id: r.landlord_id,
    name: landlordNames.get(r.landlord_id) ?? null,
    live: !!r.live,
    addedAt: r.added_at ?? null,
  }));
  return {
    id: v.id,
    label: v.label,
    kind: v.kind ?? "master",
    custom,
    landlords,
    changeRequestId: v.change_request_id ?? null,
    commissionRatePercent: v.commission_rate_percent == null ? null : Number(v.commission_rate_percent),
    hasRateBox: !!v.provider_rate_field_id,
    hasAddressBox: !!v.provider_address_field_id,
    hasBrokerageBox: !!v.provider_brokerage_field_id,
    hasLicenseBox: !!v.provider_license_field_id,
    fileName: v.file_name,
    fileBytes: v.file_bytes,
    status: v.status,
    requiresResign: v.requires_resign,
    connected: !!v.provider_template_id,
    editorUrl: v.provider_editor_url,
    providerError: v.provider_error,
    fieldsCheckedAt: v.fields_checked_at,
    hasTitleBox: !!v.provider_title_field_id,
    publishedAt: v.published_at,
    createdAt: v.created_at,
    signedCount: signedCounts.get(v.id) ?? 0,
  };
}
