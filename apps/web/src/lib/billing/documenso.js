/*
 * Documenso, the e-signature provider for the commission agreement (Teams plan).
 * Written against Documenso's v2 API (https://app.documenso.com/api/v2/openapi.json,
 * the envelope endpoints), using fetch so nothing extra is installed.
 *
 *   createTemplate     an uploaded agreement version becomes a Documenso template,
 *                      with one placeholder signer. The admin then places the
 *                      signature boxes in Documenso's editor.
 *   getEnvelope        a template or a landlord's copy: status, recipients, fields
 *   createSigningCopy  a landlord's own copy of the live template, sent with
 *                      distributionMethod NONE (Documenso emails nobody: signing
 *                      happens inside our Payments tab), returning the signing token
 *   downloadSigned     the completed PDF, signatures and audit trail included
 *   cancel             withdraws a copy that is no longer wanted
 *
 * Configuration. The Teams plan allows one Documenso team, so production and
 * every test environment share it, each with its own API token and webhook.
 * They stay apart because each environment acts only on documents its own
 * database knows about (the webhook ignores the rest), and are told apart in
 * Documenso by folder and by a [TEST] title prefix off production:
 *   DOCUMENSO_API_KEY         team API key (Team settings > API Tokens)
 *   DOCUMENSO_WEBHOOK_SECRET  the secret set on this environment's webhook
 *   DOCUMENSO_FOLDER_ID       optional: the Documenso document folder landlords' copies go in
 *   DOCUMENSO_HOST            optional, defaults to https://app.documenso.com
 *
 * Production reads those names. Everywhere else (staging, previews, local) reads
 * the same names with a _DEV suffix (DOCUMENSO_API_KEY_DEV, ...), never the
 * production ones, so a laptop holding both never touches production documents.
 * Like PROD_/DEV_SUPABASE_URL, the switch is isProdData().
 *
 * Documenso's own emails (a completed copy to the signer, notices to the team
 * account's owner) follow `emailSettings`, set on each landlord's copy. Off
 * production every one is off (agreementServices.js), because dev holds real
 * landlords' addresses.
 *
 * Errors become DocumensoError with Documenso's HTTP status. Their messages are
 * for logs and admins, never shown to a landlord.
 */
import { timingSafeEqual } from "node:crypto";
import { isProdData } from "../appEnv.js";

export const DEFAULT_DOCUMENSO_HOST = "https://app.documenso.com";

export class DocumensoError extends Error {
  constructor(message, status = 500, body = null) {
    super(message);
    this.name = "DocumensoError";
    this.status = status;
    this.body = body;
  }
}

// One Documenso setting for this environment: NAME on production data, NAME_DEV elsewhere.
export function documensoSetting(name) {
  return (isProdData() ? process.env[name] : process.env[`${name}_DEV`]) || null;
}

export function documensoHost() {
  return (documensoSetting("DOCUMENSO_HOST") || DEFAULT_DOCUMENSO_HOST).replace(/\/+$/, "");
}

export function documensoConfigured() {
  return !!documensoSetting("DOCUMENSO_API_KEY");
}

/*
 * Documenso sends the webhook secret, as is, in X-Documenso-Secret (no HMAC). It
 * is compared in constant time. With no secret configured every request is
 * refused: an open endpoint would let anyone mark an agreement signed.
 */
export function verifyWebhookSecret(received, expected = documensoSetting("DOCUMENSO_WEBHOOK_SECRET")) {
  if (!expected || typeof received !== "string" || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/*
 * The parts of an envelope our code reads, from GET /envelope/{id}. Fields the
 * spec documents: status DRAFT | PENDING | COMPLETED | REJECTED | CANCELLED;
 * recipients[] { id, role, name, email, token, signingStatus, signedAt,
 * rejectionReason }; fields[] { id, type, recipientId, fieldMeta: { label } };
 * envelopeItems[] { id, order }; team { url }.
 */
export const signerOf = (envelope) => (envelope?.recipients ?? []).find((r) => r.role === "SIGNER") ?? null;

// What the admin dashboard's "Check signature boxes" step reports for a template.
// Also read again when each landlord's copy is made, so the boxes we fill in are
// always the ones on the template now, with their type.
/*
 * The Text boxes we fill in, by the words in their label in Documenso's editor:
 * [what the label must contain, what it must not]. An admin labels a box "Owner",
 * "Company", "Name", "Title", "Email", "Address 1", "Address 2" or "Exhibit A"
 * (and, on an amendment, "Exhibit A before") and it is filled for each landlord.
 */
export const BOX_RULES = {
  title: [/\btitle\b/i, null],
  // One box for the whole address, when the template has not split it.
  address: [/\baddress\b/i, /\baddress\s*(line\s*)?[12]\b/i],
  address1: [/\baddress\s*(line\s*)?1\b/i, null],
  address2: [/\baddress\s*(line\s*)?2\b/i, null],
  email: [/\be-?mail\b/i, null],
  // The signer's full name. Not "Company name", "Owner name", "Brokerage name".
  name: [/\bname\b/i, /\b(company|business|owner|landlord|property|brokerage|licen[cs]ee?)\b/i],
  // Who the agreement is with: the company, or the signer's name without one.
  owner: [/\b(owner|landlord)\b/i, null],
  company: [/\b(company|business)\b/i, null],
  // The covered properties, one per line; on an amendment, the list after it.
  exhibit: [/\bexhibit\s*a\b/i, /\b(before|previous|old|prior)\b/i],
  // The agreement's date ("Effective Date") on an addendum: [AGREEMENT DATE].
  agreementDate: [/\b(agreement|effective)\s*date\b/i, null],
  // An amendment's list before it.
  exhibitBefore: [/\bexhibit\s*a\b.*\b(before|previous|old|prior)\b|\b(before|previous|old|prior)\b.*\bexhibit\s*a\b/i, null],
};

/*
 * A copy's boxes, matched to the template's, by kind. Documenso gives a copy new
 * box ids and drops the labels, so each template box is matched to the copy box
 * in the same place (page, position, size); among identical places, by order.
 * Returns { kind: [copy field] }.
 */
export function copyBoxesByKind(templateEnvelope, copyEnvelope) {
  const ids = templateFieldSummary(templateEnvelope).allIds ?? {};
  const place = (f) => [f.type, f.page, f.positionX, f.positionY, f.width, f.height].map(String).join("|");
  const copyByPlace = new Map();
  for (const f of copyEnvelope?.fields ?? []) {
    const list = copyByPlace.get(place(f)) ?? [];
    list.push(f);
    copyByPlace.set(place(f), list);
  }
  const seen = new Map();
  const copyOf = (tf) => {
    const key = place(tf);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return copyByPlace.get(key)?.[n] ?? null;
  };
  const byId = new Map((templateEnvelope?.fields ?? []).map((f) => [f.id, f]));
  // Walk the template's boxes in order so the "by order" tie-break is stable.
  const kindOf = new Map();
  for (const [kind, list] of Object.entries(ids)) for (const id of list) if (!kindOf.has(id)) kindOf.set(id, kind);
  const out = Object.fromEntries(Object.keys(ids).map((k) => [k, []]));
  for (const tf of templateEnvelope?.fields ?? []) {
    const copy = copyOf(tf);
    const kind = kindOf.get(tf.id);
    if (kind && copy && byId.has(tf.id)) out[kind].push(copy);
  }
  return out;
}

/*
 * Exhibit A across several boxes (Wyatt, 2026-11-07): a template can have an
 * "Exhibit A" box on more than one page, and the list fills them in order (by page,
 * then down the page) rather than repeating. Each property is two lines (address,
 * then whole building or units) and a blank line after it. A box holds as many
 * lines as fit at Documenso's smallest type, 8 points.
 */
export const EXHIBIT_MIN_FONT = 8;
const PAGE_POINTS = 792; // US Letter height
export const exhibitBoxLines = (heightPct) => Math.max(1, Math.floor(((Number(heightPct) / 100) * PAGE_POINTS) / (EXHIBIT_MIN_FONT * 1.25)));

// The Exhibit A text split over its boxes: `blocks` are one string per property;
// `boxes` are [{ id, height }] in order. Returns [{ id, value }]; the last box takes
// whatever is left, so nothing is ever dropped.
export function splitExhibit(blocks, boxes) {
  if (!boxes.length) return [];
  if (boxes.length === 1 || !blocks.length) return boxes.map((b, i) => ({ id: b.id, value: i === 0 ? blocks.join("\n\n") || "None." : "" }));
  const out = [];
  let i = 0;
  boxes.forEach((b, n) => {
    const last = n === boxes.length - 1;
    const room = exhibitBoxLines(b.height);
    const chunk = [];
    let used = 0;
    while (i < blocks.length) {
      const lines = blocks[i].split("\n").length + (chunk.length ? 1 : 0);
      if (!last && chunk.length && used + lines > room) break;
      chunk.push(blocks[i]);
      used += lines;
      i += 1;
    }
    out.push({ id: b.id, value: chunk.join("\n\n") || (n === 0 ? "None." : "") });
  });
  return out;
}

export function templateFieldSummary(envelope) {
  const signer = signerOf(envelope);
  const mine = (envelope?.fields ?? []).filter((f) => !signer || f.recipientId === signer.id);
  const count = (type) => mine.filter((f) => f.type === type).length;
  const labelOf = (f) => String(f.fieldMeta?.label ?? "").trim();
  const matches = (types, re, not) => (f) => types.includes(f.type) && re.test(labelOf(f)) && !(not && not.test(labelOf(f)));
  const labelled = (types, re, not = null) => mine.find(matches(types, re, not));
  // Every box with that kind of label: a template may ask for the same value twice
  // (the owner on page 1 and on the signature page).
  const allLabelled = (types, re, not = null) => mine.filter(matches(types, re, not)).map((f) => f.id);
  const ref = (f) => (f ? { id: f.id, type: f.type === "NUMBER" ? "number" : "text", readOnly: f.fieldMeta?.readOnly === true } : null);

  // The commission rate: a Text or Number box labelled "Commission" or "Rate", or
  // else the template's only Number box (its label left blank).
  const numbers = mine.filter((f) => f.type === "NUMBER");
  const rate = labelled(["TEXT", "NUMBER"], /\b(commission|rate)\b/i) ?? (numbers.length === 1 ? numbers[0] : null);
  // Each Text box we fill is found by the words in its label (BOX_RULES).
  const kind = (k) => labelled(["TEXT"], ...BOX_RULES[k]);
  const title = kind("title");
  const address = kind("address");
  const fullName = kind("name");
  const owner = kind("owner");
  const company = kind("company");
  // The signature page's licensee details (MREC), no longer filled (2026-11-06).
  const brokerage = labelled(["TEXT"], /\bbrokerage\b/i);
  const license = labelled(["TEXT"], /\blicen[cs]e\b/i);
  return {
    recipientId: signer?.id ?? null,
    signature: count("SIGNATURE"),
    name: count("NAME"),
    date: count("DATE"),
    // Text boxes we fill in, found by their label in Documenso's editor.
    titleFieldId: title?.id ?? null,
    rateFieldId: rate?.id ?? null,
    addressFieldId: address?.id ?? null,
    nameFieldId: fullName?.id ?? null,
    companyFieldId: company?.id ?? null,
    ownerFieldId: owner?.id ?? null,
    // The signature page's licensee details (MREC): brokerage name and Missouri
    // license number, "N/A" for a landlord who is not licensed.
    brokerageFieldId: brokerage?.id ?? null,
    licenseFieldId: license?.id ?? null,
    fields: { title: ref(title), rate: ref(rate), address: ref(address), name: ref(fullName), company: ref(company), owner: ref(owner), brokerage: ref(brokerage), license: ref(license) },
    rateReadOnly: rate ? rate.fieldMeta?.readOnly === true : null,
    // Every box each value goes in, by kind.
    allIds: Object.fromEntries(Object.keys(BOX_RULES).map((k) => [k, allLabelled(["TEXT"], ...BOX_RULES[k])])),
    // Ready to go live: a signer with a Signature box, and the "Exhibit A" Text box
    // the covered properties go in (every envelope is one document, Wyatt 2026-11-06).
    missing: [
      ...(!signer || count("SIGNATURE") === 0 ? ["[SIGNATURE] (a Signature box)"] : []),
      ...(!kind("exhibit") ? ['[EXHIBIT A] (a Text box labelled "EXHIBIT A")'] : []),
    ],
    // Every box on the template, for the admin's "boxes found" list: its type and label.
    boxes: mine.map((f) => ({ type: f.type, label: labelOf(f) })),
    // The Exhibit A boxes in reading order, and about how many properties they hold.
    exhibitBoxes: exhibitBoxesOf(mine.filter(matches(["TEXT"], ...BOX_RULES.exhibit))),
    exhibitCapacity: exhibitBoxesOf(mine.filter(matches(["TEXT"], ...BOX_RULES.exhibit))).reduce((n, b) => n + Math.floor((exhibitBoxLines(b.height) + 1) / 3), 0),
    // Things that would go wrong on a landlord's copy, for the admin to fix first.
    warnings: templateWarnings(mine, labelOf),
    ok: !!signer && count("SIGNATURE") > 0 && !!kind("exhibit"),
  };
}

/*
 * Where an admin places the signature boxes on a template. Documenso's app is
 * team scoped (/t/<team url>/...). The exact path for envelope templates is not
 * in the public API docs, so this is a best guess, checked once the account
 * exists; the dashboard also links to the templates list as a fallback.
 */
export function templateEditorUrl(envelope, host = documensoHost()) {
  const team = envelope?.team?.url;
  if (!team || !envelope?.id) return `${host}/`;
  return `${host}/t/${encodeURIComponent(team)}/templates/${encodeURIComponent(envelope.id)}/edit`;
}

// Dates on our copies: 11/05/2026, no time, in St. Louis time (Wyatt, 2026-11-05).
export const DATE_SETTINGS = { dateFormat: "MM/dd/yyyy", timezone: "America/Chicago" };

const exhibitBoxesOf = (fields) =>
  fields
    .map((f) => ({ id: f.id, page: Number(f.page) || 1, positionY: Number(f.positionY) || 0, height: Number(f.height) || 0 }))
    .sort((a, b) => a.page - b.page || a.positionY - b.positionY);

// Boxes set up so the filled text would be cut off or refused.
function templateWarnings(fields, labelOf) {
  const out = [];
  const filled = fields.filter((f) => f.type === "TEXT" && Object.values(BOX_RULES).some(([re, not]) => re.test(labelOf(f)) && !(not && not.test(labelOf(f)))));
  for (const f of filled) {
    const limit = Number(f.fieldMeta?.characterLimit) || 0;
    if (limit > 0 && limit < 200) out.push(`[${labelOf(f)}] cuts its text at ${limit} characters. Clear the character limit in its settings.`);
  }
  const exhibit = fields.filter((f) => f.type === "TEXT" && BOX_RULES.exhibit[0].test(labelOf(f)) && !BOX_RULES.exhibit[1].test(labelOf(f)));
  const tall = exhibit.reduce((n, f) => n + ((Number(f.height) || 0) / 100) * PAGE_POINTS, 0);
  if (exhibit.length && tall < 150) {
    out.push(`The Exhibit A box is only about ${Math.max(1, Math.round(tall / 15))} line(s) tall, so a longer list runs on below it. Make it most of the page, or type [EXHIBIT A] in the document and upload it again.`);
  }
  return out;
}

// An initials box on every page of an exhibit.
function exhibitFields(exhibit, signerId, envelopeItemId) {
  return Array.from({ length: exhibit.pageCount }, (_, i) => ({
    type: "INITIALS",
    recipientId: signerId,
    envelopeItemId,
    page: i + 1,
    ...exhibit.initialsBox,
    fieldMeta: { type: "initials", required: true, label: "Initials" },
  }));
}

// Every Documenso email for a document, switched off.
export const DOCUMENSO_EMAILS_OFF = {
  recipientSigningRequest: false,
  recipientRemoved: false,
  recipientSigned: false,
  documentPending: false,
  documentCompleted: false,
  documentDeleted: false,
  ownerDocumentCompleted: false,
  ownerRecipientExpired: false,
  ownerDocumentCreated: false,
};

export function createDocumensoClient({
  apiKey = documensoSetting("DOCUMENSO_API_KEY"),
  host = documensoHost(),
  fetchImpl = (...args) => fetch(...args),
  emailSettings = null,
  folderId = null,
  titlePrefix = "",
  envTag = null,
} = {}) {
  const base = `${host}/api/v2`;
  // externalId says which environment made a document, e.g. "staging:landlord-agreement:<id>".
  const tagged = (id) => (envTag ? `${envTag}:${id}` : id);
  const titled = (t) => `${titlePrefix}${t}`.slice(0, 255);
  const copyTitle = (what, name, email) => titled(`${what}: ${name}${email && email !== name ? ` (${email})` : ""}`);

  async function request(method, path, { json, form, raw = false } = {}) {
    if (!apiKey) throw new DocumensoError("Documenso is not connected (DOCUMENSO_API_KEY is not set).", 503);
    const headers = { Authorization: apiKey };
    let body;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form) {
      body = form; // fetch sets the multipart boundary itself
    }
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, { method, headers, body });
    } catch (err) {
      throw new DocumensoError(`Could not reach Documenso: ${err?.message ?? err}`, 503);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // not JSON
      }
      const detail = parsed?.message ?? parsed?.error ?? text.slice(0, 300);
      throw new DocumensoError(`Documenso ${method} ${path} failed (${res.status}): ${detail}`, res.status, parsed);
    }
    if (raw) return new Uint8Array(await res.arrayBuffer());
    return res.json();
  }

  // The envelope endpoints that take files are multipart: a "payload" part holding
  // the JSON, plus "files".
  function multipart(payload, files = []) {
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    for (const f of files) form.append("files", new Blob([f.bytes], { type: "application/pdf" }), f.name);
    return form;
  }

  /*
   * The Text boxes we filled (they hold text now): read-only, since the landlord
   * changes these on our form before signing, and laid out to show it all. A box
   * sized for a short word lets the text run past its edge instead of cutting it
   * off; the multi-line "Exhibit A" boxes start at the top.
   */
  // A long Exhibit A list shrinks to fit its box (a US Letter page is 792 points
  // tall; a line takes about 1.25 times the font size), never below Documenso's
  // smallest, 8 points. A box only a line or two tall (placed by hand) keeps its
  // font and lets the list run on down the page instead of shrinking to nothing.
  function exhibitFontSize(f) {
    const own = Math.min(Math.max(Number(f.fieldMeta?.fontSize) || 12, 8), 96);
    const boxPoints = (Number(f.height) / 100) * 792;
    if (boxPoints < 60) return own;
    const lines = String(f.fieldMeta?.text ?? "").split("\n").length;
    const fits = Math.floor(boxPoints / (lines * 1.25));
    return Math.max(8, Math.min(own, fits));
  }

  async function settleFilledBoxes(envelopeId, envelope, signerId) {
    // A copy's boxes lose their labels, so the multi-line Exhibit A box is known by
    // its text: more than one line, or a tall box.
    const isExhibit = (f) => String(f.fieldMeta?.text ?? "").includes("\n") || Number(f.height) > 15;
    const filled = (envelope.fields ?? []).filter((f) => f.recipientId === signerId && f.type === "TEXT" && String(f.fieldMeta?.text ?? "").trim());
    if (!filled.length) return;
    await request("POST", "/envelope/field/update-many", {
      json: {
        envelopeId,
        data: filled.map((f) => ({
          id: f.id,
          type: "TEXT",
          fieldMeta: {
            ...(f.fieldMeta ?? {}),
            type: "text",
            readOnly: true,
            ...(isExhibit(f)
              ? { verticalAlign: "top", overflow: "vertical", textAlign: "left", fontSize: exhibitFontSize(f) }
              : { overflow: "horizontal" }),
          },
        })),
      },
    });
  }

  // Documenso's Name, Email and Date boxes become read-only text in the same place.
  async function replaceAutoBoxes(envelopeId, envelope, signerId, autofill) {
    const value = { NAME: autofill.name, EMAIL: autofill.email, DATE: autofill.date };
    const boxes = (envelope.fields ?? []).filter((f) => f.recipientId === signerId && value[f.type]);
    if (!boxes.length) return;
    for (const f of boxes) await request("POST", "/envelope/field/delete", { json: { fieldId: f.id } });
    await request("POST", "/envelope/field/create-many", {
      json: {
        envelopeId,
        data: boxes.map((f) => ({
          type: "TEXT",
          recipientId: signerId,
          envelopeItemId: f.envelopeItemId,
          page: f.page,
          positionX: Number(f.positionX),
          positionY: Number(f.positionY),
          width: Number(f.width),
          height: Number(f.height),
          fieldMeta: {
            type: "text",
            label: { NAME: "Name", EMAIL: "Email", DATE: "Date" }[f.type],
            text: String(value[f.type]).slice(0, 500),
            readOnly: true,
            // The template's box was sized for Documenso's own (shrink to fit)
            // box: let the text run past its edge rather than be cut off.
            overflow: "horizontal",
            ...(f.fieldMeta?.fontSize && { fontSize: f.fieldMeta.fontSize }),
            ...(f.fieldMeta?.textAlign && { textAlign: f.fieldMeta.textAlign }),
          },
        })),
      },
    });
  }

  return {
    async createTemplate({ title, pdfBytes, fileName, externalId }) {
      const created = await request("POST", "/envelope/create", {
        form: multipart(
          {
            title: titled(title),
            type: "TEMPLATE",
            externalId: tagged(externalId),
            // No folder: Documenso keeps template folders apart from document
            // folders, and DOCUMENSO_FOLDER_ID is a document folder.
            // The signer is a placeholder: each landlord's copy fills in their name and email.
            recipients: [{ email: "", name: "", role: "SIGNER" }],
            meta: { distributionMethod: "NONE", language: "en", typedSignatureEnabled: true, drawSignatureEnabled: true },
          },
          [{ bytes: pdfBytes, name: fileName || "commission-agreement.pdf" }]
        ),
      });
      return created.id;
    },

    getEnvelope(envelopeId) {
      return request("GET", `/envelope/${encodeURIComponent(envelopeId)}`);
    },

    /*
     * Boxes made from the PDF's placeholders (placeholders.js), added to a new
     * template for its placeholder signer. Text boxes carry their label, so they
     * are filled for each landlord; the ones we fill are read-only.
     */
    async addTemplateBoxes(envelopeId, boxes) {
      if (!boxes?.length) return 0;
      const envelope = await request("GET", `/envelope/${encodeURIComponent(envelopeId)}`);
      const signerId = signerOf(envelope)?.id;
      const itemId = [...(envelope.envelopeItems ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0]?.id;
      if (!signerId || !itemId) throw new DocumensoError("The template has no signer or document to add boxes to.", 502);
      const meta = (b) => {
        if (b.type === "SIGNATURE") return { type: "signature", required: true };
        if (b.type === "INITIALS") return { type: "initials", required: true, label: "Initials" };
        if (b.type === "DATE") return { type: "date", fontSize: b.fontSize };
        return {
          type: "text",
          label: b.label,
          readOnly: b.readOnly,
          required: !b.readOnly,
          fontSize: b.fontSize,
          ...(b.exhibit ? { overflow: "vertical", verticalAlign: "top", textAlign: "left" } : { overflow: "horizontal" }),
        };
      };
      await request("POST", "/envelope/field/create-many", {
        json: {
          envelopeId,
          data: boxes.map((b) => ({
            type: b.type,
            recipientId: signerId,
            envelopeItemId: itemId,
            page: b.page,
            positionX: b.positionX,
            positionY: b.positionY,
            width: b.width,
            height: b.height,
            fieldMeta: meta(b),
          })),
        },
      });
      return boxes.length;
    },

    /*
     * A landlord's copy, in two steps so it can be prepared while they answer the
     * license questions:
     *
     *   prepareSigningCopy  the copy of the template as a draft (nobody can sign a
     *                       draft), with every box we can fill already filled,
     *                       Exhibit A pages attached with an initials box on each
     *                       page (the agreement's Exhibit A, or an amendment's
     *                       before and after)
     *   finishSigningCopy   fills the last boxes (the licensee details), then
     *                       distributes with distributionMethod NONE, so Documenso
     *                       emails nobody; distributing issues the signing token
     *
     * `prefill` fills Text and Number boxes on the template: [{ id, value, type }].
     * `autofill` replaces Documenso's own Name, Email and Date boxes, which the
     * signer would otherwise click one by one, with read-only text holding the
     * value: { name, email, date }. Dates follow `dateFormat` (MM/dd/yyyy).
     */
    async prepareSigningCopy({ templateId, recipientId, email, name, externalId, titleFieldId = null, signerTitle = null, prefill = [], exhibit = null, title = null, autofill = null, dropRateBox = false }) {
      const prefillFields = [
        ...(titleFieldId && signerTitle ? [{ id: titleFieldId, value: signerTitle }] : []),
        ...prefill.filter((p) => p?.id && p.value != null && String(p.value).trim()),
      ].map((p) => ({ id: p.id, type: p.type === "number" ? "number" : "text", value: String(p.value).slice(0, 6000) }));
      const used = await request("POST", "/envelope/use", {
        form: multipart({
          envelopeId: templateId,
          externalId: tagged(externalId),
          recipients: [{ id: recipientId, email, name }],
          ...(folderId && { folderId }),
          // Named after the landlord, so it is easy to find in Documenso.
          override: { title: copyTitle(title || "Commission agreement", name, email), ...DATE_SETTINGS },
          ...(prefillFields.length && { prefillFields }),
          distributeDocument: false,
        }),
      });
      const envelope = await request("GET", `/envelope/${encodeURIComponent(used.id)}`);
      const signerId = signerOf(envelope)?.id;
      if (!signerId) throw new DocumensoError("The copy has no signer.", 502);
      if (autofill) await replaceAutoBoxes(used.id, envelope, signerId, autofill);
      await settleFilledBoxes(used.id, envelope, signerId);
      // The rate is in the agreement's text now (2026-11-05): an old template's rate box would sit empty.
      const rateBox = dropRateBox ? templateFieldSummary(envelope).fields.rate : null;
      if (rateBox) await request("POST", "/envelope/field/delete", { json: { fieldId: rateBox.id } });
      let exhibitItemId = null;
      if (exhibit) {
        const added = await request("POST", "/envelope/item/create-many", {
          form: multipart({ envelopeId: used.id }, [{ bytes: exhibit.bytes, name: exhibit.fileName || "exhibit-a.pdf" }]),
        });
        exhibitItemId = added?.data?.[0]?.id ?? null;
        if (!exhibitItemId) throw new DocumensoError("Documenso did not add the Exhibit A document.", 502, added);
        await request("POST", "/envelope/field/create-many", {
          json: { envelopeId: used.id, data: exhibitFields(exhibit, signerId, exhibitItemId) },
        });
      }
      return { envelopeId: used.id, exhibitItemId };
    },

    // `fill`: [{ id, value }] Text boxes to fill now, read-only.
    async finishSigningCopy({ envelopeId, fill = [] }) {
      const wanted = fill.filter((f) => f?.id && f.value != null && String(f.value).trim());
      if (wanted.length) {
        const envelope = await request("GET", `/envelope/${encodeURIComponent(envelopeId)}`);
        const data = wanted
          .map((f) => {
            const field = (envelope.fields ?? []).find((x) => x.id === f.id);
            if (!field || field.type !== "TEXT") return null;
            return { id: field.id, type: "TEXT", fieldMeta: { ...(field.fieldMeta ?? {}), type: "text", text: String(f.value).slice(0, 500), readOnly: true } };
          })
          .filter(Boolean);
        if (data.length) await request("POST", "/envelope/field/update-many", { json: { envelopeId, data } });
      }
      const sent = await request("POST", "/envelope/distribute", {
        json: { envelopeId, meta: { distributionMethod: "NONE", ...(emailSettings && { emailSettings }) } },
      });
      const signer = (sent.recipients ?? []).find((r) => r.role === "SIGNER") ?? sent.recipients?.[0];
      if (!signer?.token) throw new DocumensoError("Documenso did not return a signing token.", 502, sent);
      return { token: signer.token };
    },

    // Both steps at once, for callers that have every value up front.
    async createSigningCopy(args) {
      const prepared = await this.prepareSigningCopy(args);
      const { token } = await this.finishSigningCopy({ envelopeId: prepared.envelopeId });
      return { ...prepared, token };
    },

    // The completed PDF. An envelope holds one item per uploaded file; ours has one.
    async downloadSigned(envelope) {
      const items = [...(envelope?.envelopeItems ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      if (!items.length) throw new DocumensoError("The signed envelope has no document in it.", 502);
      return request("GET", `/envelope/item/${encodeURIComponent(items[0].id)}/download?version=signed`, { raw: true });
    },

    // Every signed document in the envelope, in order: the agreement, then Exhibit A.
    async downloadSignedItems(envelope) {
      const items = [...(envelope?.envelopeItems ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      if (!items.length) throw new DocumensoError("The signed envelope has no document in it.", 502);
      const out = [];
      for (const item of items) {
        const bytes = await request("GET", `/envelope/item/${encodeURIComponent(item.id)}/download?version=signed`, { raw: true });
        out.push({ id: item.id, order: item.order ?? 0, bytes });
      }
      return out;
    },

    cancel(envelopeId, reason) {
      return request("POST", "/envelope/cancel", { json: { envelopeId, reason } });
    },

    // Withdraw a copy: cancel one that was sent, delete a draft (Documenso cannot cancel a draft).
    async discard(envelopeId, reason) {
      try {
        return await request("POST", "/envelope/cancel", { json: { envelopeId, reason } });
      } catch (err) {
        // A draft cannot be cancelled (400), nor a template (404): delete those.
        if (err?.status !== 400 && err?.status !== 404) throw err;
        return request("POST", "/envelope/delete", { json: { envelopeId } });
      }
    },
  };
}
