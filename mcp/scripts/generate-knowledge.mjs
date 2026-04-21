/**
 * generate-knowledge.mjs
 *
 * Scans the Proximity codebase and writes structured JSON knowledge files
 * to mcp/knowledge/. Run this whenever the codebase changes significantly.
 *
 * Usage:
 *   cd mcp && node scripts/generate-knowledge.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", ".."); // repo root
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
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✓ ${filename}`);
}

// ── 1. API Routes ─────────────────────────────────────────────────────────────

function inferRouteDetails(routePath, content) {
  const relPath = relative(ROOT, routePath);

  // Extract HTTP methods defined in the file
  const methods = [];
  if (/export async function GET/.test(content)) methods.push("GET");
  if (/export async function POST/.test(content)) methods.push("POST");
  if (/export async function PUT/.test(content)) methods.push("PUT");
  if (/export async function PATCH/.test(content)) methods.push("PATCH");
  if (/export async function DELETE/.test(content)) methods.push("DELETE");

  // Detect auth level
  let auth = "public";
  if (/requireSuper\(\)/.test(content) || /role !== ["']super["']/.test(content)) {
    auth = "super";
  } else if (/await auth\(\)/.test(content)) {
    if (/role.*landlord/.test(content)) {
      auth = "landlord+";
    } else {
      auth = "any";
    }
  }

  // Detect Supabase tables accessed
  const tableMatches = [...content.matchAll(/\.from\(["']([a-z_]+)["']\)/g)];
  const tables = [...new Set(tableMatches.map((m) => m[1]))];

  // Derive URL path from filesystem path
  // e.g. app/api/favorites/[listingId]/route.js → /api/favorites/[listingId]
  const urlPath = relPath
    .replace(/^app/, "")
    .replace(/\/route\.js$/, "")
    .replace(/\\/g, "/");

  return { path: urlPath, methods, auth, tables, file: relPath };
}

function generateApiRoutes() {
  const apiDir = join(ROOT, "app", "api");
  const routeFiles = walk(apiDir, "route.js");

  const routes = routeFiles.map((filepath) => {
    const content = readFile(filepath);
    return inferRouteDetails(filepath, content);
  });

  // Sort by path
  routes.sort((a, b) => a.path.localeCompare(b.path));

  write("api-routes.json", {
    _description:
      "All Next.js API routes. auth: public=no auth, any=any signed-in user, landlord+=landlord or super, super=super admin only.",
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
  const componentsDir = join(ROOT, "components");
  const files = walk(componentsDir, ".js");

  const components = files.map((filepath) => {
    const rel = relative(ROOT, filepath);
    const key = rel.replace("components/", "");
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
      language: "JavaScript (no TypeScript in src — only middleware.ts)",
      styling: "Tailwind CSS 3",
      auth: "NextAuth v5 (beta) — Google OAuth only, JWT strategy",
      db: "Supabase (PostgreSQL)",
      fileStorage: "AWS S3 + Cloudflare R2 (libs/r2.js)",
      maps: "Mapbox GL + Leaflet",
      email: "Nodemailer (SMTP)",
      ui: "Radix UI, Lucide React, Framer Motion, Recharts, @chatscope/chat-ui-kit-react",
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
      supabaseImport: "import supabase from '@/libs/supabase';",
      supabaseTargetedImport: "import { getSupabaseClient } from '@/libs/supabase'; // use for admin routes that need prod/dev toggle",
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

// ── Run all ───────────────────────────────────────────────────────────────────

console.log("Generating Proximity knowledge files...\n");
generateApiRoutes();
generateDbSchema();
generateComponents();
generateDomain();
console.log("\nDone. Files written to mcp/knowledge/");
