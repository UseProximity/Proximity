/**
 * generate-knowledge.mjs
 *
 * Scans the Proximity codebase and writes structured JSON knowledge files
 * to mcp/knowledge/. Run this whenever the codebase changes significantly.
 *
 * Usage:
 *   cd mcp && node scripts/generate-knowledge.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", ".."); // monorepo root (contains apps/, packages/, mcp/)
const ROOT = join(REPO_ROOT, "apps", "web"); // Next.js app root — all scanned src/ lives here
const OUT = join(__dirname, "..", "knowledge");

mkdirSync(OUT, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function walk(dir, ext, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
      walk(full, ext, results);
    } else if (stat.isFile() && entry.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

function readFile(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function write(filename, data) {
  const path = join(OUT, filename);
  // Knowledge is committed to git, so regeneration must be idempotent: if the
  // only difference from the existing file is the `_generated` timestamp, keep
  // the old file so repeated runs (and CI) produce no diff.
  if (existsSync(path)) {
    try {
      const prev = JSON.parse(readFileSync(path, "utf-8"));
      const withoutTimestamp = (obj) => JSON.stringify({ ...obj, _generated: undefined }, null, 2);
      if (withoutTimestamp(prev) === withoutTimestamp(data)) {
        console.log(`• ${filename} (unchanged)`);
        return;
      }
    } catch {
      // unreadable/corrupt existing file — fall through and rewrite it
    }
  }
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✓ ${filename}`);
}

// ── 1. API Routes ─────────────────────────────────────────────────────────────

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// auth levels, weakest → strongest. "optional" means the handler consults the
// session to personalize but still serves anonymous callers a safe response
// (e.g. an empty list) — it is NOT a missing guard.
const AUTH_RANK = { public: 0, optional: 1, any: 2, "landlord+": 3, super: 4 };

// Slice each `export async function METHOD(...) {…}` body out of the route file so
// auth can be judged per method (a route's GET may be a public read while its POST
// is a guarded mutation).
function extractHandlerBodies(content) {
  const positions = [];
  for (const m of HTTP_METHODS) {
    const idx = content.search(new RegExp(`export\\s+async\\s+function\\s+${m}\\b`));
    if (idx !== -1) positions.push({ method: m, idx });
  }
  positions.sort((a, b) => a.idx - b.idx);
  const bodies = {};
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].idx : content.length;
    bodies[positions[i].method] = content.slice(positions[i].idx, end);
  }
  return bodies;
}

// True when the handler's missing-session branch returns a normal response (no
// 401/403) — i.e. it degrades gracefully for anonymous users rather than rejecting.
// We can't brace-balance with a regex, so we scan a window right after the
// `if (!session …)` guard and look for the hallmarks of a rejection.
function noSessionIsSoft(body) {
  const m = body.match(/if\s*\(\s*!session[^)]*\)/);
  if (!m) return false; // no explicit `if (!session …)` guard → treat as guarded
  const branch = body.slice(m.index, m.index + 240);
  const rejects = /status:\s*4\d\d/.test(branch) || /Unauthorized|Forbidden/i.test(branch);
  return !rejects;
}

function classifyHandlerAuth(body) {
  if (/requireSuper\(\)/.test(body) || /role\s*!==\s*["']super["']/.test(body)) return "super";
  // getRequestUser() is the shared session-or-bearer-token helper (apps/web/src/lib/getRequestUser.js)
  if (!/\bauth\(\)/.test(body) && !/getRequestUser\(/.test(body)) return "public"; // never consults the session
  if (noSessionIsSoft(body)) return "optional";  // personalizes but serves anon
  return /role[^;\n]*landlord/.test(body) ? "landlord+" : "any";
}

function inferRouteDetails(routePath, content) {
  const relPath = relative(ROOT, routePath);

  // Extract HTTP methods defined in the file + judge each one's auth level.
  const bodies = extractHandlerBodies(content);
  const methods = HTTP_METHODS.filter((m) => bodies[m]);
  const methodAuth = {};
  for (const m of methods) methodAuth[m] = classifyHandlerAuth(bodies[m]);

  // Route-level auth = the strongest guard across its methods (for summaries).
  let auth = "public";
  for (const m of methods) {
    if (AUTH_RANK[methodAuth[m]] > AUTH_RANK[auth]) auth = methodAuth[m];
  }

  // Detect Supabase tables accessed
  const tableMatches = [...content.matchAll(/\.from\(["']([a-z_]+)["']\)/g)];
  const tables = [...new Set(tableMatches.map((m) => m[1]))];

  // Derive URL path from filesystem path
  // e.g. src/app/api/favorites/[listingId]/route.js → /api/favorites/[listingId]
  const urlPath = relPath
    .replace(/^src\/app/, "")
    .replace(/\/route\.js$/, "")
    .replace(/\\/g, "/");

  return { path: urlPath, methods, auth, methodAuth, tables, file: relPath };
}

function generateApiRoutes() {
  const apiDir = join(ROOT, "src", "app", "api");
  const routeFiles = walk(apiDir, "route.js");

  const routes = routeFiles.map((filepath) => {
    const content = readFile(filepath);
    return inferRouteDetails(filepath, content);
  });

  // Sort by path
  routes.sort((a, b) => a.path.localeCompare(b.path));

  write("api-routes.json", {
    _description:
      "All Next.js API routes. auth (route-level = strongest across methods; methodAuth = per HTTP method): public=no auth, optional=personalizes for a session but serves anonymous a safe response, any=any signed-in user, landlord+=landlord or super, super=super admin only.",
    _generated: new Date().toISOString(),
    count: routes.length,
    routes,
  });
}

// ── 2. DB Schema ──────────────────────────────────────────────────────────────
// db-schema.json is hand-maintained against the live Supabase schema. This generator
// intentionally does NOT rewrite it — it would require live DB access at generate
// time, and the hardcoded snapshots here drift faster than they're useful.
// To refresh db-schema.json: query information_schema against the dev DB (see the
// comment at the top of db-schema.json) and update in place.

function generateDbSchema() {
  // no-op: db-schema.json is managed out-of-band.
}

// ── 3. Components ─────────────────────────────────────────────────────────────

const COMPONENT_DESCRIPTIONS = {
  "AddressSearchInput.js": "Mapbox address autocomplete input — used in add-listing and add-sub-lease forms",
  "ButtonAuth.js": "Sign in / sign out button using NextAuth",
  "Footer.js": "Site-wide footer",
  "GlobalListingModal.js": "Full-screen listing detail modal triggered from any listing card",
  "Header.js": "Top navigation bar with auth state, role-based links, and mobile menu",
  "HeartIcon.js": "Favorite/save toggle button for listings",
  "HeroMapPreview.js": "Landing page hero section with embedded map preview",
  "HeroSection.js": "Above-the-fold landing section with CTA",
  "MapView.js": "Main interactive Mapbox map — renders listing pins, popups, and clustering",
  "Modal.js": "Generic reusable modal wrapper",
  "ModalDorms.js": "Dorm detail modal with reviews",
  "ProfileCompletionModal.js": "Onboarding modal for new users to complete their profile",
  "Providers.js": "Root Next.js providers: SessionProvider, Toaster, etc.",
  "ReviewsSection.js": "Renders a list of reviews with ratings for a listing",
  "UniversityLogosCarousel.js": "Auto-scrolling carousel of university logos on the landing page",
  "chat/ChatContext.js": "React context providing chat state and actions",
  "chat/ChatWidget.js": "Floating chat widget UI using @chatscope/chat-ui-kit-react",
  "landlord-dashboard/leasing-funnel.js": "Recharts funnel chart showing click → save → contact conversion",
  "landlord-dashboard/market-comparisons.js": "Bar chart comparing landlord's listing metrics vs market average",
  "landlord-dashboard/trend-indicators.js": "Sparkline trend indicators for views/saves over time",
  "show-listings/AvailableListings.js": "Grid of listing cards for the browse page",
  "show-listings/BrowseContent.js": "Top-level browse page layout — filters + listings + map split view",
  "show-listings/FilterComponents.js": "Individual filter UI atoms (checkboxes, sliders, toggles)",
  "show-listings/ListingFilters.js": "Filter panel aggregating all filter components",
  "show-listings/ListingMap.js": "Map panel used inside the browse split view",
  "show-listings/ListingModalInfo.js": "Detail pane for a listing shown inside the global modal",
  "show-listings/MapPopupCard.js": "Small card shown in Mapbox popup when a pin is clicked",
  "show-listings/ModalListing.js": "Wrapper that opens GlobalListingModal for a given listing",
  "show-listings/TopFilterBar.js": "Sticky horizontal filter bar above the listings grid",
};

function generateComponents() {
  const componentsDir = join(ROOT, "src", "components");
  const files = [...walk(componentsDir, ".js"), ...walk(componentsDir, ".jsx")];

  const components = files.map((filepath) => {
    const rel = relative(ROOT, filepath);
    const key = rel.replace("src/components/", "");
    return {
      name: filepath.split("/").pop().replace(".js", ""),
      file: rel,
      description: COMPONENT_DESCRIPTIONS[key] ?? "No description — run generate after adding a description above.",
    };
  });

  write("components.json", {
    _description: "All React components in the Proximity app. Update COMPONENT_DESCRIPTIONS in generate-knowledge.mjs when adding new components.",
    _generated: new Date().toISOString(),
    count: components.length,
    components,
  });
}

// ── 4. Domain ─────────────────────────────────────────────────────────────────

function generateDomain() {
  const domain = {
    _description: "Core domain knowledge for the Proximity housing marketplace.",
    _generated: new Date().toISOString(),

    app: {
      name: "Proximity",
      purpose: "Off-campus housing marketplace for WashU (Washington University in St. Louis) students",
      url: "https://useproximity.org",
      deployment: "Vercel (Next.js serverless)",
    },

    techStack: {
      framework: "Next.js 15 (App Router)",
      language: "JavaScript (App Router in JS; a few TypeScript files — middleware.ts, src/lib/supabase/*.ts)",
      styling: "Tailwind CSS 3",
      auth: "NextAuth v5 (beta) — Google OAuth only, JWT strategy",
      db: "Supabase (PostgreSQL)",
      fileStorage: "AWS S3 + Cloudflare R2 (libs/r2.js)",
      maps: "Mapbox GL + Leaflet (geocoding + walk times); Google Street View Static API for default listing photos",
      email: "Nodemailer (SMTP)",
      ui: "Radix UI, Lucide React, Framer Motion, Recharts, @chatscope/chat-ui-kit-react",
      sourceLayout: "Monorepo: the Next.js app lives in apps/web (with packages/ for shared code and mcp/ for the knowledge server). Within apps/web, all app code is under src/ — src/app (App Router pages + api), src/components, src/lib, src/utils.",
    },

    roles: {
      student: {
        default: true,
        description: "Default role for all new sign-ups via Google OAuth",
        can: [
          "Browse and search listings",
          "Save/favorite listings",
          "Submit reviews",
          "Use matchmaking (roommate finding)",
          "Contact landlords",
          "Create sub-lease listings",
        ],
        cannot: ["Access /dashboard landlord metrics", "Manage listings"],
      },
      landlord: {
        description: "Property managers who list rentals",
        can: [
          "Create and manage listings",
          "View landlord metrics dashboard (views, saves, trends)",
          "Receive contact emails from students",
        ],
        cannot: ["Access admin panel"],
      },
      super: {
        description: "Platform admins — full access",
        can: [
          "All student + landlord capabilities",
          "Access /api/admin/* routes (CRUD on any table, view any user)",
          "Toggle dev/prod database target via x-db-target header",
          "Approve/reject reviews (set legitimacy flag)",
          "Run bulk operations (update walk times)",
        ],
      },
    },

    auth: {
      provider: "Google OAuth via NextAuth v5",
      sessionStrategy: "JWT",
      sessionShape: {
        "session.user.id": "UUID from Supabase users table",
        "session.user.email": "Google email",
        "session.user.role": "'student' | 'landlord' | 'super'",
        "session.user.profileComplete": "boolean — gates profile completion modal",
        "session.user.name": "Display name",
      },
      authGuardPattern: "const session = await auth(); if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });",
      superGuardPattern: "if (!session || session.user.role !== 'super') return Response.json({ error: 'Forbidden' }, { status: 403 });",
      importLine: "import { auth } from '@/auth';",
    },

    dbAccess: {
      supabaseImport: "import supabase from '@/lib/supabase';",
      supabaseTargetedImport: "import { getSupabaseClient } from '@/lib/supabase'; // use for admin routes that need prod/dev toggle",
      note: "Default client targets dev/prod by NODE_ENV. There are two Supabase projects (dev + prod); schema migrations must be applied to BOTH (supabase-dev and supabase-prod MCP).",
    },

    // ── Process / working agreement ───────────────────────────────────────────
    workflow: {
      branchAndPr: [
        "For every fix or feature, create a branch off `staging` (e.g. `feat/...` or `fix/...`).",
        "Implement the change on that branch.",
        "Give the user a test plan and WAIT for approval — do not push before the user approves.",
        "After approval, push the branch and open a PR into `staging`.",
      ],
      knowledgeMaintenance:
        "Whenever there is a substantial architectural change — a new/removed/changed API route, component, page, util, env var, DB schema change, or convention — update this MCP's knowledge so it stays accurate. Either call the `update-knowledge` tool for the specific entry (and `log-task` for notable decisions), or re-run `node mcp/scripts/generate-knowledge.mjs` to rescan the codebase. Knowledge files in mcp/knowledge/ are COMMITTED to git (shared across machines and agents) — commit regenerated knowledge together with the code change. A CI workflow (update-knowledge.yml) also regenerates and commits any drift after pushes to staging/main, covering contributors who don't run the MCP.",
      commitStyle:
        "Do NOT add AI/Claude attribution to commit messages or PR descriptions — no 'Co-Authored-By: Claude' trailer and no 'Generated with Claude Code' footer. Write them as a normal human contributor would.",
    },

    keyWorkflows: {
      createListing: [
        "POST /api/addListing with address, unitTypes[], and metadata",
        "Server geocodes address via Mapbox if lat/lng not provided",
        "Server calls fetchAllWalkTimes() from utils/walkTimes.js to calculate walk minutes to all WashU places + shuttle stops",
        "Insert row into listings table, then insert unit rows into listing_units",
        "DB triggers recompute aggregate columns (min/max rent, bedrooms, etc.) on listing_units change",
        "Email notification sent to landlord(s) via Nodemailer",
      ],
      imageUpload: [
        "Client requests a presigned S3 URL via POST /api/upload",
        "Client uploads the file directly to S3 using the presigned URL",
        "Client passes the returned S3 URL to addListing or editListing",
      ],
      walkTimes: [
        "utils/walkTimes.js exports fetchAllWalkTimes(lat, lng)",
        "Calls Mapbox Directions API for each WashU place in utils/washuPlaces.js (WASHU_PLACES + SHUTTLE_STOPS arrays)",
        "Returns { placeWalkMinutes: { placeName: minutes }, shuttleWalkMinutes: number }",
        "Stored as place_walk_minutes (jsonb) and shuttle_walk_minutes (numeric) on the listing row",
      ],
      userOnboarding: [
        "Google OAuth sign-in creates a new row in users table with role='student', profile_complete=false",
        "session.user.profileComplete=false triggers ProfileCompletionModal on the client",
        "User fills out profile → PATCH /api/editProfile → sets profile_complete=true",
      ],
    },

    conventions: {
      apiResponses: "Use Response.json() for all API responses. Use NextResponse.json() only when setting custom headers or redirects.",
      errorShape: "{ error: 'message string' } with appropriate HTTP status code",
      dbColumnNaming: "Supabase columns use snake_case (e.g. lease_type). JS layer converts to camelCase (e.g. leaseType) in buildListing().",
      envVars: {
        GOOGLE_ID: "Google OAuth client ID",
        GOOGLE_SECRET: "Google OAuth client secret",
        DEV_SUPABASE_URL: "Supabase project URL for dev",
        DEV_SUPABASE_SERVICE_KEY: "Supabase service role key for dev",
        PROD_SUPABASE_URL: "Supabase project URL for prod",
        PROD_SUPABASE_SERVICE_KEY: "Supabase service role key for prod",
        NEXT_PUBLIC_MAPBOX_TOKEN: "Mapbox public token (safe to expose to browser)",
        IMPORT_SECRET: "Shared secret to allow /api/addListing without session auth (used by import scripts)",
        EMAIL_HOST: "SMTP host for Nodemailer",
        EMAIL_PORT: "SMTP port",
        EMAIL_USER: "SMTP username",
        EMAIL_PASS: "SMTP password",
      },
    },
  };

  write("domain.json", domain);
}

// ── 5. Pages ──────────────────────────────────────────────────────────────────

function generatePages() {
  const appDir = join(ROOT, "src", "app");
  const pageFiles = walk(appDir, "page.js");

  const pages = pageFiles.map((filepath) => {
    const rel = relative(ROOT, filepath);
    // src/app/dashboard/landlord/page.js → /dashboard/landlord ; src/app/page.js → /
    const path =
      rel.replace(/^src\/app/, "").replace(/\/page\.js$/, "").replace(/\\/g, "/") || "/";
    return { path, file: rel };
  });
  pages.sort((a, b) => a.path.localeCompare(b.path));

  write("pages.json", {
    _description: "All Next.js page routes (non-API): URL path and file location.",
    _generated: new Date().toISOString(),
    count: pages.length,
    pages,
  });
}

// ── 6. Utils & libs ─────────────────────────────────────────────────────────

function generateUtils() {
  const dirs = [join(ROOT, "src", "lib"), join(ROOT, "src", "utils")];
  const files = dirs.flatMap((d) => (existsSync(d) ? walk(d, ".js") : []));

  const utils = files.map((filepath) => {
    const rel = relative(ROOT, filepath);
    // Use the file's top-of-file block comment (if any) as the description.
    const content = readFile(filepath);
    const block = content.match(/\/\*+([\s\S]*?)\*\//);
    const description = block
      ? block[1].replace(/^\s*\*?/gm, "").trim().split("\n")[0].trim()
      : "No description — add a top-of-file comment.";
    return { file: rel, description };
  });
  utils.sort((a, b) => a.file.localeCompare(b.file));

  write("utils.json", {
    _description: "All files in src/lib and src/utils: path + first line of their file header comment.",
    _generated: new Date().toISOString(),
    count: utils.length,
    utils,
  });
}

// ── 7. Env vars ───────────────────────────────────────────────────────────────

function generateEnvVars() {
  const srcDir = join(ROOT, "src");
  const files = [...walk(srcDir, ".js"), ...walk(srcDir, ".jsx")];
  const names = new Set();
  for (const f of files) {
    for (const m of readFile(f).matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      names.add(m[1]);
    }
  }
  const envVars = [...names].sort().map((name) => ({
    name,
    public: name.startsWith("NEXT_PUBLIC_"),
  }));

  write("env-vars.json", {
    _description: "Environment variables referenced via process.env in src/. `public` = exposed to the browser (NEXT_PUBLIC_ prefix).",
    _generated: new Date().toISOString(),
    count: envVars.length,
    envVars,
  });
}

// ── 8. Living logs (seed only — never clobber existing) ───────────────────────

function seedLivingLogs() {
  const seeds = {
    "active-tasks.json": {
      _description: "Living log of in-progress tasks, architectural decisions, known bugs, and ongoing migrations. Updated via the log-task tool.",
      tasks: [],
      decisions: [],
      bugs: [],
      migrations: [],
    },
    "agent-sessions.json": {
      _description: "Live log of spawned agent swarms. Updated via spawn-agents / log-agent-step tools.",
      sessions: [],
    },
  };
  for (const [filename, seed] of Object.entries(seeds)) {
    const path = join(OUT, filename);
    if (existsSync(path)) {
      console.log(`• ${filename} (kept existing)`);
      continue;
    }
    write(filename, seed);
  }
}

// ── Run all ───────────────────────────────────────────────────────────────────

console.log("Generating Proximity knowledge files...\n");
generateApiRoutes();
generateDbSchema();
generateComponents();
generateDomain();
generatePages();
generateUtils();
generateEnvVars();
seedLivingLogs();
console.log("\nDone. Files written to mcp/knowledge/");
