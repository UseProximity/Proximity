/*
 * The model calls behind the per-listing agents.
 *
 * Sonnet writes answers and synthesizes knowledge; Haiku does the cheap
 * judgement calls (is this the same question as that one). Every call logs
 * its cost against the listing's agent (listing_agent_usage), which the caps
 * read.
 *
 * Two shapes of call:
 *   parseStructured   one request, a schema-shaped answer (messages.parse)
 *   runTools          a tool loop: the model pulls what it needs, and ends by
 *                     calling the tool named `final`, whose input is the
 *                     result. This is how Proxy answers: it decides what to
 *                     read rather than being handed everything.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { recordUsage } from "./store";

export const HAIKU = "claude-haiku-5-5";
export const SONNET = "claude-sonnet-5-5";

let _client = null;
export function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.PROXY_CHAT_KEY || process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// USD per token.
const PRICES = {
  [HAIKU]: { input: 1.0 / 1e6, output: 5.0 / 1e6, cacheRead: 0.1 / 1e6, cacheWrite: 1.25 / 1e6 },
  [SONNET]: { input: 3.0 / 1e6, output: 15.0 / 1e6, cacheRead: 0.3 / 1e6, cacheWrite: 3.75 / 1e6 },
};

export function costOf(model, usage) {
  if (!usage) return 0;
  const p = PRICES[model] ?? PRICES[SONNET];
  return (usage.input_tokens ?? 0) * p.input + (usage.output_tokens ?? 0) * p.output
    + (usage.cache_read_input_tokens ?? 0) * p.cacheRead + (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite;
}

function addUsage(total, usage) {
  if (!usage) return total;
  for (const k of ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]) {
    total[k] = (total[k] ?? 0) + (usage[k] ?? 0);
  }
  return total;
}

async function log({ listingId, kind, model, usage, tag }) {
  const cost = costOf(model, usage);
  console.log(`[agents] ${tag ?? kind} on ${model} cost $${cost.toFixed(4)} (in:${usage?.input_tokens ?? 0} out:${usage?.output_tokens ?? 0} cacheRead:${usage?.cache_read_input_tokens ?? 0})`);
  await recordUsage({ listingId, kind, model, usage, costCents: cost * 100 });
  return cost;
}

/* No em dash ever reaches a student or the store (repo rule). */
export function stripEmDashes(value) {
  if (typeof value === "string") return value.replace(/—/g, ", ").replace(/\s+,/g, ",");
  if (Array.isArray(value)) return value.map(stripEmDashes);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripEmDashes(v)]));
  }
  return value;
}

export async function parseStructured({ model = SONNET, system, messages, schema, maxTokens = 2000, tag, listingId = null, kind = "parse" }) {
  const response = await getClient().messages.parse({
    model,
    max_tokens: maxTokens,
    output_config: { format: zodOutputFormat(schema) },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
  });
  await log({ listingId, kind, model, usage: response.usage, tag });
  return { parsed: response.parsed_output ? stripEmDashes(response.parsed_output) : null, usage: response.usage };
}

/*
 * Tool loop. `tools` are Anthropic tool definitions; `handlers[name](input)`
 * runs one and returns something JSON-serialisable. The tool named `final`
 * has no handler: calling it ends the loop and its input is returned. If the
 * model stops without calling it, its last text is returned as `text`.
 */
export async function runTools({
  model = SONNET, system, messages, tools, handlers, maxRounds = 5, maxTokens = 1200,
  tag, listingId = null, kind = "tools", finalTool = "final",
}) {
  const client = getClient();
  const convo = [...messages];
  const usage = {};
  const calls = [];
  let text = "";
  for (let round = 0; round < maxRounds; round++) {
    const last = round === maxRounds - 1;
    const resp = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      // On the last round the model must answer, so it is told to call the final tool.
      tool_choice: last ? { type: "tool", name: finalTool } : { type: "auto" },
      messages: convo,
    });
    addUsage(usage, resp.usage);
    const finalBlock = resp.content.find((b) => b.type === "tool_use" && b.name === finalTool);
    text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() || text;
    if (finalBlock) {
      await log({ listingId, kind, model, usage, tag });
      return { final: stripEmDashes(finalBlock.input), text, usage, calls };
    }
    if (resp.stop_reason !== "tool_use") break;
    convo.push({ role: "assistant", content: resp.content });
    const results = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      let out;
      try {
        out = handlers[block.name] ? await handlers[block.name](block.input ?? {}) : { error: `unknown tool ${block.name}` };
      } catch (err) {
        out = { error: String(err?.message ?? err).slice(0, 300) };
      }
      calls.push({ name: block.name, input: block.input });
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out).slice(0, 20000) });
    }
    convo.push({ role: "user", content: results });
  }
  await log({ listingId, kind, model, usage, tag });
  return { final: null, text, usage, calls };
}
