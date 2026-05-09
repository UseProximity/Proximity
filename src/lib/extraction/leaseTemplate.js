import supabase from "@/lib/supabase";
import { fetchPdfAsBase64, runToolExtraction } from "@/lib/anthropic";
import {
  PROMPT_VERSION, SYSTEM_PROMPT, buildPrompt,
  TOOL_NAME, TOOL_DESCRIPTION, TOOL_SCHEMA,
} from "./prompts/leaseTemplate.v2.js";

/**
 * Compute per-tenant monthly rent from raw lease values.
 *
 * rent_type breakdown:
 *   "total"               → covers all months for all tenants combined
 *   "per_month_all_tenants" → monthly charge split among tenants
 *   "per_month_per_tenant"  → already per-tenant per-month (no division needed)
 */
function computeMonthlyPerTenant(rentAsStated, rentType, numTenants, termMonths) {
  const tenants = Math.max(numTenants || 1, 1);
  const months  = Math.max(termMonths  || 1, 1);
  if (rentType === "total")                return rentAsStated / months / tenants;
  if (rentType === "per_month_all_tenants") return rentAsStated / tenants;
  return rentAsStated; // per_month_per_tenant — already correct
}

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

    // v2 schema: confidence lives per lease_offer, plus overall_confidence
    const offers = toolInput.lease_offers ?? [];
    const avgConfidence = toolInput.overall_confidence
      ?? (offers.length ? offers.reduce((s, o) => s + (o.confidence ?? 0), 0) / offers.length : 0);
    const fieldsExtracted = offers.length;

    // Number of tenants = number of bedrooms (always).
    // Use bedrooms as the divisor for per-tenant math.
    const computedOffers = offers.map((offer) => {
      const tenants = Math.max(offer.bedrooms ?? 1, 1);
      return {
        ...offer,
        num_tenants: tenants,
        monthly_per_tenant: computeMonthlyPerTenant(
          offer.rent_as_stated,
          offer.rent_type,
          tenants,
          offer.lease_term_months,
        ),
      };
    });

    // Store on template for the wizard to use
    await supabase
      .from("lease_templates")
      .update({ extracted_fields: { ...toolInput, computed_offers: computedOffers } })
      .eq("id", templateId);

    // Write extraction run
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
        per_field_confidence: Object.fromEntries(
          computedOffers.map((o, i) => [`offer_${i}_${o.unit_label || "main"}`, o.confidence ?? 0])
        ),
        status: "success",
      })
      .select("id")
      .single();
    runId = run?.id;

    if (listingId) {
      await Promise.all([
        upsertLeaseOffers(listingId, computedOffers, runId),
        upsertPetPolicy(listingId, toolInput, runId),
        upsertFees(listingId, toolInput, feeTypes, runId),
        upsertConcessions(listingId, toolInput, runId),
        upsertFaqs(listingId, toolInput, runId),
        upsertAmenityFieldStates(listingId, toolInput, runId, landlordId),
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

/**
 * Insert listing_leases rows from computed offers.
 * Each offer becomes one row with pricing_basis=per_bed and rent=monthly_per_tenant.
 */
async function upsertLeaseOffers(listingId, computedOffers, runId) {
  if (!computedOffers.length) return;

  // Clear any previously extracted (non-manual) leases so we don't duplicate
  await supabase
    .from("listing_leases")
    .delete()
    .eq("listing_id", listingId)
    .eq("last_verified_source", "lease_pdf");

  const rows = computedOffers
    .filter((o) => o.monthly_per_tenant && o.lease_term_months)
    .map((o) => ({
      listing_id: listingId,
      bedrooms: o.bedrooms ?? 1,
      bathrooms: o.bathrooms ?? 1,
      area: o.area_sqft ?? null,
      pricing_basis: "per_bed",            // always per-tenant
      rent: Math.round(o.monthly_per_tenant * 100) / 100,
      beds_in_lease: o.bedrooms ?? null, // tenants = bedrooms
      lease_term_months: o.lease_term_months,
      available_from: o.available_from ?? null,
      sublease: o.sublease_allowed ?? false,
      unit_group_label: o.unit_label ?? null,
      is_active: true,
      last_verified_source: "lease_pdf",
    }));

  if (rows.length) await supabase.from("listing_leases").insert(rows);
}

/**
 * Upsert field states for amenities detected in the lease PDF.
 */
async function upsertAmenityFieldStates(listingId, extracted, runId, landlordId) {
  const amenityMap = {
    parking: "parking", pool: "pool", gym: "gym", laundry: "laundry",
    dishwasher: "dishwasher", air_conditioning: "air_conditioning",
  };

  if (extracted.pet_policy_text) {
    await supabase.rpc("upsert_field_state", {
      p_listing_id: listingId,
      p_table_name: "listing_pet_policies",
      p_record_id: listingId,
      p_field_name: "policy_text",
      p_state: "ai_suggested",
      p_source: "lease_pdf",
      p_ai_confidence: 0.9,
      p_suggested_value: extracted.pet_policy_text,
      p_changed_by: landlordId,
      p_extraction_run_id: runId,
    });
  }

  for (const amenity of (extracted.amenities ?? [])) {
    const col = amenityMap[amenity.name?.toLowerCase()];
    if (!col) continue;
    await supabase.rpc("upsert_field_state", {
      p_listing_id: listingId,
      p_table_name: "listing_amenities",
      p_record_id: listingId,
      p_field_name: col,
      p_state: "ai_suggested",
      p_source: "lease_pdf",
      p_ai_confidence: 0.8,
      p_suggested_value: String(amenity.included),
      p_changed_by: landlordId,
      p_extraction_run_id: runId,
    });
  }
}
