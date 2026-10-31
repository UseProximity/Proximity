/*
 * Document upload for a listing's agent (PRD v3: PDF, images or DOCX up to
 * 10MB). Two steps, because a function request body is capped well under
 * 10MB: the browser uploads straight to storage with a signed URL, then
 * asks the agent to read it. The file is deleted from storage once read;
 * only a redacted excerpt stays (listing_documents).
 *
 *   POST { fileName, contentType, size }       -> { uploadUrl, key }
 *   POST { key, fileName, contentType }         -> read it: { document, synthesis }
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { r2, getBucket } from "@/lib/r2";
import { agentGate, readJson } from "@/lib/agents/gate";
import { ingestDocument } from "@/lib/agents/ingest";
import { isPropertyOwner } from "@/lib/listings/ownership";
import { recentlyClaimed } from "@/lib/agents/coreWrites";

const MAX = 10 * 1024 * 1024;
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "text/plain"]);
const safeName = (n) => String(n ?? "file").replace(/[^\w.() -]+/g, "_").slice(0, 120);

export async function POST(req, { params }) {
  const { listingId } = await params;
  const g = await agentGate(listingId);
  if (g.res) return g.res;
  const body = await readJson(req);
  const bucket = getBucket();
  if (!bucket) return NextResponse.json({ error: "Uploads are not configured" }, { status: 500 });
  try {
    if (!body?.key) {
      if (!TYPES.has(body?.contentType)) return NextResponse.json({ error: "PDF, images or plain text only." }, { status: 400 });
      if (!Number.isInteger(body?.size) || body.size <= 0 || body.size > MAX) return NextResponse.json({ error: "Files must be 10MB or smaller." }, { status: 400 });
      const key = `agent-documents/${listingId}/${randomUUID()}-${safeName(body.fileName)}`;
      const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: body.contentType, ContentLength: body.size }), { expiresIn: 600 });
      return NextResponse.json({ uploadUrl, key });
    }
    const key = String(body.key);
    if (!key.startsWith(`agent-documents/${listingId}/`)) return NextResponse.json({ error: "Bad key" }, { status: 400 });
    const obj = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const content = Buffer.from(await obj.Body.transformToByteArray());
    const owner = g.isAdmin || (await isPropertyOwner(g.userId, listingId));
    const recent = !g.isAdmin && (await recentlyClaimed(g.userId, listingId));
    const result = await ingestDocument({
      listingId, content, contentType: String(body.contentType ?? obj.ContentType ?? ""), fileName: safeName(body.fileName), uploadedBy: g.userId,
      cause: "document", landlordSet: !recent, actorId: g.userId, ownerDefault: owner ? null : g.userId,
    });
    await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch((err) => console.error("[agents] document delete failed:", err?.message ?? err));
    if (result.error) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({
      document: { id: result.document.id, status: result.document.status, excerpt: result.document.excerpt, rejectReason: result.document.reject_reason ?? null },
      rejected: !!result.rejected,
      synthesis: result.synthesis ? { written: result.synthesis.written, unchanged: result.synthesis.unchanged, retired: result.synthesis.retired, held: result.synthesis.held, notes: result.synthesis.notes, ops: result.synthesis.ops } : null,
    });
  } catch (err) {
    console.error("POST agent/documents failed:", err);
    return NextResponse.json({ error: "Could not read that document" }, { status: 500 });
  }
}
