import { readKnowledge } from "./resources.mjs";
import {
  buildFrontendBriefing,
  buildBackendBriefing,
  buildDatabaseBriefing,
  buildFullstackBriefing,
  buildSecurityBriefing,
  buildOptimizationBriefing,
} from "./tools.mjs";

// ── Scaffold & debug prompts ───────────────────────────────────────────────────

export const PROMPTS = [
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
    name: "add-page",
    description: "Scaffold a new Next.js page following Proximity conventions",
    arguments: [
      { name: "path", description: "URL path, e.g. /profile or /dashboard/settings", required: true },
      { name: "role", description: "Minimum role required: public | student | landlord | super", required: true },
      { name: "purpose", description: "What this page shows/does", required: true },
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
  {
    name: "debug-auth",
    description: "Trace an auth or permission failure across the NextAuth → session → API guard chain",
    arguments: [
      { name: "route", description: "Route or page where the auth failure occurs", required: true },
      { name: "role", description: "The user role that is experiencing the issue", required: true },
      { name: "symptom", description: "What is failing — 401, 403, redirect loop, missing session, etc.", required: true },
    ],
  },

  // ── Agent role prompts ──────────────────────────────────────────────────────

  {
    name: "agent-frontend",
    description:
      "Activate the Frontend Specialist role — pre-loads components, pages, and conventions for a specific goal. " +
      "Use this to set up a single-agent frontend session, or as the prompt for a Task agent in a parallel swarm.",
    arguments: [
      { name: "goal", description: "The feature or task to implement", required: true },
      { name: "interface_contract", description: "How this agent hands off data to/from backend (endpoint, request shape, response shape)", required: false },
      { name: "notes", description: "Additional implementation constraints or context", required: false },
    ],
  },
  {
    name: "agent-backend",
    description:
      "Activate the Backend API Specialist role — pre-loads API routes, DB schema, and utilities for a specific goal. " +
      "Use this to set up a single-agent backend session, or as the prompt for a Task agent in a parallel swarm.",
    arguments: [
      { name: "goal", description: "The feature or task to implement", required: true },
      { name: "interface_contract", description: "How the frontend will call this API (endpoint, request body, expected response)", required: false },
      { name: "notes", description: "Additional implementation constraints or context", required: false },
    ],
  },
  {
    name: "agent-database",
    description:
      "Activate the Database Specialist role — pre-loads schema and migration context for schema changes or new tables.",
    arguments: [
      { name: "goal", description: "The schema change or migration needed", required: true },
      { name: "notes", description: "Additional context about the migration or constraints", required: false },
    ],
  },
  {
    name: "agent-fullstack",
    description:
      "Activate the Fullstack Engineer role — pre-loads all knowledge files for a solo full-vertical implementation " +
      "(components + pages + API routes + schema).",
    arguments: [
      { name: "goal", description: "The feature or task to implement end-to-end", required: true },
      { name: "notes", description: "Additional implementation constraints or context", required: false },
    ],
  },
  {
    name: "agent-security",
    description:
      "Activate the Security Specialist role — audits code against OWASP/Proximity security patterns. " +
      "Reports auth gaps, input validation issues, RLS misconfigs, and secret leakage. Does not implement — reviews and reports.",
    arguments: [
      { name: "goal", description: "The feature or area being reviewed", required: true },
      { name: "notes", description: "Specific concerns or files to focus on", required: false },
    ],
  },
  {
    name: "agent-optimization",
    description:
      "Activate the Optimization Specialist role — reviews code for N+1 queries, missing indexes, render performance, bundle size, and dead code. Does not implement — reviews and reports.",
    arguments: [
      { name: "goal", description: "The feature or area being reviewed", required: true },
      { name: "notes", description: "Specific concerns or files to focus on", required: false },
    ],
  },
];

// ── Message builders ──────────────────────────────────────────────────────────

export function getPromptMessages(name, args) {
  const domain = readKnowledge("domain.json");
  const routes = readKnowledge("api-routes.json");
  const schema = readKnowledge("db-schema.json");
  const pages = readKnowledge("pages.json");

  switch (name) {
    case "add-api-route":
      return [{
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
- super-only guard: \`if (!session || session.user.role !== "super") return Response.json({ error: "Forbidden" }, { status: 403 })\`

After creating the file, call the \`update-knowledge\` MCP tool to add this route to the api-routes knowledge file.`,
        },
      }];

    case "add-component":
      return [{
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
- Keep the file under 200 lines; extract sub-components if needed

After creating the file, call the \`update-knowledge\` MCP tool to add this component to the components knowledge file.`,
        },
      }];

    case "add-page":
      return [{
        role: "user",
        content: {
          type: "text",
          text: `You are helping build a new Next.js page for the Proximity housing app.

## Domain context
${domain}

## Existing pages (for convention reference)
${pages}

## Task
Scaffold a new page at \`app${args.path}/page.js\`.
- Role requirement: ${args.role}
- Purpose: ${args.purpose}

Follow these conventions:
- Plain JavaScript (no TypeScript for page files)
- Server Components by default; add \`"use client"\` only when needed
- For role-gated pages: check session at the top and redirect to / if unauthorized
  \`import { auth } from "@/auth"; import { redirect } from "next/navigation";\`
- Use Tailwind CSS for layout and styling
- Import shared components from \`@/components\`

After creating the file, call the \`update-knowledge\` MCP tool to add this page to the pages knowledge file.`,
        },
      }];

    case "debug-api-route":
      return [{
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
      }];

    case "debug-auth":
      return [{
        role: "user",
        content: {
          type: "text",
          text: `You are debugging an authentication or authorization failure in the Proximity housing app.

## Domain context (auth section is most relevant)
${domain}

## Route index
${routes}

## Issue
Route/page: ${args.route}
User role experiencing the issue: ${args.role}
Symptom: ${args.symptom}

Trace through the auth chain:
1. NextAuth session creation (Google OAuth → JWT → session callback in auth.js)
2. Session shape on the client vs server (\`session.user.role\`, \`session.user.id\`, \`session.user.profileComplete\`)
3. Middleware check (middleware.ts — does the route require auth at the middleware level?)
4. API route guard (does the route call \`await auth()\` correctly?)
5. Role check (is the role being compared to the right string: "student" | "landlord" | "super"?)

List the most likely failure points with fixes.`,
        },
      }];

    // ── Agent role prompts ────────────────────────────────────────────────────

    case "agent-frontend":
      return [{
        role: "user",
        content: {
          type: "text",
          text: buildFrontendBriefing(args.goal, args.interface_contract, args.notes),
        },
      }];

    case "agent-backend":
      return [{
        role: "user",
        content: {
          type: "text",
          text: buildBackendBriefing(args.goal, args.interface_contract, args.notes),
        },
      }];

    case "agent-database":
      return [{
        role: "user",
        content: {
          type: "text",
          text: buildDatabaseBriefing(args.goal, null, args.notes),
        },
      }];

    case "agent-fullstack":
      return [{
        role: "user",
        content: {
          type: "text",
          text: buildFullstackBriefing(args.goal, args.notes),
        },
      }];

    case "agent-security":
      return [{
        role: "user",
        content: {
          type: "text",
          text: buildSecurityBriefing(args.goal, args.notes),
        },
      }];

    case "agent-optimization":
      return [{
        role: "user",
        content: {
          type: "text",
          text: buildOptimizationBriefing(args.goal, args.notes),
        },
      }];

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
