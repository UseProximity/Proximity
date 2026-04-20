import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const knowledgeDir = join(__dirname, "..", "knowledge");

export const RESOURCES = [
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
  {
    uri: "proximity://utils",
    name: "Utility & Library Files",
    description:
      "All files in libs/ and utils/: what each exports, its purpose, and when to use it.",
    mimeType: "application/json",
    file: "utils.json",
  },
  {
    uri: "proximity://pages",
    name: "App Pages",
    description:
      "All Next.js page routes (non-API): URL path, file location, and purpose.",
    mimeType: "application/json",
    file: "pages.json",
  },
  {
    uri: "proximity://env-vars",
    name: "Environment Variables",
    description:
      "All environment variables used in the codebase: name, category, required status, and description.",
    mimeType: "application/json",
    file: "env-vars.json",
  },
  {
    uri: "proximity://active-tasks",
    name: "Active Tasks & Decisions",
    description:
      "Living log of in-progress tasks, architectural decisions, known bugs, and ongoing migrations.",
    mimeType: "application/json",
    file: "active-tasks.json",
  },
  {
    uri: "proximity://agent-sessions",
    name: "Agent Sessions",
    description:
      "Live log of all spawned agent swarms: session ID, goal, roles, per-agent step progress, files created/modified, and status.",
    mimeType: "application/json",
    file: "agent-sessions.json",
  },
];

export function readKnowledge(filename) {
  const filepath = join(knowledgeDir, filename);
  if (!existsSync(filepath)) {
    return JSON.stringify({
      error: `Knowledge file '${filename}' not found. Run: cd mcp && node scripts/generate-knowledge.mjs`,
    });
  }
  return readFileSync(filepath, "utf-8");
}

export function writeKnowledge(filename, data) {
  const filepath = join(knowledgeDir, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
}

export function getKnowledgePath(filename) {
  return join(knowledgeDir, filename);
}
