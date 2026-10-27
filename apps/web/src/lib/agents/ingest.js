/*
 * Getting documents and links into a listing's knowledge (PRD v3, with
 * Wyatt's note of 2026-10-26: every response, flyers and links included, is
 * synthesized into the agent's knowledge).
 *
 *   readDocument      a PDF or image goes to the model, which writes out what
 *                     it says about the building and flags a document that is
 *                     mostly one person's private details (a signed lease),
 *                     which is never stored.
 *   ingestDocument    readDocument, then a listing_documents row with the
 *                     redacted excerpt, then synthesizeKnowledge. The file
 *                     itself is never kept here: callers that stored one
 *                     delete it afterwards.
 *   ingestLinks       every http(s) link in a piece of text (a landlord's
 *                     answer, say) is fetched through the SSRF-guarded site
 *                     fetcher, reduced to text, and synthesized as a page
 *                     source. At most three per text.
 */
import { z } from "zod";
import supabase from "@/lib/supabase";
import { fetchPageSmart, htmlToText } from "@/lib/listingDraft/fetchSite";
import { parseStructured, SONNET } from "./model";
import { findOrCreateSource } from "./store";
import { synthesizeKnowledge } from "./synthesize";

const DOC_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const Reading = z.object({
  text: z.string().describe("Everything the document says that is about the building, its units, prices, fees, policies, amenities, specials or move-in process, written out plainly. Empty if nothing."),
  personal_document: z.boolean().describe("True when the document is mostly about one person: a signed lease, an application, an ID, a bank statement, a tenant's letter."),
  title: z.string().describe("A short title for the document, like 'Fee sheet' or 'Pet policy'."),
});

const READ_SYSTEM = `You read documents a landlord has shared about a rental building for WashU students. Write out everything in the document that a prospective renter would want to know about the building, its apartments, prices, fees, deposits, policies, amenities, specials, parking, utilities and the move-in process, as plain sentences that keep every number, condition and date. Leave out names, phone numbers, email addresses and anything about one specific person. If the document is mostly one person's private paperwork (a signed lease, an application, an ID), say so and write nothing from it. Never use an em dash.`;

export async function readDocument({ content, contentType, fileName = "", listingId = null }) {
  const type = String(contentType ?? "").toLowerCase();
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (!buf.length || buf.length > DOC_MAX_BYTES) return { error: "file too large or empty" };
  let block;
  if (type === "application/pdf") block = { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } };
  else if (IMAGE_TYPES.has(type)) block = { type: "image", source: { type: "base64", media_type: type, data: buf.toString("base64") } };
  else if (type.startsWith("text/")) block = { type: "text", text: buf.toString("utf8").slice(0, 60000) };
  else return { error: `unsupported type ${type}` };
  const { parsed } = await parseStructured({
    model: SONNET, system: READ_SYSTEM, schema: Reading, maxTokens: 6000, tag: "read-document", listingId, kind: "read_document",
    messages: [{ role: "user", content: [block, { type: "text", text: `File name: ${fileName || "(none)"}. Write out what it says about the building.` }] }],
  });
  if (!parsed) return { error: "could not read the document" };
  return { text: parsed.text ?? "", personal: !!parsed.personal_document, title: parsed.title ?? fileName };
}

/*
 * Returns { document, synthesis } or { document, rejected } or { error }.
 * The caller owns the file bytes; nothing is written to storage here.
 */
export async function ingestDocument({ listingId, content, contentType, fileName, uploadedBy = null, cause = "document", landlordSet = false, actorId = null, ownerDefault = null, question = null }) {
  const { data: doc, error } = await supabase.from("listing_documents")
    .insert({ listing_id: listingId, uploaded_by: uploadedBy, filename: String(fileName ?? "").slice(0, 200), mime_type: contentType, size_bytes: content?.length ?? null, status: "extracting" })
    .select("*").single();
  if (error) return { error: `document row: ${error.message}` };
  const done = async (patch) => {
    const { data } = await supabase.from("listing_documents").update({ ...patch, extracted_at: new Date().toISOString(), file_deleted_at: new Date().toISOString() }).eq("id", doc.id).select("*").single();
    return data ?? { ...doc, ...patch };
  };
  const reading = await readDocument({ content, contentType, fileName, listingId });
  if (reading.error) return { document: await done({ status: "failed", error: reading.error }), error: reading.error };
  if (reading.personal) {
    return { document: await done({ status: "rejected", reject_reason: "mostly one person's private details" }), rejected: true };
  }
  if (!reading.text.trim()) return { document: await done({ status: "done", excerpt: null, facts_count: 0 }), synthesis: null };
  const source = await findOrCreateSource({ listingId, kind: "document", documentId: doc.id, label: reading.title || fileName, userId: uploadedBy });
  const synthesis = await synthesizeKnowledge({
    listingId, text: reading.text, sourceKind: "document", sourceId: source.id, sourceRef: `document:${doc.id}`,
    cause, landlordSet, setBy: landlordSet ? actorId : null, actorId, ownerDefault, question,
  });
  const document = await done({ status: "done", excerpt: reading.text.slice(0, 2000), facts_count: synthesis.written + synthesis.unchanged });
  return { document, synthesis };
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
export function extractUrls(text, max = 3) {
  const seen = new Set();
  for (const m of String(text ?? "").match(URL_RE) ?? []) {
    const u = m.replace(/[.,;:!?)]+$/, "");
    if (!seen.has(u)) seen.add(u);
    if (seen.size >= max) break;
  }
  return [...seen];
}

export async function ingestLinks({ listingId, text, cause = "landlord_answer", landlordSet = false, actorId = null, ownerDefault = null, question = null }) {
  const results = [];
  for (const url of extractUrls(text)) {
    try {
      const page = await fetchPageSmart(url);
      const body = htmlToText(page?.html ?? "").trim();
      if (body.length < 80) { results.push({ url, skipped: "no readable text" }); continue; }
      const source = await findOrCreateSource({ listingId, kind: "page", url, label: page?.title || url });
      const synthesis = await synthesizeKnowledge({
        listingId, text: body.slice(0, 20000), sourceKind: "page", sourceId: source.id, sourceRef: url,
        cause, landlordSet, setBy: landlordSet ? actorId : null, actorId, ownerDefault, question,
      });
      results.push({ url, written: synthesis.written, retired: synthesis.retired });
    } catch (err) {
      results.push({ url, error: String(err?.message ?? err).slice(0, 200) });
    }
  }
  return results;
}
