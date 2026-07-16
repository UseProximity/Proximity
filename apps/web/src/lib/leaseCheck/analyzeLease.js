/*
 * Claude analysis for Lease Check. Sends the uploaded lease (PDF and/or images, base64)
 * to claude-sonnet-5 with a structured-output schema, and normalizes the extracted rent.
 *
 * Rent normalization is deliberately split from extraction: the model returns the raw
 * number as written plus its type (total / per-month-all-tenants / per-month-per-tenant)
 * and the tenant count, and perPersonPerMonth() does the arithmetic here. Comparing a
 * raw lease number against listings.min_rent is the trust-destroying bug this prevents.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { LEASE_SYSTEM, LEASE_USER_PROMPT } from "@/lib/leaseCheck/prompt";

export const LEASE_MODEL = "claude-sonnet-5";

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.PROXY_CHAT_KEY });
  return _client;
}

const FlagSchema = z.object({
  severity: z.enum(["red", "yellow", "green"]),
  title: z.string(),
  explanation: z.string(),
  quote: z.string().nullable(),
  question: z.string(),
});

const RentSchema = z.object({
  rentAsStated: z.number(),
  rentType: z.enum(["total", "per_month_all_tenants", "per_month_per_tenant"]),
  numTenants: z.number(),
  leaseTermMonths: z.number(),
  evidence: z.string(),
  confidence: z.number(),
});

const LeaseAnalysisSchema = z.object({
  summary: z.string(),
  flags: z.array(FlagSchema),
  address: z.string().nullable(),
  landlordName: z.string().nullable(),
  rent: RentSchema.nullable(),
  bedrooms: z.number().nullable(),
  unreadablePages: z.array(z.number()),
  overallConfidence: z.number(),
});

// Normalize whatever the lease states to per-person-per-month — the unit the rest of
// the app (listings.min_rent, comps) speaks. Never compare rentAsStated to anything.
export function perPersonPerMonth({ rentAsStated, rentType, numTenants, leaseTermMonths }) {
  const n = Math.max(1, numTenants);
  switch (rentType) {
    case "per_month_per_tenant":
      return rentAsStated;
    case "per_month_all_tenants":
      return rentAsStated / n;
    case "total":
      return rentAsStated / Math.max(1, leaseTermMonths) / n;
    default:
      return null;
  }
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
  return response.parsed_output ?? null;
}

export { Anthropic };
