/*
 * Mass email templates and their versions (Wyatt, 2026-11-07).
 *
 * A template is a named email. Each save makes a new numbered version that is
 * never edited afterwards, so "who received what" always points at the exact
 * wording they got. Archiving hides a template from the list without deleting
 * its history.
 *
 * `db` is a service-role Supabase client. Validation lives in cleanVersion, which
 * is pure so it can be tested.
 */

import { BUTTON_TARGETS, safeHref, unknownMergeFields } from "./render.js";

export class TemplateError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORED_KEY = /^mass-email\/[0-9a-f-]{36}\.pdf$/i;
const text = (v) => (typeof v === "string" ? v.trim() : "");

export const DEFAULT_FOOTER_REASON = "You are receiving this because you have an account on Proximity.";

/*
 * Pure: the row for a new version from what the admin typed, or a TemplateError
 * naming the first problem. Attachments are { kind: "mrec" } or a file this site
 * stored ({ kind: "file", key, fileName, size }); anything else is refused.
 */
export function cleanVersion(input) {
  const subject = text(input?.subject);
  const body = String(input?.body ?? "").replace(/\r\n/g, "\n").trim();
  if (!subject) throw new TemplateError("subject_required", "Write a subject.");
  if (subject.length > 200) throw new TemplateError("subject_too_long", "The subject is too long (200 characters at most).");
  if (!body) throw new TemplateError("body_required", "Write the email.");
  if (body.length > 20000) throw new TemplateError("body_too_long", "The email is too long.");
  const unknown = unknownMergeFields(`${subject}\n${body}`);
  if (unknown.length) {
    throw new TemplateError("unknown_field", `Unknown field ${unknown.map((f) => `{{${f}}}`).join(", ")}. Use one from the list.`);
  }

  const target = BUTTON_TARGETS.some((t) => t.key === input?.buttonTarget) ? input.buttonTarget : "none";
  const buttonLabel = text(input?.buttonLabel);
  let buttonUrl = null;
  if (target !== "none") {
    if (!buttonLabel) throw new TemplateError("button_label_required", "Write the button's text, or choose No button.");
    if (buttonLabel.length > 60) throw new TemplateError("button_label_too_long", "The button text is too long.");
  }
  if (target === "custom") {
    buttonUrl = text(input?.buttonUrl);
    if (!safeHref(buttonUrl, "https://useproximity.org")) {
      throw new TemplateError("bad_button_url", "The button link must start with https:// or be a site path like /dashboard/landlord.");
    }
  }

  const attachments = [];
  for (const a of Array.isArray(input?.attachments) ? input.attachments : []) {
    if (a?.kind === "mrec") {
      if (!attachments.some((x) => x.kind === "mrec")) attachments.push({ kind: "mrec" });
    } else if (a?.kind === "file" && STORED_KEY.test(String(a.key ?? ""))) {
      attachments.push({ kind: "file", key: a.key, fileName: text(a.fileName).slice(0, 120) || "attachment.pdf", size: Number(a.size) || null });
    } else {
      throw new TemplateError("bad_attachment", "One of the attachments could not be used. Upload it again.");
    }
  }
  if (attachments.length > 3) throw new TemplateError("too_many_attachments", "Attach three files at most.");

  const footerReason = text(input?.footerReason) || DEFAULT_FOOTER_REASON;
  if (footerReason.length > 300) throw new TemplateError("footer_too_long", "The footer line is too long.");

  return {
    subject,
    body,
    button_target: target,
    button_label: target === "none" ? null : buttonLabel,
    button_url: buttonUrl,
    attachments,
    footer_reason: footerReason,
    commercial: input?.commercial === true,
  };
}

export async function listTemplates(db, { includeArchived = false } = {}) {
  let q = db.from("mass_email_templates").select("id, name, created_at, updated_at, archived_at").order("updated_at", { ascending: false });
  if (!includeArchived) q = q.is("archived_at", null);
  const { data: templates, error } = await q;
  if (error) throw error;
  const ids = (templates ?? []).map((t) => t.id);
  if (!ids.length) return [];
  const { data: versions, error: vErr } = await db
    .from("mass_email_versions")
    .select("*, creator:users!created_by(name)")
    .in("template_id", ids)
    .order("version", { ascending: false });
  if (vErr) throw vErr;
  return templates.map((t) => ({
    ...t,
    versions: (versions ?? []).filter((v) => v.template_id === t.id).map(({ creator, ...v }) => ({ ...v, createdByName: creator?.name ?? null })),
  }));
}

export async function createTemplate(db, { name, adminId }) {
  const clean = text(name);
  if (!clean) throw new TemplateError("name_required", "Name the email.");
  if (clean.length > 120) throw new TemplateError("name_too_long", "That name is too long.");
  const { data, error } = await db.from("mass_email_templates").insert({ name: clean, created_by: adminId ?? null }).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateTemplate(db, id, { name, archived }) {
  if (!UUID.test(String(id))) throw new TemplateError("not_found", "That email was not found.", 404);
  const patch = {};
  if (name !== undefined) {
    const clean = text(name);
    if (!clean || clean.length > 120) throw new TemplateError("bad_name", "Give the email a name of 120 characters or fewer.");
    patch.name = clean;
  }
  if (archived !== undefined) patch.archived_at = archived ? new Date().toISOString() : null;
  const { data, error } = await db.from("mass_email_templates").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new TemplateError("not_found", "That email was not found.", 404);
  return data;
}

/*
 * Saves a new version. Two admins saving at once both get a number: a clash on
 * (template_id, version) is retried with the next one.
 */
export async function saveVersion(db, templateId, input, { adminId } = {}) {
  if (!UUID.test(String(templateId))) throw new TemplateError("not_found", "That email was not found.", 404);
  const row = cleanVersion(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last, error: lastErr } = await db
      .from("mass_email_versions")
      .select("version")
      .eq("template_id", templateId)
      .order("version", { ascending: false })
      .limit(1);
    if (lastErr) throw lastErr;
    const version = (last?.[0]?.version ?? 0) + 1;
    const { data, error } = await db
      .from("mass_email_versions")
      .insert({ ...row, template_id: templateId, version, created_by: adminId ?? null })
      .select("*")
      .single();
    if (!error) {
      await db.from("mass_email_templates").update({ updated_at: new Date().toISOString() }).eq("id", templateId);
      return data;
    }
    if (error.code === "23503") throw new TemplateError("not_found", "That email was not found.", 404);
    if (error.code !== "23505") throw error;
  }
  throw new TemplateError("busy", "Someone else saved at the same moment. Save again.", 409);
}
