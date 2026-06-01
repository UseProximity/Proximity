import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { RESOURCES, readKnowledge } from "./resources.mjs";
import { PROMPTS, getPromptMessages } from "./prompts.mjs";
import { TOOLS, callTool } from "./tools.mjs";

// ── Server setup ──────────────────────────────────────────────────────────────
// Wires together the modular resources / prompts / tools. Resources expose the
// generated knowledge files; prompts scaffold + debug routes/components/pages and
// activate agent roles; tools let the model update knowledge, log tasks, and drive
// agent swarms. Keep this file thin — capabilities live in the imported modules.

const server = new Server(
  { name: "proximity", version: "0.2.0" },
  { capabilities: { resources: {}, prompts: {}, tools: {} } }
);

// ── Resources ───────────────────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: RESOURCES.map(({ uri, name, description, mimeType }) => ({
    uri,
    name,
    description,
    mimeType,
  })),
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const resource = RESOURCES.find((r) => r.uri === uri);
  if (!resource) throw new Error(`Unknown resource: ${uri}`);
  const text = readKnowledge(resource.file);
  return { contents: [{ uri, mimeType: resource.mimeType, text }] };
});

// ── Prompts ───────────────────────────────────────────────────────────────────

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS,
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const messages = getPromptMessages(name, args ?? {});
  return { messages };
});

// ── Tools ───────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return callTool(name, args ?? {});
});

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
