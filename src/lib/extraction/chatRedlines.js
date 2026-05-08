import supabase from "@/lib/supabase";
import { runToolExtraction } from "@/lib/anthropic";
import {
  PROMPT_VERSION, SYSTEM_PROMPT, buildPrompt,
  TOOL_NAME, TOOL_DESCRIPTION, TOOL_SCHEMA,
} from "./prompts/chatRedlines.v1.js";

/**
 * Analyse a chat thread alongside a lease template and propose redlines.
 * Inserts new lease_redlines rows (pending) and writes a lease_extraction_runs record.
 * Idempotent: passes existing redlines so the model doesn't re-propose them.
 *
 * @param {string} executedLeaseId - executed_leases.id
 * @param {string} templateText    - full text of the lease template
 * @param {string} chatThreadId    - chat_threads.id to read messages from
 * @param {string} landlordId      - for attribution
 */
export async function proposeChatRedlines(executedLeaseId, templateText, chatThreadId, landlordId) {
  const start = Date.now();

  // Fetch chat messages
  const { data: messages } = await supabase
    .from("chat_messages")
    .select("id, body, sender_id, created_at")
    .eq("thread_id", chatThreadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  // Fetch existing redlines for idempotency
  const { data: existingRedlines } = await supabase
    .from("lease_redlines")
    .select("section_label, original_text")
    .eq("executed_lease_id", executedLeaseId);

  // Resolve sender roles (landlord vs tenant) for the prompt
  const { data: executed } = await supabase
    .from("executed_leases")
    .select("listing_id, executed_lease_tenants(user_id)")
    .eq("id", executedLeaseId)
    .single();

  const tenantIds = new Set(
    (executed?.executed_lease_tenants ?? []).map((t) => t.user_id).filter(Boolean)
  );

  const chatMessages = (messages ?? []).map((m) => ({
    role: tenantIds.has(m.sender_id) ? "tenant" : "landlord",
    body: m.body,
    sent_at: m.created_at,
    sender_id: m.sender_id,
    id: m.id,
  }));

  let run;
  try {
    const { toolInput, durationMs, modelUsed } = await runToolExtraction({
      toolName: TOOL_NAME,
      toolDescription: TOOL_DESCRIPTION,
      toolSchema: TOOL_SCHEMA,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: buildPrompt(templateText, chatMessages, existingRedlines ?? []),
      }],
    });

    const redlines = toolInput.redlines ?? [];
    const { data: runRow } = await supabase
      .from("lease_extraction_runs")
      .insert({
        executed_lease_id: executedLeaseId,
        run_type: "chat_redline_proposal",
        prompt_version: PROMPT_VERSION,
        model_used: modelUsed,
        duration_ms: durationMs,
        fields_extracted_count: redlines.length,
        avg_confidence: redlines.length
          ? redlines.reduce((s, r) => s + (r.confidence ?? 0), 0) / redlines.length
          : 0,
        per_field_confidence: Object.fromEntries(
          redlines.map((r, i) => [`redline_${i}`, r.confidence ?? 0])
        ),
        status: "success",
      })
      .select("id")
      .single();
    run = runRow;

    // Insert new redline rows
    if (redlines.length > 0) {
      const rows = redlines.map((r) => {
        const chatMsgId = r.rationale_chat_message_index != null
          ? chatMessages[r.rationale_chat_message_index]?.id ?? null
          : null;
        return {
          executed_lease_id: executedLeaseId,
          section_label: r.section_label,
          section_anchor: r.section_anchor ?? null,
          original_text: r.original_text,
          suggested_text: r.suggested_text,
          rationale: r.rationale,
          rationale_chat_message_id: chatMsgId,
          ai_confidence: r.confidence,
          extraction_run_id: run?.id,
          status: "pending",
        };
      });
      await supabase.from("lease_redlines").insert(rows);
    }

    return {
      runId: run?.id,
      redlinesProposed: redlines.length,
      unresolvedPoints: toolInput.unresolved_negotiation_points ?? [],
    };

  } catch (err) {
    await supabase.from("lease_extraction_runs").insert({
      executed_lease_id: executedLeaseId,
      run_type: "chat_redline_proposal",
      prompt_version: PROMPT_VERSION,
      model_used: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
      duration_ms: Date.now() - start,
      fields_extracted_count: 0,
      avg_confidence: 0,
      per_field_confidence: {},
      status: "failed",
      error_message: err.message,
    });
    throw err;
  }
}
