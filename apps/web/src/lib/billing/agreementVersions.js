/*
 * Versions of the commission agreement document (agreement_versions). An admin
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
 *   master     the commission agreement, signed once with Exhibit A attached
 *   amendment  the short amendment signed when a landlord adds a property later
 * A version with landlord_id is negotiated with that one landlord (an accepted
 * change request): it is live for them only, and they sign it instead of the
 * standard one. The admin enters the commission rate with each upload; it fills
 * the document's "Commission rate" box and shows on invoices.
 *
 * Every read tolerates the table being missing (the code can reach an environment
 * before the migration does): no table reads as no version.
 *
 * `db` is a service-role Supabase client and `documenso` a client from
 * documenso.js, passed in so this stays testable.
 */
import { BillingError } from "./errors.js";
import { DocumensoError, templateEditorUrl, templateFieldSummary } from "./documenso.js";

export const VERSION_COLUMNS =
  "id, label, kind, landlord_id, commission_rate_percent, change_request_id, based_on_version_id, file_key, file_name, file_bytes, status, requires_resign, provider_template_id, provider_recipient_id, provider_title_field_id, provider_rate_field_id, provider_address_field_id, provider_brokerage_field_id, provider_license_field_id, provider_editor_url, provider_error, fields_checked_at, published_at, created_at";

export const VERSION_KINDS = ["master", "amendment"];

const missingTable = (error) => error?.code === "PGRST205" || error?.code === "42P01";

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
 * The version a landlord signs now: their own negotiated version of this kind when
 * one is live, otherwise the standard one. Without a landlord, the standard one.
 */
export async function getLiveVersion(db, { kind = "master", landlordId = null } = {}) {
  if (landlordId) {
    const { data, error } = await db
      .from("agreement_versions")
      .select(VERSION_COLUMNS)
      .eq("status", "live")
      .eq("kind", kind)
      .eq("landlord_id", landlordId)
      .maybeSingle();
    if (missingTable(error)) return null;
    if (error) throw error;
    if (data) return data;
  }
  const { data, error } = await db
    .from("agreement_versions")
    .select(VERSION_COLUMNS)
    .eq("status", "live")
    .eq("kind", kind)
    .is("landlord_id", null)
    .maybeSingle();
  if (missingTable(error)) return null;
  if (error) throw error;
  return data;
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
    .is("landlord_id", null)
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
 * (agreementFiles.storeAgreementVersion). A negotiated version names its landlord
 * and, when it answers one, the change request.
 */
export async function uploadVersion(
  db,
  documenso,
  { adminId, label, fileName, bytes, storePdf, kind = "master", landlordId = null, changeRequestId = null, basedOnVersionId = null }
) {
  const name = String(label ?? "").trim();
  if (!name) throw new BillingError("label_required", "Give this version a name, like \"December 2026\".");
  if (name.length > LABEL_MAX) throw new BillingError("label_too_long", `Keep the name under ${LABEL_MAX} characters.`);
  if (!VERSION_KINDS.includes(kind)) throw new BillingError("bad_kind", "Choose whether this is the agreement or the amendment.");
  if (landlordId) {
    const { data: landlord, error } = await db.from("users").select("id, deleted_at").eq("id", landlordId).maybeSingle();
    if (error) throw error;
    if (!landlord || landlord.deleted_at) throw new BillingError("not_found", "That landlord was not found.", 404);
  }

  const fileKey = await storePdf(bytes);
  const { data: version, error } = await db
    .from("agreement_versions")
    .insert({
      label: name,
      kind,
      // The commission rate lives only in the document's wording (Wyatt, 2026-11-06).
      commission_rate_percent: null,
      landlord_id: landlordId || null,
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
  return connectVersion(db, documenso, version, bytes);
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
    const pdfBytes = bytes ?? (await readPdf(version.file_key));
    const what = version.kind === "amendment" ? "Exhibit A amendment" : "commission agreement";
    const templateId = await documenso.createTemplate({
      title: `Proximity ${what} (${version.label})${version.landlord_id ? " [one landlord]" : ""}`,
      pdfBytes,
      fileName: version.file_name || "commission-agreement.pdf",
      externalId: `agreement-version:${version.id}`,
    });
    const envelope = await documenso.getEnvelope(templateId).catch(() => ({ id: templateId }));
    const { data, error } = await db
      .from("agreement_versions")
      .update({ provider_template_id: templateId, provider_editor_url: templateEditorUrl(envelope), provider_error: null })
      .eq("id", version.id)
      .select(VERSION_COLUMNS)
      .single();
    if (error) throw error;
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

// Step 3: read the template back and check its boxes.
export async function checkVersionFields(db, documenso, versionId) {
  const version = await getVersion(db, versionId);
  if (!version.provider_template_id) {
    throw new BillingError("not_connected", "Connect this version to Documenso first.", 409);
  }
  if (version.status !== "draft" && version.status !== "ready") {
    throw new BillingError("not_draft", "A live or retired version cannot be changed.", 409);
  }
  const envelope = await documenso.getEnvelope(version.provider_template_id);
  const summary = templateFieldSummary(envelope);
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
 * Step 4. The live version of the same kind (and the same landlord, for a
 * negotiated one) is retired first; the unique indexes allow one of each. The
 * re-sign choice applies to standard master versions only: an amendment never
 * asks anyone to re-sign, and a negotiated version is signed by its landlord anyway.
 */
export async function publishVersion(db, { versionId, adminId, requiresResign, now = new Date() }) {
  const version = await getVersion(db, versionId);
  const asksResign = version.kind === "master" && !version.landlord_id;
  if (asksResign && typeof requiresResign !== "boolean") {
    throw new BillingError("resign_choice_required", "Choose whether existing signers must sign this version again.");
  }
  if (version.status !== "ready") {
    throw new BillingError("not_ready", "Check the signature boxes before making this version live.", 409);
  }
  // Missouri: the agreement's signature page carries the brokerage name and license
  // number (or "N/A"), so a master agreement cannot go live without both boxes.
  if (version.kind === "master" && (!version.provider_brokerage_field_id || !version.provider_license_field_id)) {
    throw new BillingError(
      "license_boxes_required",
      'Add text boxes labelled "Brokerage" and "License" to the signature page in Documenso, then check the boxes again.',
      409
    );
  }
  let retire = db.from("agreement_versions").update({ status: "retired" }).eq("status", "live").eq("kind", version.kind);
  retire = version.landlord_id ? retire.eq("landlord_id", version.landlord_id) : retire.is("landlord_id", null);
  const { error: retireError } = await retire;
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
  return data;
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

// For the admin list: what each version looks like, without storage keys.
export function versionView(v, signedCounts = new Map(), landlordNames = new Map()) {
  return {
    id: v.id,
    label: v.label,
    kind: v.kind ?? "master",
    landlordId: v.landlord_id ?? null,
    landlordName: v.landlord_id ? landlordNames.get(v.landlord_id) ?? null : null,
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
