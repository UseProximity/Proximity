import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const knowledgeDir = join(__dirname, "..", "knowledge");

// ── Resources ────────────────────────────────────────────────────────────────

const RESOURCES = [
  {
    uri: "proximity://api-routes",
    name: "API Routes",
    description:
      "All Next.js API routes: path, HTTP methods, auth requirements, Supabase tables touched, and purpose.",
    mimeType: "application/json",
    file: "api-routes.json",
  },
  {
    uri: "proximity://db-schema",
    name: "Database Schema",
    description:
      "Supabase (PostgreSQL) table definitions. Includes columns, types, and relationships.",
    mimeType: "application/json",
    file: "db-schema.json",
  },
  {
    uri: "proximity://components",
    name: "React Components",
    description:
      "Inventory of all React components: file path, purpose, props summary, and which pages use them.",
    mimeType: "application/json",
    file: "components.json",
  },
  {
    uri: "proximity://domain",
    name: "Domain Overview",
    description:
      "Core domain knowledge: roles (student/landlord/super), auth flow (NextAuth v5 + Google OAuth), key workflows, tech stack, and data flow.",
    mimeType: "application/json",
    file: "domain.json",
  },
];

function readKnowledge(filename) {
  const filepath = join(knowledgeDir, filename);
  if (!existsSync(filepath)) {
    return JSON.stringify({
      error: `Knowledge file '${filename}' not found. Run: npm run generate`,
    });
  }
  return readFileSync(filepath, "utf-8");
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const PROMPTS = [
  {
    name: "add-api-route",
    description: "Scaffold a new Next.js API route following Proximity conventions",
    arguments: [
      { name: "path", description: "Route path, e.g. /api/reviews/[id]", required: true },
      { name: "methods", description: "HTTP methods, e.g. GET,POST", required: true },
      { name: "auth", description: "Auth level: public | any | landlord | super", required: true },
      { name: "purpose", description: "What this route does", required: true },
    ],
  },
  {
    name: "add-component",
    description: "Scaffold a new React component following Proximity conventions",
    arguments: [
      { name: "name", description: "Component name in PascalCase", required: true },
      { name: "purpose", description: "What the component renders/does", required: true },
    ],
  },
  {
    name: "debug-api-route",
    description: "Trace a failing API call: auth → DB → response",
    arguments: [
      { name: "route", description: "Route path, e.g. /api/listings", required: true },
      { name: "symptom", description: "What is failing or returning unexpectedly", required: true },
    ],
  },
];

function getPromptMessages(name, args) {
  const domain = readKnowledge("domain.json");
  const routes = readKnowledge("api-routes.json");
  const schema = readKnowledge("db-schema.json");

  switch (name) {
    case "add-api-route":
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are helping build a new Next.js API route for the Proximity housing app.

## Domain context
${domain}

## Existing routes (for convention reference)
${routes}

## Task
Scaffold a new route at \`app/api${args.path}/route.js\` with:
- Methods: ${args.methods}
- Auth level: ${args.auth}
- Purpose: ${args.purpose}

Follow these conventions from the codebase:
- Import \`supabase\` from \`@/libs/supabase\` for DB access
- Import \`auth\` from \`@/auth\` and call \`const session = await auth()\` to check auth
- Return \`Response.json(...)\` (not NextResponse) unless you need redirect/headers
- Use \`NextResponse.json\` only when you need custom status codes alongside JSON
- role check: \`session.user.role\` is one of "student" | "landlord" | "super"
- super-only guard: \`if (!session || session.user.role !== "super") return Response.json({ error: "Forbidden" }, { status: 403 })\``,
          },
        },
      ];

    case "add-component":
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are helping build a new React component for the Proximity housing app.

## Domain context
${domain}

## Task
Create a component named \`${args.name}\` in the \`components/\` directory.
Purpose: ${args.purpose}

Follow these conventions:
- Plain JavaScript (no TypeScript)
- Tailwind CSS for styling (no CSS modules)
- Use \`"use client"\` directive only if the component needs browser APIs or React hooks
- Import icons from \`lucide-react\` or \`react-icons\`
- Keep the file under 200 lines; extract sub-components if needed`,
          },
        },
      ];

    case "debug-api-route":
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are debugging a failing API route in the Proximity housing app.

## Domain context
${domain}

## Route index
${routes}

## DB schema
${schema}

## Issue
Route: ${args.route}
Symptom: ${args.symptom}

Trace the request through:
1. Auth guard (session check, role check)
2. Input validation
3. Supabase query (check table name, column names, RLS policies if applicable)
4. Response shape

List the most likely failure points and a fix for each.`,
          },
        },
      ];

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "proximity", version: "0.1.0" },
  { capabilities: { resources: {}, prompts: {} } }
);

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

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS,
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const messages = getPromptMessages(name, args ?? {});
  return { messages };
});

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
