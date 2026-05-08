import supabase from "@/lib/supabase";
import { runToolExtraction } from "@/lib/anthropic";
import {
  PROMPT_VERSION, SYSTEM_PROMPT, buildPrompt,
  TOOL_NAME, TOOL_DESCRIPTION, TOOL_SCHEMA,
} from "./prompts/scrapeListingUrl.v1.js";

/**
 * Fetch an external listing URL and use Anthropic to extract listing data.
 * Upserts listing_field_states with state='ai_suggested' for each found field.
 *
 * @param {string} listingId
 * @param {string} url
 * @param {string} landlordId
 * @returns {Promise<{ runId, fieldsExtracted, avgConfidence }>}
 */
export async function scrapeListingUrl(listingId, url, landlordId) {
  const start = Date.now();

  // Fetch the page HTML
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Proximity/1.0)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 403) {
    const err = new Error("This site is blocking us — please fill in fields manually.");
    err.code = "BLOCKED";
    throw err;
  }
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);
  const html = await res.text();

  try {
    const { toolInput, durationMs, modelUsed } = await runToolExtraction({
      toolName: TOOL_NAME,
      toolDescription: TOOL_DESCRIPTION,
      toolSchema: TOOL_SCHEMA,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(html, url) }],
    });

    const confidence = toolInput.per_field_confidence ?? {};
    const confidenceValues = Object.values(confidence).filter((v) => typeof v === "number");
    const avgConfidence = confidenceValues.length
      ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length
      : 0;
    const fieldsExtracted = Object.keys(confidence).length;

    const { data: run } = await supabase
      .from("lease_extraction_runs")
      .insert({
        listing_id: listingId,
        run_type: "private_listing_link_scrape",
        prompt_version: PROMPT_VERSION,
        model_used: modelUsed,
        duration_ms: durationMs,
        fields_extracted_count: fieldsExtracted,
        avg_confidence: avgConfidence,
        per_field_confidence: confidence,
        status: "success",
      })
      .select("id")
      .single();

    // Upsert field states for found fields
    const fieldMap = {
      description: "listings",
      bedrooms: "listing_leases",
      bathrooms: "listing_leases",
      area_sqft: "listing_leases",
      rent: "listing_leases",
      pets_allowed: "listing_amenities",
      furnished: "listings",
    };

    for (const [field, table] of Object.entries(fieldMap)) {
      if (toolInput[field] == null) continue;
      await supabase.rpc("upsert_field_state", {
        p_listing_id: listingId,
        p_table_name: table,
        p_record_id: listingId,
        p_field_name: field === "area_sqft" ? "area" : field,
        p_state: "ai_suggested",
        p_source: "website_scrape",
        p_ai_confidence: confidence[field] ?? null,
        p_suggested_value: String(toolInput[field]),
        p_changed_by: landlordId,
        p_extraction_run_id: run?.id,
      });
    }

    return { runId: run?.id, fieldsExtracted, avgConfidence, extracted: toolInput };

  } catch (err) {
    await supabase.from("lease_extraction_runs").insert({
      listing_id: listingId,
      run_type: "private_listing_link_scrape",
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
