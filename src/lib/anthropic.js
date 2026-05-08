import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";
const PDF_TIMEOUT_MS = 180_000;
const IMAGE_TIMEOUT_MS = 60_000;

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

/**
 * Fetch a PDF from a URL and return its base64-encoded content.
 * Works with R2 presigned URLs or any public HTTPS URL.
 */
export async function fetchPdfAsBase64(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status} ${res.statusText}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

/**
 * Run a tool-use extraction against Anthropic.
 * Returns { toolInput, durationMs, modelUsed }.
 * Throws on API error or if the model doesn't call the expected tool.
 */
export async function runToolExtraction({
  toolName,
  toolDescription,
  toolSchema,
  messages,
  systemPrompt = null,
  timeoutMs = PDF_TIMEOUT_MS,
}) {
  const client = getClient();
  const start = Date.now();

  const params = {
    model: MODEL,
    max_tokens: 8000,
    tools: [{
      name: toolName,
      description: toolDescription,
      input_schema: toolSchema,
    }],
    tool_choice: { type: "tool", name: toolName },
    messages,
  };

  // Add system prompt with prompt caching if provided (large reusable system prompts
  // benefit from caching — ~80% cost reduction on cache hits).
  if (systemPrompt) {
    params.system = [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  const response = await client.messages.create(params, {
    timeout: timeoutMs,
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use" && b.name === toolName);
  if (!toolBlock) throw new Error("Model did not call the expected tool");

  return {
    toolInput: toolBlock.input,
    durationMs: Date.now() - start,
    modelUsed: MODEL,
  };
}

export { MODEL as ANTHROPIC_MODEL };
export { PDF_TIMEOUT_MS, IMAGE_TIMEOUT_MS };
