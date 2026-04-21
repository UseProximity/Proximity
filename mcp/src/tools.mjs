import { readFileSync, writeFileSync, existsSync } from "fs";
import { readKnowledge, getKnowledgePath } from "./resources.mjs";

// ── Tool definitions ──────────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: "spawn-agents",
    description:
      "Generate parallel agent briefings for a Proximity feature. " +
      "Each agent gets a role-scoped briefing pre-loaded with the relevant knowledge (components, routes, schema, etc.) " +
      "and a shared interface contract so agents coordinate without colliding. " +
      "Returns ready-to-use Task prompts for each agent plus coordinator instructions. " +
      "Security and optimization agents are ALWAYS auto-included in every swarm — do not add them to roles. " +
      "Supports roles: frontend, backend, database, fullstack.",
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "The feature or task to implement. Be specific — this becomes the shared objective for all agents.",
        },
        roles: {
          type: "array",
          items: {
            type: "string",
            enum: ["frontend", "backend", "database", "fullstack"],
          },
          description: "Agent roles to spawn. Typical pair: [\"frontend\", \"backend\"]. Add \"database\" for schema changes. Security and optimization are auto-added — do not include them here.",
          minItems: 1,
          maxItems: 4,
        },
        interface_contract: {
          type: "string",
          description:
            "Optional. Describe how agents should hand off data between each other — " +
            "e.g. 'Frontend calls POST /api/reviews with { listingId, rating, content }. Backend returns { review: { id, rating } }'. " +
            "If omitted, a generic contract reminder is included instead.",
        },
        notes: {
          type: "string",
          description: "Optional. Additional implementation constraints, design decisions, or context all agents should know.",
        },
      },
      required: ["goal", "roles"],
    },
  },

  {
    name: "update-knowledge",
    description:
      "Add or update a single entry in a Proximity knowledge file. " +
      "Call this whenever you add, change, or discover a component, API route, utility, page, or env var " +
      "that is not yet reflected in the knowledge files.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["api-routes", "db-schema", "components", "utils", "pages", "env-vars"],
          description: "Which knowledge file to update",
        },
        operation: {
          type: "string",
          enum: ["upsert", "remove"],
          description: "upsert = add or replace the entry; remove = delete it by key",
        },
        key: {
          type: "string",
          description:
            "Unique identifier for the entry. For api-routes: the URL path (e.g. '/api/reviews/[id]'). " +
            "For components: the component name (e.g. 'ReviewCard'). " +
            "For utils: the file path (e.g. 'libs/supabase.js'). " +
            "For pages: the URL path (e.g. '/profile'). " +
            "For env-vars: the variable name (e.g. 'STRIPE_SECRET_KEY').",
        },
        entry: {
          type: "object",
          description:
            "The full entry object to upsert. Omit for remove operations. " +
            "Shape varies by category — match the existing entries in the knowledge file.",
        },
      },
      required: ["category", "operation", "key"],
    },
  },
  {
    name: "log-agent-step",
    description:
      "Log a progress step from a running agent. Agents MUST call this at key checkpoints: " +
      "on start, before/after each file operation, and on completion. " +
      "This feeds the get-agent-status view so the coordinator and user can see what each agent is doing in real time.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The session ID returned in your briefing from spawn-agents (e.g. 'swarm-1234567890')",
        },
        role: {
          type: "string",
          enum: ["frontend", "backend", "database", "fullstack", "security", "optimization"],
          description: "Your agent role",
        },
        type: {
          type: "string",
          enum: ["start", "action", "file_created", "file_modified", "complete", "error"],
          description:
            "Step type. Use: start=beginning work, action=about to do something, " +
            "file_created=created a new file, file_modified=edited an existing file, " +
            "complete=all done, error=something failed",
        },
        message: {
          type: "string",
          description: "Human-readable description of what you are doing or just did (1–2 sentences)",
        },
        file: {
          type: "string",
          description: "Optional. File path being created or modified (e.g. 'components/ReviewForm.js')",
        },
      },
      required: ["session_id", "role", "type", "message"],
    },
  },
  {
    name: "get-agent-status",
    description:
      "Return a human-readable status report of active or recent agent swarm sessions. " +
      "Shows each agent's role, current step, files created/modified, and overall status. " +
      "Call this to check on running agents or review a completed swarm.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Optional. If provided, return status for that specific session only.",
        },
        limit: {
          type: "number",
          description: "Number of most recent sessions to return (default: 3, max: 10). Ignored if session_id is provided.",
        },
      },
      required: [],
    },
  },
  {
    name: "log-task",
    description:
      "Log an active task, architectural decision, known bug, or migration status to active-tasks.json. " +
      "Use this to keep a living record of ongoing work and important decisions.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["task", "decision", "bug", "migration"],
          description: "The kind of entry to log",
        },
        title: {
          type: "string",
          description: "Short title for the entry (1 line)",
        },
        description: {
          type: "string",
          description: "Full description of the task, decision rationale, bug symptoms, or migration scope",
        },
        status: {
          type: "string",
          enum: ["active", "pending", "resolved"],
          description: "Current status",
        },
        context: {
          type: "string",
          description: "Optional extra context — related files, PR links, background",
        },
      },
      required: ["type", "title", "description", "status"],
    },
  },
];

// ── Category config: maps category name → file + array key + ID field ────────

const CATEGORY_CONFIG = {
  "api-routes": { file: "api-routes.json", arrayKey: "routes", idField: "path" },
  "db-schema": { file: "db-schema.json", arrayKey: null, idField: null }, // special handling
  "components": { file: "components.json", arrayKey: "components", idField: "name" },
  "utils": { file: "utils.json", arrayKey: "utils", idField: "file" },
  "pages": { file: "pages.json", arrayKey: "pages", idField: "path" },
  "env-vars": { file: "env-vars.json", arrayKey: "envVars", idField: "name" },
};

// ── Tool handlers ─────────────────────────────────────────────────────────────

function handleUpdateKnowledge({ category, operation, key, entry }) {
  const config = CATEGORY_CONFIG[category];
  if (!config) {
    return { isError: true, content: [{ type: "text", text: `Unknown category: ${category}` }] };
  }

  if (!config.arrayKey) {
    return {
      isError: true,
      content: [{ type: "text", text: `Category '${category}' requires manual editing (complex nested structure).` }],
    };
  }

  const filepath = getKnowledgePath(config.file);
  if (!existsSync(filepath)) {
    return {
      isError: true,
      content: [{ type: "text", text: `Knowledge file not found: ${config.file}. Run: cd mcp && node scripts/generate-knowledge.mjs` }],
    };
  }

  let doc;
  try {
    doc = JSON.parse(readFileSync(filepath, "utf-8"));
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Failed to parse ${config.file}: ${err.message}` }] };
  }

  if (!Array.isArray(doc[config.arrayKey])) {
    return { isError: true, content: [{ type: "text", text: `Expected '${config.arrayKey}' to be an array in ${config.file}` }] };
  }

  const arr = doc[config.arrayKey];
  const idx = arr.findIndex((item) => item[config.idField] === key);

  if (operation === "remove") {
    if (idx === -1) {
      return { content: [{ type: "text", text: `No entry with ${config.idField}='${key}' found in ${config.file} — nothing to remove.` }] };
    }
    arr.splice(idx, 1);
    doc.count = arr.length;
    writeFileSync(filepath, JSON.stringify(doc, null, 2), "utf-8");
    return { content: [{ type: "text", text: `Removed entry '${key}' from ${category}.` }] };
  }

  // upsert
  if (!entry) {
    return { isError: true, content: [{ type: "text", text: "entry is required for upsert operations." }] };
  }

  if (idx === -1) {
    arr.push(entry);
    doc.count = arr.length;
    writeFileSync(filepath, JSON.stringify(doc, null, 2), "utf-8");
    return { content: [{ type: "text", text: `Added new entry '${key}' to ${category}. Total: ${arr.length}.` }] };
  } else {
    arr[idx] = entry;
    writeFileSync(filepath, JSON.stringify(doc, null, 2), "utf-8");
    return { content: [{ type: "text", text: `Updated entry '${key}' in ${category}.` }] };
  }
}

function handleLogTask({ type, title, description, status, context }) {
  const filepath = getKnowledgePath("active-tasks.json");
  if (!existsSync(filepath)) {
    return {
      isError: true,
      content: [{ type: "text", text: "active-tasks.json not found. Run: cd mcp && node scripts/generate-knowledge.mjs" }],
    };
  }

  let doc;
  try {
    doc = JSON.parse(readFileSync(filepath, "utf-8"));
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Failed to parse active-tasks.json: ${err.message}` }] };
  }

  const arrayKey = type === "decision" ? "decisions" : type === "bug" ? "bugs" : type === "migration" ? "migrations" : "tasks";
  if (!Array.isArray(doc[arrayKey])) doc[arrayKey] = [];

  const id = `${type}-${Date.now()}`;
  const newEntry = {
    id,
    title,
    description,
    status,
    ...(context ? { context } : {}),
    created: new Date().toISOString(),
  };

  doc[arrayKey].push(newEntry);
  writeFileSync(filepath, JSON.stringify(doc, null, 2), "utf-8");

  return { content: [{ type: "text", text: `Logged ${type}: "${title}" (id: ${id})` }] };
}

// ── Session helpers ───────────────────────────────────────────────────────────

function readSessions() {
  const filepath = getKnowledgePath("agent-sessions.json");
  if (!existsSync(filepath)) return { sessions: [] };
  try { return JSON.parse(readFileSync(filepath, "utf-8")); } catch { return { sessions: [] }; }
}

function writeSessions(doc) {
  const filepath = getKnowledgePath("agent-sessions.json");
  writeFileSync(filepath, JSON.stringify(doc, null, 2), "utf-8");
}

function createSession(goal, roles) {
  const session_id = `swarm-${Date.now()}`;
  const agents = {};
  for (const role of roles) {
    agents[role] = { status: "pending", steps: [], files_created: [], files_modified: [] };
  }
  const session = { session_id, goal, roles, created: new Date().toISOString(), status: "active", agents };
  const doc = readSessions();
  if (!Array.isArray(doc.sessions)) doc.sessions = [];
  doc.sessions.push(session);
  writeSessions(doc);
  return session_id;
}

function relativeTime(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

const STEP_ICON = { start: "▶", action: "⋯", file_created: "✚", file_modified: "✎", complete: "✔", error: "✖" };

function formatSession(session) {
  const age = relativeTime(session.created);
  const statusLabel = session.status === "active" ? "🟡 active" : session.status === "complete" ? "🟢 complete" : "🔴 error";
  let out = `### Swarm \`${session.session_id}\` — ${statusLabel}\n`;
  out += `**Goal:** ${session.goal}\n**Started:** ${age}\n\n`;
  for (const [role, agent] of Object.entries(session.agents)) {
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    const aStatus = agent.status === "complete" ? "✔" : agent.status === "error" ? "✖" : "⋯";
    out += `**${aStatus} ${roleLabel} Specialist** (${agent.status})\n`;
    for (const step of agent.steps.slice(-6)) {
      const icon = STEP_ICON[step.type] ?? "•";
      const fileNote = step.file ? ` \`${step.file}\`` : "";
      out += `  ${icon} ${step.message}${fileNote} _(${relativeTime(step.ts)})_\n`;
    }
    if (agent.files_created.length) out += `  📄 Created: ${agent.files_created.join(", ")}\n`;
    if (agent.files_modified.length) out += `  ✏️  Modified: ${agent.files_modified.join(", ")}\n`;
    out += "\n";
  }
  return out;
}

// ── New tool handlers ──────────────────────────────────────────────────────────

function handleLogAgentStep({ session_id, role, type, message, file }) {
  const doc = readSessions();
  if (!Array.isArray(doc.sessions)) return { isError: true, content: [{ type: "text", text: "agent-sessions.json is missing or malformed." }] };

  const session = doc.sessions.find((s) => s.session_id === session_id);
  if (!session) {
    return { isError: true, content: [{ type: "text", text: `Session '${session_id}' not found. Check your session ID.` }] };
  }

  if (!session.agents[role]) {
    session.agents[role] = { status: "pending", steps: [], files_created: [], files_modified: [] };
  }
  const agent = session.agents[role];

  const step = { ts: new Date().toISOString(), type, message, ...(file ? { file } : {}) };
  agent.steps.push(step);

  if (type === "start" || agent.status === "pending") agent.status = "active";
  if (type === "complete") agent.status = "complete";
  if (type === "error") agent.status = "error";
  if (type === "file_created" && file) agent.files_created.push(file);
  if (type === "file_modified" && file) agent.files_modified.push(file);

  // Mark session complete when all agents are done
  const allDone = Object.values(session.agents).every((a) => ["complete", "error"].includes(a.status));
  if (allDone) session.status = session.agents && Object.values(session.agents).some((a) => a.status === "error") ? "error" : "complete";

  writeSessions(doc);
  return { content: [{ type: "text", text: `[${session_id}] ${role}: ${message}` }] };
}

function handleGetAgentStatus({ session_id, limit = 3 }) {
  const doc = readSessions();
  if (!Array.isArray(doc.sessions) || doc.sessions.length === 0) {
    return { content: [{ type: "text", text: "No agent sessions found. Call spawn-agents to start a swarm." }] };
  }

  let sessions;
  if (session_id) {
    const s = doc.sessions.find((x) => x.session_id === session_id);
    sessions = s ? [s] : [];
    if (!sessions.length) return { content: [{ type: "text", text: `Session '${session_id}' not found.` }] };
  } else {
    const cap = Math.min(limit, 10);
    sessions = doc.sessions.slice(-cap).reverse(); // most recent first
  }

  const active = sessions.filter((s) => s.status === "active");
  const rest = sessions.filter((s) => s.status !== "active");
  const ordered = [...active, ...rest];

  const header = `## Agent Status Report\n_${new Date().toLocaleTimeString()}_\n\n`;
  const body = ordered.map(formatSession).join("─".repeat(40) + "\n");
  return { content: [{ type: "text", text: header + body }] };
}

// ── Agent briefing builders ───────────────────────────────────────────────────

function safeRead(file) {
  try { return JSON.parse(readKnowledge(file)); } catch { return null; }
}

function fmtComponents(doc) {
  if (!doc?.components) return "(knowledge file not found — run generate-knowledge.mjs)";
  return doc.components
    .map((c) => `  - **${c.name}** (\`${c.file}\`): ${c.description}`)
    .join("\n");
}

function fmtPages(doc) {
  if (!doc?.pages) return "(knowledge file not found)";
  return doc.pages
    .map((p) => `  - \`${p.path}\` → \`${p.file}\`: ${p.description}`)
    .join("\n");
}

function fmtRoutes(doc) {
  if (!doc?.routes) return "(knowledge file not found)";
  return doc.routes
    .map((r) => `  - \`${r.methods.join("|")} ${r.path}\` [auth:${r.auth}]${r.tables.length ? ` tables:${r.tables.join(",")}` : ""}`)
    .join("\n");
}

function fmtUtils(doc) {
  if (!doc?.utils) return "(knowledge file not found)";
  return doc.utils
    .map((u) => `  - \`${u.file}\`: ${u.description}`)
    .join("\n");
}

function fmtSchema(doc) {
  if (!doc?.supabase?.tables) return "(knowledge file not found)";
  return doc.supabase.tables
    .map((t) => {
      // Support both legacy shape ({name, type, note}) and new compact shape (string "name:type notes").
      const cols = (t.columns ?? [])
        .map((c) =>
          typeof c === "string"
            ? c
            : `${c.name}:${c.type}${c.note ? ` (${c.note})` : ""}`
        )
        .join(", ");
      const extra = t.notes ? `\n    notes: ${t.notes}` : "";
      return `  - **${t.table}**: ${t.description}\n    columns: ${cols}${extra}`;
    })
    .join("\n");
}

// ── Shared working principles (included in every specialist briefing) ─────────
// Keep this short. Agents copy-paste briefings into Task tool prompts — long preambles eat context.
const WORKING_PRINCIPLES = `## Working Principles (apply before every action)
- **Ask before assuming**: If the goal, file locations, naming, or scope are ambiguous, ask one focused clarifying question before writing code. Don't guess on behalf of the user.
- **Narrate changes**: Before each file edit or SQL migration, output one short sentence naming the file and what you're changing (e.g. "Updating app/api/foo/route.js: fix role lookup to use roles!role_id(name)"). Skip this for read-only exploration.`;

function fmtActiveTasks(doc) {
  if (!doc) return "";
  const items = [];
  for (const [key, arr] of Object.entries(doc)) {
    if (key.startsWith("_") || !Array.isArray(arr)) continue;
    const active = arr.filter((i) => i.status === "active");
    if (active.length) items.push(`**${key}:** ${active.map((i) => i.title).join(", ")}`);
  }
  return items.length ? items.join("\n") : "None active.";
}

export function buildFrontendBriefing(goal, interfaceContract, notes) {
  const components = safeRead("components.json");
  const pages = safeRead("pages.json");
  const tasks = safeRead("active-tasks.json");

  return `# Proximity Frontend Specialist

## Your Goal
${goal}

## Your Role
You are the **Frontend Specialist** for this task. You own all React components, page updates, and client-side logic needed to deliver the feature. You do NOT touch API route files.

${WORKING_PRINCIPLES}

## Proximity Frontend Conventions
- **Language**: Plain JavaScript (no TypeScript in components/ or app/ pages)
- **Styling**: Tailwind CSS only — no CSS modules, no inline styles
- **Client components**: Add \`"use client"\` only when the component uses hooks, browser APIs, or event handlers
- **Icons**: \`lucide-react\` or \`react-icons\`
- **File size**: Keep components under 200 lines — extract sub-components if needed
- **Auth check in pages**: \`import { auth } from "@/auth"; const session = await auth();\` then redirect if unauthorized
- **Imports**: Use \`@/components/...\`, \`@/libs/...\`, \`@/utils/...\` path aliases

## Tech Stack
- Framework: Next.js 15 (App Router), React 18
- Styling: Tailwind CSS 3
- UI libraries: Radix UI, Lucide React, Framer Motion, Recharts
- Auth: NextAuth v5 — \`session.user.role\` is \`"student" | "landlord" | "super"\`

## Existing Components (reuse before creating new ones)
${fmtComponents(components)}

## Existing Pages (understand where the new UI lives)
${fmtPages(pages)}

## Active Migrations & Decisions
${fmtActiveTasks(tasks)}
${notes ? `\n## Additional Context\n${notes}` : ""}

## Interface Contract with Backend Specialist
${interfaceContract || "_Coordinate with the Backend Specialist on the exact API endpoint path, request body shape, and response shape before writing any fetch calls._"}

## Your Deliverables
After completing your work:
1. Call \`mcp__proximity__update-knowledge\` for each new or modified component/page
2. Confirm to the coordinator which files you created/modified`;
}

export function buildBackendBriefing(goal, interfaceContract, notes) {
  const routes = safeRead("api-routes.json");
  const schema = safeRead("db-schema.json");
  const utils = safeRead("utils.json");
  const tasks = safeRead("active-tasks.json");

  return `# Proximity Backend API Specialist

## Your Goal
${goal}

## Your Role
You are the **Backend API Specialist** for this task. You own all API routes (\`app/api/\`), Supabase queries, and server-side logic. You do NOT touch component or page files.

${WORKING_PRINCIPLES}

## Proximity API Conventions
- **File location**: \`app/api/<path>/route.js\` (JavaScript, not TypeScript)
- **Auth guard**: \`import { auth } from "@/auth"; const session = await auth();\`
- **Auth levels**: public (no guard), any (session check), landlord+ (role check), super (super-only guard)
- **Super guard**: \`if (!session || session.user.role !== "super") return Response.json({ error: "Forbidden" }, { status: 403 })\`
- **DB access**: \`import supabase from "@/libs/supabase"\` — prefer Supabase for all new code
- **Responses**: Use \`Response.json(...)\` — use \`NextResponse.json\` only when setting custom headers
- **Error shape**: \`{ error: "message" }\` with appropriate HTTP status
- **Column naming**: Supabase columns are snake_case; convert to camelCase in the JS layer

## Existing API Routes (follow these patterns)
${fmtRoutes(routes)}

## Database Schema
${fmtSchema(schema)}

## Available Utilities & Libraries
${fmtUtils(utils)}

## Active Migrations & Decisions
${fmtActiveTasks(tasks)}
${notes ? `\n## Additional Context\n${notes}` : ""}

## Interface Contract with Frontend Specialist
${interfaceContract || "_Coordinate with the Frontend Specialist on the exact API endpoint path, request body shape, and response shape before writing any handlers._"}

## Your Deliverables
After completing your work:
1. Call \`mcp__proximity__update-knowledge\` for each new or modified API route
2. Confirm to the coordinator which files you created/modified and what the exact endpoint interface is`;
}

export function buildDatabaseBriefing(goal, interfaceContract, notes) {
  const schema = safeRead("db-schema.json");
  const utils = safeRead("utils.json");
  const tasks = safeRead("active-tasks.json");

  return `# Proximity Database Specialist

## Your Goal
${goal}

## Your Role
You are the **Database Specialist** for this task. You own Supabase schema changes, migrations, and any RLS policy updates. You do NOT touch API route logic or UI files.

${WORKING_PRINCIPLES}

## Proximity Database Conventions
- **DB**: Supabase (PostgreSQL) — all tables/columns go here
- **Column naming**: snake_case in Supabase; camelCase in JS layer
- **Computed columns**: Use Supabase DB triggers for aggregate values (min_rent, rating, etc.)
- **RLS**: Document any row-level security policies you add
- **Supabase client**: \`import supabase from "@/libs/supabase"\` for server-side operations

## Current Schema
${fmtSchema(schema)}

## Available DB Utilities
${fmtUtils(utils)}

## Active Migrations & Decisions
${fmtActiveTasks(tasks)}
${notes ? `\n## Additional Context\n${notes}` : ""}

## Interface Contract
${interfaceContract || "_Coordinate with the Backend Specialist on new table/column names before they write queries._"}

## Your Deliverables
After completing your work:
1. Provide the SQL migration script or Supabase dashboard steps
2. Document any new tables/columns for the Backend Specialist
3. Call \`mcp__proximity__log-task\` to record the migration in active-tasks.json`;
}

export function buildFullstackBriefing(goal, notes) {
  const components = safeRead("components.json");
  const pages = safeRead("pages.json");
  const routes = safeRead("api-routes.json");
  const schema = safeRead("db-schema.json");
  const utils = safeRead("utils.json");
  const tasks = safeRead("active-tasks.json");

  return `# Proximity Fullstack Engineer

## Your Goal
${goal}

## Your Role
You own the full vertical slice for this feature: API routes, Supabase queries, React components, and page updates.

${WORKING_PRINCIPLES}

## Frontend Conventions
- Plain JavaScript, Tailwind CSS, \`"use client"\` only when needed
- Icons from \`lucide-react\` or \`react-icons\`
- Keep components under 200 lines

## Backend Conventions
- API routes in \`app/api/<path>/route.js\`
- Auth: \`import { auth } from "@/auth"\`
- DB: \`import supabase from "@/libs/supabase"\`
- Responses: \`Response.json(...)\`

## Existing Components
${fmtComponents(components)}

## Existing Pages
${fmtPages(pages)}

## Existing API Routes
${fmtRoutes(routes)}

## Database Schema
${fmtSchema(schema)}

## Available Utilities
${fmtUtils(utils)}

## Active Migrations & Decisions
${fmtActiveTasks(tasks)}
${notes ? `\n## Additional Context\n${notes}` : ""}

## Deliverables
After completing your work, call \`mcp__proximity__update-knowledge\` for each new/modified component, page, and API route.`;
}

export function buildSecurityBriefing(goal, notes) {
  const routes = safeRead("api-routes.json");
  const schema = safeRead("db-schema.json");
  const tasks = safeRead("active-tasks.json");

  return `# Proximity Security Specialist

## Your Goal
${goal}

## Your Role
You are the **Security Specialist** for this task. Proactively identify security vulnerabilities in the code being built and in related existing code. Do NOT implement features — analyze and report findings to the coordinator.

${WORKING_PRINCIPLES}

## Proximity Security Checklist
- **Auth guards**: Every non-public API route must call \`await auth()\` and verify \`session\`
- **Role enforcement**: Landlord/super routes must check \`session.user.role\`; never trust client-supplied role claims
- **Input validation**: Validate all user-supplied inputs at system boundaries before DB queries or file ops
- **SQL injection**: Supabase parameterized calls (\`.eq()\`, \`.in()\`, etc.) are safe — flag any string-interpolated raw SQL
- **XSS**: Never use \`dangerouslySetInnerHTML\` with user content without sanitization
- **Path traversal**: Never use user input directly in file system paths or storage keys without sanitization
- **Secrets**: No hardcoded credentials, API keys, or tokens — all via \`process.env.*\`
- **CORS**: Flag any permissive CORS headers unless explicitly intentional
- **RLS**: Every Supabase table exposed through an API route should have Row Level Security enabled
- **Error leakage**: API error responses must never expose stack traces, internal schema names, or system paths

## Existing API Routes (audit auth + role guards)
${fmtRoutes(routes)}

## Database Schema (audit RLS, sensitive columns)
${fmtSchema(schema)}

## Active Decisions
${fmtActiveTasks(tasks)}
${notes ? `\n## Additional Context\n${notes}` : ""}

## Your Deliverables
1. List security issues found, severity-tagged: \`[HIGH]\` / \`[MEDIUM]\` / \`[LOW]\`
2. For each issue: file path (if known), description, and recommended fix
3. Call \`mcp__proximity__log-task\` with \`type=bug, status=active\` for any HIGH-severity finding
4. Report findings before implementation is finalized so issues can be addressed in the design`;
}

export function buildOptimizationBriefing(goal, notes) {
  const routes = safeRead("api-routes.json");
  const schema = safeRead("db-schema.json");
  const components = safeRead("components.json");
  const tasks = safeRead("active-tasks.json");

  return `# Proximity Optimization Specialist

## Your Goal
${goal}

## Your Role
You are the **Optimization Specialist** for this task. Identify performance and code quality issues in the code being built and in related existing code. Do NOT implement features — analyze and report findings to the coordinator.

${WORKING_PRINCIPLES}

## Proximity Optimization Checklist
- **N+1 queries**: Multiple sequential DB calls inside loops → batch with \`.in()\` or Supabase joins
- **Column selection**: Fetch only needed columns — \`.select("id, name")\` not \`.select("*")\` on large tables
- **Missing indexes**: Columns used in \`.eq()\`, \`.order()\`, or \`.filter()\` on high-traffic tables should be indexed
- **Unnecessary re-fetches**: Identify routes that re-query data already available from a parent query
- **React re-renders**: Components receiving complex objects as props that re-render on every parent render
- **Bundle size**: Whole-library imports (\`import _ from 'lodash'\`) — flag in favor of named imports
- **Caching**: Semi-static data (listing metadata, university list) should use Next.js \`cache()\` or ISR (\`revalidate\`)
- **Image optimization**: All \`<img>\` tags with user-uploaded or static images should use \`next/image\`
- **Dead code**: Unused imports, variables, and commented-out blocks

## Existing API Routes (check query patterns)
${fmtRoutes(routes)}

## Database Schema (check indexing opportunities)
${fmtSchema(schema)}

## Existing Components (check render patterns)
${fmtComponents(components)}

## Active Decisions
${fmtActiveTasks(tasks)}
${notes ? `\n## Additional Context\n${notes}` : ""}

## Your Deliverables
1. List optimization opportunities found, impact-tagged: \`[HIGH]\` / \`[MEDIUM]\` / \`[LOW]\`
2. For each: file path (if known), description, and recommended fix
3. Report findings to the coordinator alongside the implementation agents' work`;
}

function loggingBlock(session_id, role) {
  return `
## Session Logging (REQUIRED)
Your session ID: \`${session_id}\`
You MUST call \`mcp__proximity__log-agent-step\` at each checkpoint below.

| When | type | example message |
|------|------|-----------------|
| First thing | \`start\` | "Starting ${role} work" |
| Before file op | \`action\` | "Creating ReviewForm component" |
| After creating a file | \`file_created\` | "ReviewForm.js scaffolded", file="components/ReviewForm.js" |
| After editing a file | \`file_modified\` | "Wired form into modal", file="components/GlobalListingModal.js" |
| All done | \`complete\` | "ReviewForm built and wired, calls POST /api/reviews" |
| On failure | \`error\` | "Could not find listing modal component" |`;
}

function handleSpawnAgents({ goal, roles, interface_contract, notes }) {
  // Auto-include security and optimization in every swarm
  const allRoles = [...roles, ...["security", "optimization"].filter((r) => !roles.includes(r))];
  const session_id = createSession(goal, allRoles);

  const briefings = [];
  for (const role of allRoles) {
    let text;
    switch (role) {
      case "frontend":
        text = buildFrontendBriefing(goal, interface_contract, notes) + loggingBlock(session_id, role);
        break;
      case "backend":
        text = buildBackendBriefing(goal, interface_contract, notes) + loggingBlock(session_id, role);
        break;
      case "database":
        text = buildDatabaseBriefing(goal, interface_contract, notes) + loggingBlock(session_id, role);
        break;
      case "fullstack":
        text = buildFullstackBriefing(goal, notes) + loggingBlock(session_id, role);
        break;
      case "security":
        text = buildSecurityBriefing(goal, notes) + loggingBlock(session_id, role);
        break;
      case "optimization":
        text = buildOptimizationBriefing(goal, notes) + loggingBlock(session_id, role);
        break;
      default:
        return { isError: true, content: [{ type: "text", text: `Unknown role: ${role}. Valid roles: frontend, backend, database, fullstack` }] };
    }
    briefings.push({ role, briefing: text });
  }

  // Also log the swarm to active-tasks.json
  const tasksPath = getKnowledgePath("active-tasks.json");
  if (existsSync(tasksPath)) {
    try {
      const doc = JSON.parse(readFileSync(tasksPath, "utf-8"));
      if (!Array.isArray(doc.tasks)) doc.tasks = [];
      doc.tasks.push({
        id: session_id,
        title: `Swarm: ${goal.slice(0, 60)}${goal.length > 60 ? "…" : ""}`,
        description: `Parallel agents spawned: ${allRoles.join(", ")}. Goal: ${goal}`,
        status: "active",
        created: new Date().toISOString(),
      });
      writeFileSync(tasksPath, JSON.stringify(doc, null, 2), "utf-8");
    } catch {
      // non-fatal
    }
  }

  // Build the response: header + one section per agent + coordinator footer
  const sep = "\n\n" + "─".repeat(60) + "\n\n";
  const header =
    `# Proximity Agent Swarm — \`${session_id}\`\n` +
    `**Goal:** ${goal}\n**Agents:** ${allRoles.join(", ")}\n\n` +
    `Spawn each agent below as a parallel Task in a single message. ` +
    `Track progress with \`mcp__proximity__get-agent-status\`.\n`;

  const agentSections = briefings
    .map((b, i) => `## Agent ${i + 1} of ${briefings.length}: ${b.role.charAt(0).toUpperCase() + b.role.slice(1)} Specialist\n\n${b.briefing}`)
    .join(sep);

  const footer =
    sep +
    `## Coordinator Instructions\n` +
    `- **Spawn all agents in ONE message** (multiple Task tool calls in parallel)\n` +
    `- Monitor progress: call \`mcp__proximity__get-agent-status\` with session_id \`${session_id}\`\n` +
    `- Each agent must call \`mcp__proximity__log-agent-step\` at each checkpoint\n` +
    `- Each agent calls \`mcp__proximity__update-knowledge\` after creating/modifying files\n` +
    `- After all agents finish, resolve any interface mismatches, then call \`mcp__proximity__log-task\` with status=resolved`;

  return {
    content: [{ type: "text", text: [header, agentSections, footer].join(sep) }],
  };
}

export function callTool(name, args) {
  switch (name) {
    case "spawn-agents":       return handleSpawnAgents(args);
    case "log-agent-step":     return handleLogAgentStep(args);
    case "get-agent-status":   return handleGetAgentStatus(args);
    case "update-knowledge":   return handleUpdateKnowledge(args);
    case "log-task":           return handleLogTask(args);
    default:
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  }
}
