export const PROMPT_VERSION = "listingImages.v1";

export const SYSTEM_PROMPT = `You are a property amenity analyst. Examine the provided listing photos and identify which amenities and utilities are visible. Only mark an amenity as present if you can clearly see evidence of it in the images. Set confidence based on how clearly visible the evidence is.`;

export const PROMPT = `Analyze these listing photos and identify which amenities are visible.

For each amenity, only mark it present if you can see clear evidence in the images.
Return your findings using the extract_amenities tool.`;

export const TOOL_NAME = "extract_amenities";
export const TOOL_DESCRIPTION = "Extract visible amenities from listing photos";

export const TOOL_SCHEMA = {
  type: "object",
  properties: {
    detected_amenities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: [
              "air_conditioning", "dishwasher", "gym", "laundry", "mailroom",
              "microwave", "oven", "parking", "pets_allowed", "pool",
              "refrigerator", "rooftop", "storage", "stove", "study_room"
            ]
          },
          present: { type: "boolean" },
          confidence: { type: "number", description: "0.0–1.0" },
          evidence: { type: "string", description: "Brief description of what was seen" }
        },
        required: ["name", "present", "confidence"]
      }
    },
    detected_utilities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: ["electric", "gas", "heat", "water", "internet", "trash", "cable", "sewer", "cooling"]
          },
          visible: { type: "boolean" },
          confidence: { type: "number" },
          evidence: { type: "string" }
        },
        required: ["name", "visible", "confidence"]
      }
    }
  },
  required: ["detected_amenities"]
};
