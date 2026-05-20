export const PROMPT_VERSION = "leaseTemplate.v4";

export const SYSTEM_PROMPT = `You are a real estate lease analyst. Extract structured data from lease agreements with high precision.

CRITICAL RULES:
1. Never invent values. If a value is not clearly stated, omit it and set confidence to 0.
2. Distinguish carefully between TOTAL rent (for all months combined) vs. MONTHLY rent (per month) vs. PER-TENANT rent (per person per month).
3. Count tenants by looking at: the signature block (how many tenant signature lines), lines labelled "Tenant 1:", "Tenant 2:", explicit phrases like "three (3) tenants", "joint tenancy of 4", "2 occupants", or numbered co-tenant addenda.
4. If a lease covers multiple unit types or configurations (e.g. "Option A / Option B", "Unit 1 / Unit 2", "Plan A / Plan B", multiple rent schedules), return EACH as a separate entry in the lease_offers array.
5. Cite the page number or clause for every dollar amount you extract.
6. For lease_structure: "by_bed" means each tenant pays individually for their bed; "entire_unit" means the unit is rented as a whole.
7. For home_type: infer from the lease description, property address, or unit designations.`;

export function buildPrompt(feeTypeNames) {
  return `Extract all lease details from this document.

When you find a rent amount, determine:
- rent_type: "total" (the entire lease cost for all months combined), "per_month_all_tenants" (monthly charge shared by all tenants), or "per_month_per_tenant" (monthly charge each individual tenant pays)
- Count tenants from: signature block tenant lines, "Tenant 1/2/3" labels, occupancy clauses, or co-tenant names listed. Default to 1 if truly unknown.

For fees, map to one of these names: ${feeTypeNames.join(", ")}

Return using the extract_lease_fields tool.`;
}

export const TOOL_NAME = "extract_lease_fields";
export const TOOL_DESCRIPTION = "Extract structured lease data covering all listing and lease offer fields";

export const TOOL_SCHEMA = {
  type: "object",
  properties: {

    // ── Listing-level fields (→ listings table) ───────────────────────────
    listing_details: {
      type: "object",
      description: "Property-level details that apply to the listing as a whole.",
      properties: {
        title: {
          type: "string",
          description: "Property name or identifier as referenced in the lease (e.g. 'The Delmar Building', 'Unit 4B at 123 Main')."
        },
        description: {
          type: "string",
          description: "Any property description found in the lease preamble, recitals, or exhibit pages."
        },
        lease_type: {
          type: "string",
          enum: ["fixed", "month_to_month"],
          description: "fixed = has a defined end date. month_to_month = rolls over monthly."
        },
        lease_structure: {
          type: "string",
          enum: ["entire_unit", "by_bed"],
          description: "entire_unit = tenants jointly rent the full unit. by_bed = each tenant rents their individual bed/room."
        },
        home_type: {
          type: "string",
          enum: ["apartment", "house", "condo", "townhouse", "studio", "duplex", "other"],
          description: "Type of dwelling as described or implied by the lease."
        },
        furnished: {
          type: "boolean",
          description: "True if the lease explicitly states the unit is furnished."
        },
        sublease_friendly: {
          type: "boolean",
          description: "True if subleasing is permitted anywhere in the lease."
        },
        twenty_one_plus: {
          type: "boolean",
          description: "True if the lease or community rules contain an age restriction of 21+."
        },
        move_in_date: {
          type: "string",
          description: "Lease start / move-in date in YYYY-MM-DD format."
        },
        contact_name: {
          type: "string",
          description: "Landlord or property manager name as written in the lease."
        },
        contact_email: {
          type: "string",
          description: "Landlord or property manager email address if present."
        },
        contact_phone: {
          type: "string",
          description: "Landlord or property manager phone number if present."
        }
      }
    },

    // ── Per-unit lease offers (→ listing_leases table) ────────────────────
    lease_offers: {
      type: "array",
      description: "One entry per distinct lease configuration found in the document (most leases have exactly one).",
      items: {
        type: "object",
        properties: {
          unit_group_label: {
            type: "string",
            description: "Label if multiple options exist (e.g. 'Option A', 'Unit 2B', 'Plan B'). Null for single-offer leases."
          },
          bedrooms: {
            type: "number",
            description: "Number of bedrooms being leased under this offer."
          },
          bathrooms: {
            type: "number",
            description: "Number of bathrooms in the unit."
          },
          total_bedrooms: {
            type: "number",
            description: "Total bedrooms in the physical unit (may differ from bedrooms if only some beds are leased)."
          },
          total_bathrooms: {
            type: "number",
            description: "Total bathrooms in the physical unit."
          },
          area_sqft: {
            type: "number",
            description: "Unit area in square feet."
          },
          beds_in_lease: {
            type: "number",
            description: "Number of individual beds covered by this lease (relevant for by_bed / per_bed pricing)."
          },
          num_tenants: {
            type: "number",
            description: "Number of tenants sharing this lease. Count from signature block, occupancy clause, or co-tenant names."
          },
          rent_as_stated: {
            type: "number",
            description: "The exact rent dollar amount as written in the lease. Do not do any math — return the raw number."
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
          available_from: {
            type: "string",
            description: "Lease start date in YYYY-MM-DD format."
          },
          summer_only: {
            type: "boolean",
            description: "True if this lease is explicitly for summer term only (e.g. May–August)."
          },
          semester_only: {
            type: "boolean",
            description: "True if this lease is explicitly for a single academic semester only."
          },
          sublease_allowed: {
            type: "boolean",
            description: "True if subleasing is permitted for this offer."
          },
          rent_evidence: {
            type: "string",
            description: "Page number and clause where the rent amount was found."
          },
          confidence: {
            type: "number",
            description: "0.0–1.0 confidence this extraction is accurate."
          }
        },
        required: ["num_tenants", "rent_as_stated", "rent_type", "lease_term_months", "confidence"]
      }
    },

    // ── Supporting fields ─────────────────────────────────────────────────
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
          basis: {
            type: "string",
            description: "flat | per_person | per_bed | per_unit | per_day | per_bedroom_per_month | percentage"
          },
          conditions: { type: "string" },
          refundable: { type: "boolean" },
          matched_fee_type: {
            type: "string",
            description: "Closest match from the provided fee type names list."
          }
        },
        required: ["name", "amount", "basis", "matched_fee_type"]
      }
    },
    utilities_included: {
      type: "object",
      description: "Set to true if this utility is present/in use at the property — regardless of whether the landlord or tenant pays for it. A 'Tenant Direct Sign-Up' clause still means the utility is present, so set true. Omit only if the utility is not mentioned at all. Note: if the lease mentions a central heating and cooling system or HVAC, set both heat and cooling to true.",
      properties: {
        electric: { type: "boolean" },
        gas:      { type: "boolean" },
        heat:     { type: "boolean" },
        water:    { type: "boolean" },
        internet: { type: "boolean" },
        trash:    { type: "boolean" },
        cable:    { type: "boolean" },
        sewer:    { type: "boolean" },
        cooling:  { type: "boolean" },
      }
    },
    amenities: {
      type: "object",
      description: "Set to true if the lease confirms this amenity is provided/included. Set to false if the lease explicitly states it is NOT available or not allowed (e.g. 'no pets', 'no reserved parking'). Omit only if the lease makes no mention of it at all.",
      properties: {
        air_conditioning: { type: "boolean" },
        dishwasher:       { type: "boolean" },
        gym:              { type: "boolean" },
        laundry:          { type: "boolean" },
        mailroom:         { type: "boolean" },
        microwave:        { type: "boolean" },
        oven:             { type: "boolean" },
        parking:          { type: "boolean" },
        pets_allowed:     { type: "boolean" },
        pool:             { type: "boolean" },
        refrigerator:     { type: "boolean" },
        rooftop:          { type: "boolean" },
        storage:          { type: "boolean" },
        stove:            { type: "boolean" },
        study_room:       { type: "boolean" },
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
