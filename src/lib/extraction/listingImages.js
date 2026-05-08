import supabase from "@/lib/supabase";
import { runToolExtraction, IMAGE_TIMEOUT_MS } from "@/lib/anthropic";
import {
  PROMPT_VERSION, SYSTEM_PROMPT, PROMPT,
  TOOL_NAME, TOOL_DESCRIPTION, TOOL_SCHEMA,
} from "./prompts/listingImages.v1.js";

// Maps AI amenity names to listing_amenities column names (same in this schema)
const AMENITY_COLS = new Set([
  "air_conditioning", "dishwasher", "gym", "laundry", "mailroom",
  "microwave", "oven", "parking", "pets_allowed", "pool",
  "refrigerator", "rooftop", "storage", "stove", "study_room",
]);

/**
 * Run a vision pass on listing images to suggest amenity/utility states.
 * Writes a lease_extraction_runs record and upserts listing_field_states.
 *
 * @param {string} listingId
 * @param {string[]} imageUrls - public image URLs
 * @param {string} landlordId
 */
export async function extractAmenitiesFromImages(listingId, imageUrls, landlordId) {
  const start = Date.now();

  // Build image content blocks (max 20 per Anthropic API)
  const imageBlocks = imageUrls.slice(0, 20).map((url) => ({
    type: "image",
    source: { type: "url", url },
  }));

  let run;
  try {
    const { toolInput, durationMs, modelUsed } = await runToolExtraction({
      toolName: TOOL_NAME,
      toolDescription: TOOL_DESCRIPTION,
      toolSchema: TOOL_SCHEMA,
      systemPrompt: SYSTEM_PROMPT,
      timeoutMs: IMAGE_TIMEOUT_MS,
      messages: [{
        role: "user",
        content: [...imageBlocks, { type: "text", text: PROMPT }],
      }],
    });

    const detected = toolInput.detected_amenities ?? [];
    const fieldsExtracted = detected.filter((a) => a.present).length;
    const avgConfidence = detected.length
      ? detected.reduce((s, a) => s + a.confidence, 0) / detected.length
      : 0;

    const { data: runRow } = await supabase
      .from("lease_extraction_runs")
      .insert({
        listing_id: listingId,
        run_type: "image_amenity_extraction",
        prompt_version: PROMPT_VERSION,
        model_used: modelUsed,
        duration_ms: durationMs,
        fields_extracted_count: fieldsExtracted,
        avg_confidence: avgConfidence,
        per_field_confidence: Object.fromEntries(detected.map((a) => [a.name, a.confidence])),
        status: "success",
      })
      .select("id")
      .single();
    run = runRow;

    // Upsert field states for detected amenities
    for (const amenity of detected) {
      if (!AMENITY_COLS.has(amenity.name)) continue;
      await supabase.rpc("upsert_field_state", {
        p_listing_id: listingId,
        p_table_name: "listing_amenities",
        p_record_id: listingId,
        p_field_name: amenity.name,
        p_state: "ai_suggested",
        p_source: "images",
        p_ai_confidence: amenity.confidence,
        p_suggested_value: String(amenity.present),
        p_evidence: amenity.evidence ?? null,
        p_changed_by: landlordId,
        p_extraction_run_id: run?.id,
      });
    }

    return { runId: run?.id, fieldsExtracted, avgConfidence };

  } catch (err) {
    await supabase.from("lease_extraction_runs").insert({
      listing_id: listingId,
      run_type: "image_amenity_extraction",
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
