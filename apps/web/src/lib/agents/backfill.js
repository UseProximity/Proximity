/*
 * The chat-history backfill (Wyatt, 2026-10-26): every landlord message and
 * attachment in today's student-to-landlord threads is read into the
 * listing's knowledge, once, so the agents start out knowing what landlords
 * have already told students.
 *
 * One thread = one synthesis: the landlord's messages, with the student's
 * messages as context, go through Proxy's synthesis as a 'chat_backfill'
 * source (landlord-set, since it is the landlord's own word). PDF and image
 * attachments the landlord sent are fetched from storage and read as
 * documents. A thread is marked done by its source row, so a second run
 * skips it; a thread with new landlord messages since is re-read.
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import supabase from "@/lib/supabase";
import { r2, getBucket } from "@/lib/r2";
import { findOrCreateSource, ensureAgent } from "./store";
import { synthesizeKnowledge } from "./synthesize";
import { ingestDocument } from "./ingest";

const DOC_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

async function directTypeId() {
  const { data } = await supabase.from("thread_types").select("id").eq("name", "direct").maybeSingle();
  return data?.id ?? null;
}

/* Threads with at least one landlord message, newest first. */
export async function backfillCandidates({ limit = 500, listingId = null } = {}) {
  const typeId = await directTypeId();
  let q = supabase.from("chat_threads").select("id, listing_id, landlord_id, interested_user_id, updated_at")
    .eq("thread_type_id", typeId).is("deleted_at", null).not("listing_id", "is", null).not("landlord_id", "is", null)
    .order("updated_at", { ascending: false }).limit(limit);
  if (listingId) q = q.eq("listing_id", listingId);
  const { data } = await q;
  return data ?? [];
}

export async function backfillThread(thread) {
  const { data: msgs } = await supabase.from("chat_messages").select("id, sender_id, body, message_type, metadata, created_at")
    .eq("thread_id", thread.id).is("deleted_at", null).order("created_at", { ascending: true }).limit(400);
  const M = msgs ?? [];
  const landlordMsgs = M.filter((m) => m.sender_id === thread.landlord_id);
  if (!landlordMsgs.length) return { skipped: "no landlord messages" };
  const last = landlordMsgs[landlordMsgs.length - 1];

  await ensureAgent(thread.listing_id);
  const source = await findOrCreateSource({ listingId: thread.listing_id, kind: "chat_backfill", label: `thread:${thread.id}`, userId: thread.landlord_id });
  const { data: existingSource } = await supabase.from("listing_sources").select("id, last_fingerprint").eq("id", source.id).maybeSingle();
  if (existingSource?.last_fingerprint === last.id) return { skipped: "already read" };

  const transcript = M.map((m) => {
    const who = m.sender_id === thread.landlord_id ? "LANDLORD" : "STUDENT";
    const body = m.message_type === "attachment" ? `${m.metadata?.caption ?? ""} [sent ${(m.metadata?.attachments ?? []).map((a) => a.fileName).join(", ") || "an attachment"}]` : m.body;
    return `${who}: ${String(body ?? "").trim()}`;
  }).join("\n").slice(0, 16000);

  const synthesis = await synthesizeKnowledge({
    listingId: thread.listing_id, text: transcript, sourceKind: "chat_backfill", sourceId: source.id, sourceRef: `thread:${thread.id}`,
    cause: "backfill", landlordSet: true, setBy: thread.landlord_id, actorId: null,
  });

  // Attachments the landlord sent: flyers, fee sheets.
  let documents = 0;
  const bucket = getBucket();
  if (bucket) {
    const { data: files } = await supabase.from("chat_attachments").select("r2_key, file_name, content_type, size_bytes").eq("thread_id", thread.id).eq("uploader_id", thread.landlord_id).limit(10);
    for (const f of files ?? []) {
      if (!DOC_TYPES.has(String(f.content_type)) || Number(f.size_bytes) > 10 * 1024 * 1024) continue;
      try {
        const obj = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: f.r2_key }));
        const content = Buffer.from(await obj.Body.transformToByteArray());
        const r = await ingestDocument({ listingId: thread.listing_id, content, contentType: f.content_type, fileName: f.file_name, uploadedBy: thread.landlord_id, cause: "backfill", landlordSet: true, actorId: null });
        if (r.synthesis) documents++;
      } catch (err) {
        console.error("[backfill] attachment failed:", f.r2_key, err?.message ?? err);
      }
    }
  }
  await supabase.from("listing_sources").update({ last_fingerprint: last.id, last_checked_at: new Date().toISOString(), last_status: "ok" }).eq("id", source.id);
  return { threadId: thread.id, listingId: thread.listing_id, written: synthesis.written, unchanged: synthesis.unchanged, held: synthesis.held, documents, notes: synthesis.notes };
}

export async function runBackfill({ limit = 200, listingId = null } = {}) {
  const threads = await backfillCandidates({ limit, listingId });
  const out = { threads: threads.length, read: 0, skipped: 0, written: 0, documents: 0, failed: [] };
  for (const t of threads) {
    try {
      const r = await backfillThread(t);
      if (r.skipped) { out.skipped++; continue; }
      out.read++; out.written += r.written; out.documents += r.documents;
    } catch (err) {
      out.failed.push({ threadId: t.id, error: String(err?.message ?? err).slice(0, 200) });
    }
  }
  return out;
}
