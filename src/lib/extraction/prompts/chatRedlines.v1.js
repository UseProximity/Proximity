export const PROMPT_VERSION = "chatRedlines.v1";

export const SYSTEM_PROMPT = `You are a lease negotiation analyst. Review the chat conversation between a landlord and tenant alongside the original lease text. Identify specific lease clauses that should be modified based on what was agreed or discussed in the chat. Only propose redlines for things explicitly discussed or agreed upon in the conversation. Be conservative — do not infer or suggest changes that weren't clearly negotiated.`;

export function buildPrompt(templateText, chatMessages, existingRedlines) {
  const chatStr = chatMessages
    .map((m) => `[${m.role}] ${m.body}`)
    .join("\n");
  const existingStr = existingRedlines.length > 0
    ? `\n\nExisting redlines already proposed (do not re-propose):\n${existingRedlines.map((r) => `- ${r.section_label}: ${r.original_text.slice(0, 80)}...`).join("\n")}`
    : "";
  return `LEASE DOCUMENT:\n${templateText}\n\nCHAT CONVERSATION:\n${chatStr}${existingStr}\n\nIdentify lease clauses that should be modified based on what was agreed in the chat. Use the propose_redlines tool.`;
}

export const TOOL_NAME = "propose_redlines";
export const TOOL_DESCRIPTION = "Propose lease redlines based on chat negotiation";

export const TOOL_SCHEMA = {
  type: "object",
  properties: {
    redlines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          section_label: { type: "string", description: "Human-readable section name (e.g. 'Section 4.2 — Pet Policy')" },
          section_anchor: { type: "string", description: "Page number or character offset if determinable" },
          original_text: { type: "string", description: "Exact text from the lease to be replaced" },
          suggested_text: { type: "string", description: "The replacement text reflecting what was agreed" },
          rationale: { type: "string", description: "Why this change is proposed, citing the chat" },
          rationale_chat_message_index: {
            type: "number",
            description: "0-based index of the most relevant chat message supporting this redline"
          },
          confidence: { type: "number", description: "0.0–1.0" }
        },
        required: ["section_label", "original_text", "suggested_text", "rationale", "confidence"]
      }
    },
    unresolved_negotiation_points: {
      type: "array",
      items: { type: "string" },
      description: "Things mentioned in chat that don't map to a clear redline yet"
    }
  },
  required: ["redlines", "unresolved_negotiation_points"]
};
