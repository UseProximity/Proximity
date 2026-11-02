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
 * Configuration (each environment has its own Documenso team, so staging and
 * local never touch production documents):
 *   DOCUMENSO_API_KEY         team API key (Settings > API tokens)
 *   DOCUMENSO_WEBHOOK_SECRET  the secret set on the team's webhook
 *   DOCUMENSO_HOST            optional, defaults to https://app.documenso.com
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

export const DEFAULT_DOCUMENSO_HOST = "https://app.documenso.com";

export class DocumensoError extends Error {
  constructor(message, status = 500, body = null) {
    super(message);
    this.name = "DocumensoError";
    this.status = status;
    this.body = body;
  }
}

export function documensoHost() {
  return (process.env.DOCUMENSO_HOST || DEFAULT_DOCUMENSO_HOST).replace(/\/+$/, "");
}

export function documensoConfigured() {
  return !!process.env.DOCUMENSO_API_KEY;
}

/*
 * Documenso sends the webhook secret, as is, in X-Documenso-Secret (no HMAC). It
 * is compared in constant time. With no secret configured every request is
 * refused: an open endpoint would let anyone mark an agreement signed.
 */
export function verifyWebhookSecret(received, expected = process.env.DOCUMENSO_WEBHOOK_SECRET) {
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
  const titleField = mine.find((f) => f.type === "TEXT" && /\btitle\b/i.test(f.fieldMeta?.label ?? ""));
  return {
    recipientId: signer?.id ?? null,
    signature: count("SIGNATURE"),
    name: count("NAME"),
    date: count("DATE"),
    titleFieldId: titleField?.id ?? null,
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
  apiKey = process.env.DOCUMENSO_API_KEY,
  host = documensoHost(),
  fetchImpl = (...args) => fetch(...args),
  emailSettings = null,
} = {}) {
  const base = `${host}/api/v2`;

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
            title,
            type: "TEMPLATE",
            externalId,
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
     */
    async createSigningCopy({ templateId, recipientId, email, name, externalId, titleFieldId = null, signerTitle = null }) {
      const prefillFields = titleFieldId && signerTitle ? [{ id: titleFieldId, type: "text", value: signerTitle }] : [];
      const used = await request("POST", "/envelope/use", {
        form: multipart({
          envelopeId: templateId,
          externalId,
          recipients: [{ id: recipientId, email, name }],
          ...(prefillFields.length && { prefillFields }),
          distributeDocument: false,
        }),
      });
      const sent = await request("POST", "/envelope/distribute", {
        json: { envelopeId: used.id, meta: { distributionMethod: "NONE", ...(emailSettings && { emailSettings }) } },
      });
      const signer = (sent.recipients ?? []).find((r) => r.role === "SIGNER") ?? sent.recipients?.[0];
      if (!signer?.token) throw new DocumensoError("Documenso did not return a signing token.", 502, sent);
      return { envelopeId: used.id, token: signer.token };
    },

    // The completed PDF. An envelope holds one item per uploaded file; ours has one.
    async downloadSigned(envelope) {
      const items = [...(envelope?.envelopeItems ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      if (!items.length) throw new DocumensoError("The signed envelope has no document in it.", 502);
      return request("GET", `/envelope/item/${encodeURIComponent(items[0].id)}/download?version=signed`, { raw: true });
    },

    cancel(envelopeId, reason) {
      return request("POST", "/envelope/cancel", { json: { envelopeId, reason } });
    },
  };
}
