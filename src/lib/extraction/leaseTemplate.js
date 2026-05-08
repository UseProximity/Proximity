import supabase from "@/lib/supabase";
import { fetchPdfAsBase64, runToolExtraction } from "@/lib/anthropic";
import {
  PROMPT_VERSION, SYSTEM_PROMPT, buildPrompt,
  TOOL_NAME, TOOL_DESCRIPTION, TOOL_SCHEMA,
} from "./prompts/leaseTemplate.v1.js";

/**
 * Run the initial extraction pass on a lease template PDF.
 * Writes a lease_extraction_runs record and upserts listing_field_states.
 * Pre-populates listing_pet_policies, listing_fees, listing_concessions, listing_faqs.
 *
 * @param {Object} params
 * @param {string} params.templateId  - lease_templates.id
 * @param {string} params.listingId   - listings.id (may be null for template-only upload)
 * @param {string} params.pdfUrl      - URL to fetch the PDF from
 * @param {string} params.landlordId  - users.id for field state attribution
 * @returns {Promise<{ runId: string, fieldsExtracted: number, avgConfidence: number }>}
 */
export async function extractLeaseTemplate({ templateId, listingId, pdfUrl, landlordId }) {
  // Fetch fee type names to inject into the prompt
  const { data: feeTypes } = await supabase.from("fee_types").select("name").order("sort_order");
  const feeTypeNames = (feeTypes ?? []).map((f) => f.name);

  let runId = null;
  const startedAt = Date.now();

  try {
    // Fetch PDF as base64
    const pdfBase64 = await fetchPdfAsBase64(pdfUrl);

    const { toolInput, durationMs, modelUsed } = await runToolExtraction({
      toolName: TOOL_NAME,
      toolDescription: TOOL_DESCRIPTION,
      toolSchema: TOOL_SCHEMA,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
          },
          { type: "text", text: buildPrompt(feeTypeNames) },
        ],
      }],
    });

    const confidence = toolInput.per_field_confidence ?? {};
    const confidenceValues = Object.values(confidence).filter((v) => typeof v === "number");
    const avgConfidence = confidenceValues.length
      ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length
      : 0;
    const fieldsExtracted = Object.keys(confidence).length;

    // Write extraction run record
    const { data: run } = await supabase
      .from("lease_extraction_runs")
      .insert({
        template_id: templateId,
        listing_id: listingId ?? null,
        run_type: "template_initial_extraction",
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
    runId = run?.id;

    // Store extracted_fields on the template itself
    await supabase
      .from("lease_templates")
      .update({ extracted_fields: toolInput })
      .eq("id", templateId);

    // Only upsert listing-level data if a listing is linked
    if (listingId) {
      await Promise.all([
        upsertPetPolicy(listingId, toolInput, runId),
        upsertFees(listingId, toolInput, feeTypes, runId),
        upsertConcessions(listingId, toolInput, runId),
        upsertFaqs(listingId, toolInput, runId),
        upsertFieldStates(listingId, toolInput, confidence, runId, landlordId),
      ]);
    }

    return { runId, fieldsExtracted, avgConfidence };

  } catch (err) {
    // Write failed run record
    const { data: run } = await supabase
      .from("lease_extraction_runs")
      .insert({
        template_id: templateId,
        listing_id: listingId ?? null,
        run_type: "template_initial_extraction",
        prompt_version: PROMPT_VERSION,
        model_used: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
        duration_ms: Date.now() - startedAt,
        fields_extracted_count: 0,
        avg_confidence: 0,
        per_field_confidence: {},
        status: "failed",
        error_message: err.message,
      })
      .select("id")
      .single();
    throw Object.assign(err, { runId: run?.id });
  }
}

async function upsertPetPolicy(listingId, extracted, runId) {
  if (!extracted.pet_policy_text) return;
  await supabase
    .from("listing_pet_policies")
    .upsert(
      { listing_id: listingId, policy_text: extracted.pet_policy_text, last_verified_source: "lease_pdf" },
      { onConflict: "listing_id" }
    );
}

async function upsertFees(listingId, extracted, feeTypes, runId) {
  if (!Array.isArray(extracted.fees) || extracted.fees.length === 0) return;
  const feeTypeMap = Object.fromEntries((feeTypes ?? []).map((f) => [f.name, f.id]));
  const rows = extracted.fees
    .filter((f) => feeTypeMap[f.matched_fee_type])
    .map((f) => ({
      listing_id: listingId,
      fee_type_id: feeTypeMap[f.matched_fee_type],
      amount: f.amount,
      basis: f.basis ?? "flat",
      conditions: f.conditions ?? null,
      refundable: f.refundable ?? null,
      notes: `AI extracted (${PROMPT_VERSION}). Run: ${runId}`,
    }));
  if (rows.length) await supabase.from("listing_fees").insert(rows);
}

async function upsertConcessions(listingId, extracted, runId) {
  if (!Array.isArray(extracted.concessions) || extracted.concessions.length === 0) return;
  const rows = extracted.concessions.map((c) => ({
    listing_id: listingId,
    description: c.description,
    amount: c.amount ?? null,
    amount_type: c.amount_type ?? null,
    conditions: c.conditions ?? null,
    active: true,
    last_verified_source: "lease_pdf",
  }));
  await supabase.from("listing_concessions").insert(rows);
}

async function upsertFaqs(listingId, extracted, runId) {
  if (!Array.isArray(extracted.faqs) || extracted.faqs.length === 0) return;
  const rows = extracted.faqs.map((f, i) => ({
    listing_id: listingId,
    question: f.question,
    answer: f.answer,
    source: "ai_from_lease",
    is_public: false,
    sort_order: i,
  }));
  await supabase.from("listing_faqs").insert(rows);
}

async function upsertFieldStates(listingId, extracted, confidence, runId, landlordId) {
  const fields = [
    ["listings", listingId, "description", extracted.bedrooms != null],
    ["listing_leases", listingId, "bedrooms", extracted.bedrooms != null],
    ["listing_leases", listingId, "bathrooms", extracted.bathrooms != null],
    ["listing_leases", listingId, "area", extracted.area_sqft != null],
    ["listing_leases", listingId, "pricing_basis", extracted.pricing_basis_default !== "unknown"],
    ["listing_leases", listingId, "rent", Array.isArray(extracted.base_rent_options) && extracted.base_rent_options.length > 0],
    ["listing_pet_policies", listingId, "policy_text", !!extracted.pet_policy_text],
  ];

  for (const [tableName, recordId, fieldName, hasValue] of fields) {
    if (!hasValue) continue;
    await supabase.rpc("upsert_field_state", {
      p_listing_id: listingId,
      p_table_name: tableName,
      p_record_id: recordId,
      p_field_name: fieldName,
      p_state: "ai_suggested",
      p_source: "lease_pdf",
      p_ai_confidence: confidence[fieldName] ?? null,
      p_suggested_value: fieldName === "policy_text" ? extracted.pet_policy_text : null,
      p_changed_by: landlordId,
      p_extraction_run_id: runId,
    });
  }
}
