/*
 * Files a landlord's site links to instead of putting the numbers on the
 * page: a PDF availability list, a JPG price sheet, a Google Sheet of open
 * units, a Google Doc of policies, a file on Google Drive.
 *
 * Read as bytes they are gibberish to the extraction, so they are turned
 * into text first: a spreadsheet or document Google can export is fetched
 * as CSV or plain text; a PDF or picture goes to Haiku, which reads both,
 * with one instruction: transcribe the rental facts exactly. The text is
 * then a page like any other, for the extraction and the page hunt.
 *
 * Shared with the rest of the batch through the page cache, so twelve
 * buildings on one availability PDF read it once.
 */
import Anthropic from "@anthropic-ai/sdk";
import { fetchAssetResponse, readAssetCapped } from "@/lib/listingDraft/fetchSite";
import { HAIKU, logCost } from "../model.js";
import { pageCacheStore } from "../pageCache.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 60000;
// Images over this go to the model shrunk; the API refuses large ones.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const DOCUMENT_EXT_RE = /\.(pdf|jpe?g|png|webp|gif)(\?|#|$)/i;
const DRIVE_FILE_RE = /^https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{10,})/i;
const SHEET_RE = /^https?:\/\/docs\.google\.com\/spreadsheets\/d\/(?!e\/)([A-Za-z0-9_-]{10,})/i;
const DOC_RE = /^https?:\/\/docs\.google\.com\/document\/d\/(?!e\/)([A-Za-z0-9_-]{10,})/i;
const SLIDES_RE = /^https?:\/\/docs\.google\.com\/presentation\/d\/(?!e\/)([A-Za-z0-9_-]{10,})/i;

/* A link that is a file to read rather than a page to fetch. */
export function isDocumentUrl(url) {
  return DOCUMENT_EXT_RE.test(url) || DRIVE_FILE_RE.test(url) || SHEET_RE.test(url) || DOC_RE.test(url) || SLIDES_RE.test(url);
}

/* Where Google will hand over the file itself, or the URL as it is. */
function exportUrl(url) {
  let m = url.match(SHEET_RE);
  if (m) {
    const gid = url.match(/[#&?]gid=(\d+)/)?.[1];
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
  }
  m = url.match(DOC_RE);
  if (m) return `https://docs.google.com/document/d/${m[1]}/export?format=txt`;
  m = url.match(SLIDES_RE);
  if (m) return `https://docs.google.com/presentation/d/${m[1]}/export/pdf`;
  m = url.match(DRIVE_FILE_RE);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return url;
}

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.LISTING_DRAFT_KEY || process.env.ANTHROPIC_API_KEY });
  return _client;
}

let sharpLoader = null;
function getSharp() {
  if (sharpLoader === null) sharpLoader = import("sharp").then((m) => m.default ?? m).catch(() => false);
  return sharpLoader;
}

const TRANSCRIBE =
  "This file is linked from a rental property's website. Transcribe every fact in it that a renter would want, as plain text: property names and addresses, apartment or unit numbers, bedrooms, bathrooms, square feet, rents (say per person or per apartment if the file does), deposits and fees, lease lengths, move-in or availability dates, specials, utilities included, pet policy, parking, and contact details. Keep tables as one row per line with \" | \" between columns and the header row first. Copy every figure and date exactly as written; never estimate or add anything. If the file has nothing about renting a home, reply with the single word NONE.";

async function transcribe(block, url) {
  const response = await getClient().messages.create({
    model: HAIKU,
    max_tokens: 6000,
    messages: [{ role: "user", content: [block, { type: "text", text: TRANSCRIBE }] }],
  });
  const cost = logCost(`document ${url.slice(0, 60)}`, HAIKU, response.usage) ?? 0;
  const text = (response.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  return { text: /^NONE\.?$/i.test(text) ? "" : text, cost };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/*
 * Read one file. Returns { page: { html, finalUrl, document: kind }, cost }
 * or null when it is not a readable file or says nothing about renting.
 */
export async function readDocument(url) {
  const key = `doc:${url}`;
  const hit = await pageCacheStore.get(key).catch(() => null);
  if (hit) return { page: hit, cost: 0 };

  let res;
  try {
    res = await fetchAssetResponse(exportUrl(url));
  } catch (err) {
    console.log(`[source-import] document not fetched (${err?.message}): ${url.slice(0, 100)}`);
    return null;
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const buf = await readAssetCapped(res, MAX_BYTES).catch(() => null);
  if (!buf) return null;
  const read = await readDocumentBytes(buf, type, url);
  if (read?.page) await pageCacheStore.set(key, read.page).catch(() => {});
  return read;
}

/* The same, for bytes already in hand (and for testing). */
export async function readDocumentBytes(buf, type, url) {
  let text = "";
  let cost = 0;
  let kind = type;
  try {
    if (type === "text/csv" || type === "text/plain" || type === "text/tab-separated-values") {
      text = buf.toString("utf8").replace(/,/g, " | ");
      if (type === "text/plain") text = buf.toString("utf8");
    } else if (type === "application/pdf") {
      ({ text, cost } = await transcribe({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }, url));
    } else if (/^image\/(png|jpeg|jpg|webp|gif)$/.test(type)) {
      let data = buf;
      let mediaType = type === "image/jpg" ? "image/jpeg" : type;
      if (buf.length > MAX_IMAGE_BYTES) {
        const sharp = await getSharp();
        if (!sharp) return null;
        data = await sharp(buf).rotate().resize({ width: 2000, height: 2000, fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
        mediaType = "image/jpeg";
      }
      ({ text, cost } = await transcribe({ type: "image", source: { type: "base64", media_type: mediaType, data: data.toString("base64") } }, url));
    } else {
      // An HTML page behind a file-looking link (a Drive sign-in wall): not ours to read here.
      return null;
    }
  } catch (err) {
    console.error(`[source-import] document read failed for ${url.slice(0, 100)}: ${err?.message}`);
    return null;
  }
  text = text.trim().slice(0, MAX_TEXT);
  console.log(`[source-import] document ${kind} ${url.slice(0, 90)}: ${text ? `${text.length} chars` : "nothing about renting"}`);
  if (!text) return null;
  const page = { html: `<html><body><h1>File linked from the website: ${esc(url)}</h1><pre>${esc(text)}</pre></body></html>`, finalUrl: url, document: kind };
  return { page, cost };
}
