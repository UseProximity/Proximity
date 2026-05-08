export const PROMPT_VERSION = "leaseTemplate.v1";

export const SYSTEM_PROMPT = `You are a lease analysis expert. Extract structured lease terms from the provided PDF document with high accuracy. For each value:
- Only extract information that is explicitly stated in the document.
- Never invent or infer values that aren't present.
- Assign a confidence score (0.0–1.0) based on how clearly the value is stated.
- If a value is absent or ambiguous, omit it and set confidence to 0.
- Cite the page number or section heading where you found each key piece of information.`;

/** Build the user-facing prompt, injecting the fee_type names list. */
export function buildPrompt(feeTypeNames) {
  return `Extract all lease terms from this document.

Map any fees you find to one of these fee type names (use the closest match):
${feeTypeNames.join(", ")}

Return your extraction using the extract_lease_fields tool.`;
}

export const TOOL_NAME = "extract_lease_fields";
export const TOOL_DESCRIPTION = "Extract structured lease terms from a lease PDF document";

export const TOOL_SCHEMA = {
  type: "object",
  properties: {
    lease_term_months_options: {
      type: "array", items: { type: "number" },
      description: "Available lease durations in months (e.g. [10, 12])"
    },
    pricing_basis_default: {
      type: "string", enum: ["per_unit", "per_bed", "unknown"],
      description: "Whether rent is charged per-unit or per-bed"
    },
    bedrooms: { type: "number", description: "Number of bedrooms" },
    bathrooms: { type: "number", description: "Number of bathrooms" },
    area_sqft: { type: "number", description: "Unit area in square feet" },
    base_rent_options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          months: { type: "number" },
          rent: { type: "number" },
          basis: { type: "string" }
        },
        required: ["months", "rent", "basis"]
      }
    },
    pet_policy_text: { type: "string", description: "Full pet policy verbatim from the lease" },
    fees: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          basis: { type: "string" },
          conditions: { type: "string" },
          refundable: { type: "boolean" },
          matched_fee_type: { type: "string", description: "Closest fee_types.name match" }
        },
        required: ["name", "amount", "basis", "matched_fee_type"]
      }
    },
    concessions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          amount: { type: "number" },
          amount_type: { type: "string", enum: ["flat", "percentage", "months_free"] },
          conditions: { type: "string" }
        },
        required: ["description"]
      }
    },
    utilities_responsibility: {
      type: "object",
      properties: {
        tenant_pays: { type: "array", items: { type: "string" } },
        landlord_pays: { type: "array", items: { type: "string" } },
        admin_fee_per_bill: { type: "number" }
      }
    },
    amenities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          included: { type: "boolean" },
          notes: { type: "string" }
        },
        required: ["name", "included"]
      }
    },
    screening: {
      type: "object",
      properties: {
        income_multiplier: { type: "number" },
        credit_minimum: { type: "number" },
        cosigner_accepted: { type: "boolean" },
        international_friendly: { type: "boolean" }
      }
    },
    faqs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" }
        },
        required: ["question", "answer"]
      }
    },
    unusual_clauses: {
      type: "array", items: { type: "string" },
      description: "Any clauses that seem unusual or tenant-unfavorable"
    },
    per_field_confidence: {
      type: "object",
      description: "Confidence scores keyed by field name (0.0–1.0)",
      additionalProperties: { type: "number" }
    }
  },
  required: ["pricing_basis_default", "per_field_confidence"]
};
