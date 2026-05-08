export const PROMPT_VERSION = "scrapeListingUrl.v1";

export const SYSTEM_PROMPT = `You are a real estate data extraction specialist. Extract structured listing information from the provided webpage HTML. Only extract information that is explicitly present on the page. Do not infer or estimate values.`;

export function buildPrompt(html, url) {
  return `Extract listing data from this webpage (${url}):\n\n${html.slice(0, 50000)}\n\nUse the extract_listing_data tool to return what you find.`;
}

export const TOOL_NAME = "extract_listing_data";
export const TOOL_DESCRIPTION = "Extract rental listing data from a webpage";

export const TOOL_SCHEMA = {
  type: "object",
  properties: {
    address: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    bedrooms: { type: "number" },
    bathrooms: { type: "number" },
    area_sqft: { type: "number" },
    rent: { type: "number" },
    pricing_basis: { type: "string", enum: ["per_unit", "per_bed", "unknown"] },
    available_from: { type: "string", description: "ISO date string if found" },
    pets_allowed: { type: "boolean" },
    furnished: { type: "boolean" },
    amenities: { type: "array", items: { type: "string" } },
    utilities_included: { type: "array", items: { type: "string" } },
    pet_policy_text: { type: "string" },
    per_field_confidence: {
      type: "object",
      additionalProperties: { type: "number" },
      description: "Confidence scores (0.0–1.0) for each extracted field"
    }
  },
  required: ["per_field_confidence"]
};
