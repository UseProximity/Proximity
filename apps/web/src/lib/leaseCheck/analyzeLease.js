/*
 * Claude analysis for Lease Check. Sends the uploaded lease (PDF and/or images, base64)
 * to claude-sonnet-5 with a structured-output schema and returns a severity-ranked flag
 * list plus the summary. The address/landlordName are returned for the in-request
 * property match only and are never stored (see route.js). Em dashes are stripped from
 * every string as a backstop before results reach the student.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { LEASE_SYSTEM, LEASE_USER_PROMPT } from "@/lib/leaseCheck/prompt";

export const LEASE_MODEL = "claude-sonnet-5";

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.LEASE_SCANNER_KEY });
  return _client;
}

const FlagSchema = z.object({
  severity: z.enum(["red", "yellow", "green"]),
  title: z.string(),
  explanation: z.string(),
  quote: z.string().nullable(),
  question: z.string(),
});

const LeaseAnalysisSchema = z.object({
  summary: z.string(),
  flags: z.array(FlagSchema),
  address: z.string().nullable(),
  landlordName: z.string().nullable(),
  unreadablePages: z.array(z.number()),
  overallConfidence: z.number(),
});

// Belt-and-suspenders (same rule as the matchmaking chat): the prompt forbids em
// dashes, but never let one reach a student. Collapse " — " to ", " and any stray
// em dash to a hyphen, recursively across every string in the analysis.
function stripEmDashes(value) {
  if (typeof value === "string") return value.replace(/\s*—\s*/g, ", ").replace(/—/g, "-");
  if (Array.isArray(value)) return value.map(stripEmDashes);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripEmDashes(v)]));
  }
  return value;
}

// claude-sonnet-5 pricing, USD per token (standard, non-intro rates).
const SONNET5_PRICE = {
  input: 3.0 / 1e6,
  output: 15.0 / 1e6,
  cacheRead: 0.3 / 1e6,
  cacheWrite: 3.75 / 1e6,
};

function logAnalysisCost(leaseCheckId, usage) {
  if (!usage) return;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cost =
    input * SONNET5_PRICE.input +
    output * SONNET5_PRICE.output +
    cacheRead * SONNET5_PRICE.cacheRead +
    cacheWrite * SONNET5_PRICE.cacheWrite;
  console.log(
    `[lease-check] analysis ${leaseCheckId} cost $${cost.toFixed(4)} ` +
      `(in:${input} out:${output} cacheRead:${cacheRead} cacheWrite:${cacheWrite})`
  );
}

/*
 * documents: [{ kind: "pdf" | "image", mediaType, data }] where data is base64 with no
 * newlines. Document blocks go before the text block. Returns the parsed analysis, or
 * null if the model's output failed to parse.
 *
 * Note for future edits: temperature/top_p/top_k and thinking:{type:"enabled"} are
 * rejected with a 400 on claude-sonnet-5 — do not add them. Adaptive thinking is on by
 * default and consumes max_tokens, hence the generous budget.
 */
export async function analyzeLease({ leaseCheckId, documents }) {
  const client = getClient();

  const contentBlocks = documents.map((doc) =>
    doc.kind === "pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: doc.data },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: doc.mediaType, data: doc.data },
        }
  );

  const response = await client.messages.parse({
    model: LEASE_MODEL,
    max_tokens: 16000,
    output_config: { format: zodOutputFormat(LeaseAnalysisSchema) },
    messages: [
      {
        role: "user",
        content: [...contentBlocks, { type: "text", text: LEASE_USER_PROMPT }],
      },
    ],
    system: [{ type: "text", text: LEASE_SYSTEM, cache_control: { type: "ephemeral" } }],
  });

  logAnalysisCost(leaseCheckId, response.usage);

  // parsed_output is null when the model's output failed schema parsing — callers must
  // treat that as "couldn't read it", never as an empty success.
  return response.parsed_output ? stripEmDashes(response.parsed_output) : null;
}

export { Anthropic };
