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
export function templateFieldSummary(envelope) {
  const signer = signerOf(envelope);
  const mine = (envelope?.fields ?? []).filter((f) => !signer || f.recipientId === signer.id);
  const count = (type) => mine.filter((f) => f.type === type).length;
  const textField = (re) => mine.find((f) => f.type === "TEXT" && re.test(f.fieldMeta?.label ?? ""))?.id ?? null;
  return {
    recipientId: signer?.id ?? null,
    signature: count("SIGNATURE"),
    name: count("NAME"),
    date: count("DATE"),
    // Text boxes we fill in, found by their label in Documenso's editor.
    titleFieldId: textField(/\btitle\b/i),
    rateFieldId: textField(/\bcommission\b/i),
    addressFieldId: textField(/\baddress\b/i),
    ok: !!signer && count("SIGNATURE") > 0,
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
     * A landlord's copy of the template, ready to sign in the embed. Made as a draft
     * first and then distributed with distributionMethod NONE, so Documenso sends
     * no email of its own; distributing is what issues the signing token.
     *
     * `prefill` fills text boxes on the template: [{ id, value }] (title, commission
     * rate, address). `exhibit` ({ bytes, fileName, pageCount, initialsBox }) is
     * attached to the draft as a second document, with an initials box for the
     * signer on each of its pages, before it is distributed.
     */
    async createSigningCopy({ templateId, recipientId, email, name, externalId, titleFieldId = null, signerTitle = null, prefill = [], exhibit = null, title = null }) {
      const prefillFields = [
        ...(titleFieldId && signerTitle ? [{ id: titleFieldId, value: signerTitle }] : []),
        ...prefill.filter((p) => p?.id && p.value != null && String(p.value).trim()),
      ].map((p) => ({ id: p.id, type: "text", value: String(p.value).slice(0, 500) }));
      const used = await request("POST", "/envelope/use", {
        form: multipart({
          envelopeId: templateId,
          externalId: tagged(externalId),
          recipients: [{ id: recipientId, email, name }],
          ...(folderId && { folderId }),
          // Named after the landlord, so it is easy to find in Documenso.
          override: { title: titled(`${title || "Commission agreement"}: ${name}${email && email !== name ? ` (${email})` : ""}`) },
          ...(prefillFields.length && { prefillFields }),
          distributeDocument: false,
        }),
      });
      let exhibitItemId = null;
      if (exhibit) {
        const added = await request("POST", "/envelope/item/create-many", {
          form: multipart({ envelopeId: used.id }, [{ bytes: exhibit.bytes, name: exhibit.fileName || "exhibit-a.pdf" }]),
        });
        exhibitItemId = added?.data?.[0]?.id ?? null;
        if (!exhibitItemId) throw new DocumensoError("Documenso did not add the Exhibit A document.", 502, added);
        const signerId = (await request("GET", `/envelope/${encodeURIComponent(used.id)}`)).recipients?.find((r) => r.role === "SIGNER")?.id;
        if (!signerId) throw new DocumensoError("The copy has no signer to initial Exhibit A.", 502);
        const box = exhibit.initialsBox;
        await request("POST", "/envelope/field/create-many", {
          json: {
            envelopeId: used.id,
            data: Array.from({ length: exhibit.pageCount }, (_, i) => ({
              type: "INITIALS",
              recipientId: signerId,
              envelopeItemId: exhibitItemId,
              page: i + 1,
              ...box,
              fieldMeta: { type: "initials", required: true, label: "Initials" },
            })),
          },
        });
      }
      const sent = await request("POST", "/envelope/distribute", {
        json: { envelopeId: used.id, meta: { distributionMethod: "NONE", ...(emailSettings && { emailSettings }) } },
      });
      const signer = (sent.recipients ?? []).find((r) => r.role === "SIGNER") ?? sent.recipients?.[0];
      if (!signer?.token) throw new DocumensoError("Documenso did not return a signing token.", 502, sent);
      return { envelopeId: used.id, token: signer.token, exhibitItemId };
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
  };
}
