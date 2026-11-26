/*
 * Vision screening for chat attachments.
 *
 * lib/chat/moderation.js blocks contact details in message text. Without this
 * that rule is theatre: a screenshot of "email me at j@gmail.com" is a few
 * seconds of work and the text screen never sees a pixel.
 *
 * Why a model rather than OCR plus the text regexes:
 *
 *   A lease, an application form and a move-in checklist all legitimately
 *   carry the landlord's name, office number and email. Those are the most
 *   important documents anyone sends in this product, and OCR feeding the text
 *   screen would block every one of them. The question is not whether contact
 *   details are PRESENT, it is whether conveying them is the POINT of the
 *   attachment. That is a judgement, so it goes to a vision model.
 *
 * Runs before the message row exists, so a blocked attachment never reaches
 * the recipient. Costs roughly 1.5 to 3 seconds on an attachment send, on top
 * of an upload the sender has already waited through.
 *
 * Fails OPEN. A model timeout, a bad key or an unreadable file flags the send
 * for review and lets it through. A scanner outage must not take chat down
 * with it, and the alternative is refusing legitimate leases whenever the
 * model has a bad minute.
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { r2, getBucket } from "@/lib/r2";

export const CHAT_SCAN_MODEL = "claude-haiku-4-5";

/*
 * Anthropic rejects oversized payloads, and base64 inflates by about a third.
 * Images arrive compressed client-side (1600px, quality 0.72) so they land far
 * under this; a big scanned PDF will not, and is flagged rather than blocked.
 */
const MAX_SCAN_BYTES = 4 * 1024 * 1024;

/*
 * A dedicated key, falling back to the general one. Deliberately NOT
 * LEASE_SCANNER_KEY: that key already has spend nobody has been able to
 * attribute, and adding a second feature to it would make that permanently
 * unanswerable.
 */
let _client = null;
function getClient() {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.CHAT_MODERATION_KEY || process.env.ANTHROPIC_API_KEY,
    });
  }
  return _client;
}

const ScanSchema = z.object({
  documentKind: z.enum([
    "apartment_photo",
    "lease_or_application",
    "receipt_or_invoice",
    "contact_card",
    "screenshot_of_conversation",
    "other",
  ]),
  // The decisive field. True only when the attachment exists in order to hand
  // over a way to make contact away from Proximity.
  contactDetailsArePrimaryPurpose: z.boolean(),
  // A QR code is a link, and a link is how you leave the platform.
  containsQrOrBarcode: z.boolean(),
  // Asking for money, especially through a rail Proximity cannot protect.
  containsPaymentSolicitation: z.boolean(),
  // Present but incidental, e.g. the landlord's number inside a lease.
  containsIncidentalContactDetails: z.boolean(),
  reason: z.string(),
});

const SYSTEM = `You screen attachments sent in a private chat between a student and a landlord on a student housing marketplace.

Decide whether the attachment exists in order to move the conversation off the platform, or to extract money.

contactDetailsArePrimaryPurpose must be true ONLY when handing over a way to make contact elsewhere is the point of the attachment. Examples: a photo of a phone number written on paper, a screenshot of an email signature, a business card, a contact screen, a note saying to text or email instead.

It must be FALSE when contact details appear incidentally inside a document that has its own purpose. A lease, a rental application, a move-in checklist or an invoice normally carries the landlord's name, office number and email, and sending those documents is a normal and expected part of renting. Set containsIncidentalContactDetails true in that case instead.

containsPaymentSolicitation must be true for a request to send money through gift cards, wire transfer, cryptocurrency, Zelle, Venmo or Cash App, or a demand for a deposit before a lease is signed. A rent figure stated inside a lease or listing is not a solicitation.

Keep reason under 20 words. Do not use em dashes.`;

async function fetchForScan(key) {
  const bucket = getBucket();
  if (!bucket) throw new Error("R2 bucket env missing");

  const res = await r2.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  const bytes = Buffer.from(await res.Body.transformToByteArray());
  return bytes;
}

function contentBlockFor(bytes, contentType) {
  const data = bytes.toString("base64");
  if (contentType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data },
    };
  }
  return {
    type: "image",
    source: { type: "base64", media_type: contentType, data },
  };
}

/**
 * Screen one attachment.
 *
 * @returns {Promise<{verdict: "block"|"flag"|"allow", reasons: string[]}>}
 */
async function scanOne({ key, contentType, fileName }) {
  let bytes;
  try {
    bytes = await fetchForScan(key);
  } catch (error) {
    console.error("chat attachment scan: R2 fetch failed", fileName, error);
    return { verdict: "flag", reasons: ["attachment_scan_unavailable"] };
  }

  if (bytes.byteLength > MAX_SCAN_BYTES) {
    return { verdict: "flag", reasons: ["attachment_too_large_to_scan"] };
  }

  let parsed;
  try {
    const response = await getClient().messages.parse({
      model: CHAT_SCAN_MODEL,
      max_tokens: 300,
      output_config: { format: zodOutputFormat(ScanSchema) },
      messages: [
        {
          role: "user",
          content: [
            contentBlockFor(bytes, contentType),
            {
              type: "text",
              text: "Screen this attachment sent in a landlord and student chat.",
            },
          ],
        },
      ],
      // Cached like the lease scanner's system prompt: it is identical on every
      // call, and an attachment send can carry up to five of them.
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      ],
    });
    parsed = response.parsed_output;
  } catch (error) {
    console.error("chat attachment scan: model call failed", fileName, error);
    return { verdict: "flag", reasons: ["attachment_scan_unavailable"] };
  }

  // parsed_output is null when the model's output failed schema parsing.
  if (!parsed) {
    return { verdict: "flag", reasons: ["attachment_scan_unparsed"] };
  }

  const reasons = [];
  if (parsed.contactDetailsArePrimaryPurpose) reasons.push("attachment_contact_details");
  if (parsed.containsQrOrBarcode) reasons.push("attachment_qr_code");
  if (parsed.containsPaymentSolicitation) reasons.push("attachment_payment_solicitation");

  if (reasons.length > 0) {
    return { verdict: "block", reasons };
  }

  const flags = [];
  if (parsed.containsIncidentalContactDetails) {
    flags.push("attachment_incidental_contact_details");
  }
  if (parsed.documentKind === "screenshot_of_conversation") {
    flags.push("attachment_conversation_screenshot");
  }
  return { verdict: flags.length > 0 ? "flag" : "allow", reasons: flags };
}

/**
 * Screen every attachment on a send. Scans in parallel; one block blocks the
 * message, since the files go as a single message.
 *
 * @param {{attachments: {key: string, contentType: string, fileName: string}[]}} input
 * @returns {Promise<{blocked: boolean, message: string|null, reasons: string[]}>}
 */
export async function scanChatAttachments({ attachments }) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length === 0) {
    return { blocked: false, message: null, reasons: [] };
  }

  const results = await Promise.all(list.map((a) => scanOne(a)));

  const reasons = [...new Set(results.flatMap((r) => r.reasons))];
  const blocked = results.some((r) => r.verdict === "block");

  return {
    blocked,
    message: blocked ? blockMessageFor(reasons) : null,
    reasons,
  };
}

function blockMessageFor(reasons) {
  if (reasons.includes("attachment_payment_solicitation")) {
    return "This file cannot be sent because it asks for payment. Never send a deposit before signing a lease and seeing the unit.";
  }
  return "This file cannot be sent because it shares contact details or a link. Keep the conversation on Proximity so every message about this place stays in one place for both of you.";
}
