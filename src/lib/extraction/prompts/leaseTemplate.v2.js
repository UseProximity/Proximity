export const PROMPT_VERSION = "leaseTemplate.v2";

export const SYSTEM_PROMPT = `You are a real estate lease analyst. Extract structured data from lease agreements with high precision.

CRITICAL RULES:
1. Never invent values. If a value is not clearly stated, omit it and set confidence to 0.
2. Distinguish carefully between TOTAL rent (for all months combined) vs. MONTHLY rent (per month) vs. PER-TENANT rent (per person per month).
3. Count tenants by looking at: the signature block (how many tenant signature lines), lines labelled "Tenant 1:", "Tenant 2:", explicit phrases like "three (3) tenants", "joint tenancy of 4", "2 occupants", or numbered co-tenant addenda.
4. If a lease covers multiple unit types or configurations (e.g. "Option A / Option B", "Unit 1 / Unit 2", "Plan A / Plan B", multiple rent schedules), return EACH as a separate entry in the lease_offers array.
5. Cite the page number or clause for every dollar amount you extract.`;

export function buildPrompt(feeTypeNames) {
  return `Extract all lease details from this document.

When you find a rent amount, determine:
- rent_type: "total" (the entire lease cost for all months combined), "per_month_all_tenants" (monthly charge shared by all tenants), or "per_month_per_tenant" (monthly charge per individual tenant)
- Count tenants from: signature block tenant lines, "Tenant 1/2/3" labels, occupancy clauses, or co-tenant names listed. Default to 1 if truly unknown.

For fees, map to one of these names: ${feeTypeNames.join(", ")}

Return using the extract_lease_fields tool.`;
}

export const TOOL_NAME = "extract_lease_fields";
export const TOOL_DESCRIPTION = "Extract structured lease data including per-tenant rent calculation inputs";

export const TOOL_SCHEMA = {
  type: "object",
  properties: {
    lease_offers: {
      type: "array",
      description: "One entry per distinct lease configuration found in the document (most leases have exactly one).",
      items: {
        type: "object",
        properties: {
          unit_label: { type: "string", description: "Label if multiple options exist (e.g. 'Option A', 'Unit 2B'). Null for single-offer leases." },
          bedrooms: { type: "number" },
          bathrooms: { type: "number" },
          area_sqft: { type: "number" },
          num_tenants: {
            type: "number",
            description: "Number of tenants sharing this lease. Count from signature block, occupancy clause, or co-tenant names."
          },
          rent_as_stated: {
            type: "number",
            description: "The exact rent dollar amount as written in the lease. Do not do any math here — return the raw number."
          },
          rent_type: {
            type: "string",
            enum: ["total", "per_month_all_tenants", "per_month_per_tenant"],
            description: "total = one-time payment for the entire lease term. per_month_all_tenants = monthly amount split among all tenants. per_month_per_tenant = monthly amount each tenant pays individually."
          },
          lease_term_months: {
            type: "number",
            description: "Length of lease in months. Derive from start/end dates if not explicit."
          },
          available_from: { type: "string", description: "Lease start date in YYYY-MM-DD format." },
          sublease_allowed: { type: "boolean" },
          rent_evidence: { type: "string", description: "Page number and clause where you found the rent amount." },
          confidence: { type: "number", description: "0.0–1.0 confidence this extraction is accurate." }
        },
        required: ["num_tenants", "rent_as_stated", "rent_type", "lease_term_months", "confidence"]
      }
    },
    pet_policy_text: {
      type: "string",
      description: "Full pet policy verbatim from the lease."
    },
    fees: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          basis: { type: "string", description: "flat | per_person | per_bed | per_unit | per_day | per_bedroom_per_month | percentage" },
          conditions: { type: "string" },
          refundable: { type: "boolean" },
          matched_fee_type: { type: "string", description: "Closest match from the provided fee type names list." }
        },
        required: ["name", "amount", "basis", "matched_fee_type"]
      }
    },
    utilities_responsibility: {
      type: "object",
      properties: {
        tenant_pays: { type: "array", items: { type: "string" } },
        landlord_pays: { type: "array", items: { type: "string" } }
      }
    },
    amenities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          included: { type: "boolean" }
        },
        required: ["name", "included"]
      }
    },
    unusual_clauses: {
      type: "array",
      items: { type: "string" },
      description: "Any clauses that are tenant-unfavorable or non-standard."
    },
    overall_confidence: {
      type: "number",
      description: "0.0–1.0 overall confidence in the extraction."
    }
  },
  required: ["lease_offers", "overall_confidence"]
};
