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

function extractMongooseFields(content) {
  const fields = [];
  // Match field: { type: ..., required: ..., default: ... } patterns
  const fieldRegex = /(\w+):\s*\{[^}]*type:\s*([^,}]+)/g;
  let match;
  while ((match = fieldRegex.exec(content)) !== null) {
    const name = match[1].trim();
    if (["_id", "id"].includes(name)) continue;
    const type = match[2].trim().replace(/^mongoose\.Schema\.Types\./, "");
    fields.push({ name, type });
  }
  return fields;
}

function generateDbSchema() {
  const modelsDir = join(ROOT, "models");
  const modelFiles = walk(modelsDir, ".js");

  const mongooseModels = modelFiles.map((filepath) => {
    const content = readFile(filepath);
    const name = filepath.split("/").pop().replace(".js", "");
    const fields = extractMongooseFields(content);
    return { model: name, file: relative(ROOT, filepath), status: "legacy-mongodb", fields };
  });

  // Supabase tables derived from reading route files and libs/supabase.js
  // These are the known tables as of the current codebase state.
  // Run the admin /api/admin/schema route to get the live schema.
  const supabaseTables = [
    {
      table: "users",
      description: "Platform users — all roles stored here",
      columns: [
        { name: "id", type: "uuid", note: "primary key" },
        { name: "email", type: "text", note: "unique, from Google OAuth" },
        { name: "name", type: "text" },
        { name: "image", type: "text", note: "profile photo URL" },
        { name: "role", type: "text", note: "'student' | 'landlord' | 'super'" },
        { name: "profile_complete", type: "boolean", note: "gates dashboard access" },
        { name: "gender", type: "text" },
        { name: "phone", type: "text" },
        { name: "description", type: "text" },
        { name: "referral_source", type: "text" },
        { name: "created_at", type: "timestamptz" },
      ],
    },
    {
      table: "listings",
      description: "Rental property listings — core entity",
      columns: [
        { name: "id", type: "uuid", note: "primary key" },
        { name: "landlord_id", type: "uuid[]", note: "array — supports co-landlords" },
        { name: "title", type: "text", note: "nullable" },
        { name: "address", type: "text" },
        { name: "longitude", type: "numeric" },
        { name: "latitude", type: "numeric" },
        { name: "description", type: "text" },
        { name: "lease_type", type: "text", note: "e.g. 'standard'" },
        { name: "images", type: "text[]" },
        { name: "place_walk_minutes", type: "jsonb", note: "{ placeName: minutes } map" },
        { name: "shuttle_walk_minutes", type: "numeric" },
        { name: "contact_email", type: "text" },
        { name: "contact_phone", type: "text" },
        { name: "contact_name", type: "text" },
        { name: "lease_availability", type: "text[]", note: "'semester' | '10-month' | '12-month'" },
        { name: "lease_structure", type: "text", note: "'individual' | 'joint'" },
        { name: "home_type", type: "text", note: "'apartment' | 'house' | 'condo' | 'townhouse'" },
        { name: "furnished", type: "boolean" },
        { name: "move_in_date", type: "text" },
        { name: "utilities_included", type: "text[]", note: "water|sewer|trash|internet|electric|gas|hotWater|yardCare" },
        { name: "sublease_friendly", type: "boolean" },
        { name: "unavailable", type: "boolean" },
        { name: "amenities", type: "text[]" },
        { name: "min_rent", type: "numeric", note: "computed by DB trigger from listing_units" },
        { name: "max_rent", type: "numeric", note: "computed by DB trigger" },
        { name: "min_bedrooms", type: "int", note: "computed by DB trigger" },
        { name: "max_bedrooms", type: "int", note: "computed by DB trigger" },
        { name: "min_bathrooms", type: "numeric", note: "computed by DB trigger" },
        { name: "max_bathrooms", type: "numeric", note: "computed by DB trigger" },
        { name: "min_area", type: "numeric", note: "computed by DB trigger" },
        { name: "max_area", type: "numeric", note: "computed by DB trigger" },
        { name: "num_reviews", type: "int", note: "computed" },
        { name: "rating", type: "numeric", note: "computed, 0–5" },
        { name: "num_clicks", type: "int" },
        { name: "num_saves", type: "int" },
        { name: "created_at", type: "timestamptz" },
      ],
    },
    {
      table: "listing_units",
      description: "Individual unit types within a listing (bedrooms/bathrooms/rent variants)",
      columns: [
        { name: "id", type: "uuid" },
        { name: "listing_id", type: "uuid", note: "FK → listings.id" },
        { name: "bedrooms", type: "int" },
        { name: "bathrooms", type: "numeric" },
        { name: "rent", type: "numeric" },
        { name: "area", type: "numeric" },
        { name: "lease_availability", type: "text" },
      ],
    },
    {
      table: "reviews",
      description: "Listing reviews submitted by students",
      columns: [
        { name: "id", type: "uuid" },
        { name: "listing_id", type: "uuid", note: "FK → listings.id" },
        { name: "rating", type: "numeric", note: "1–5" },
        { name: "legitimacy", type: "boolean", note: "admin-verified flag; only legit reviews count toward rating" },
        { name: "created_at", type: "timestamptz" },
      ],
    },
    {
      table: "dorms",
      description: "University dorm catalog",
      columns: [
        { name: "id", type: "uuid" },
        { name: "name", type: "text" },
        { name: "description", type: "text" },
        { name: "tags", type: "text[]" },
      ],
    },
    {
      table: "dorm_reviews",
      description: "Student reviews for dorms",
      columns: [
        { name: "id", type: "uuid" },
        { name: "dorm_id", type: "uuid", note: "FK → dorms.id" },
        { name: "rating", type: "numeric" },
        { name: "created_at", type: "timestamptz" },
      ],
    },
    {
      table: "testimonials",
      description: "User testimonials shown on the landing page",
      columns: [
        { name: "id", type: "uuid" },
        { name: "content", type: "text" },
        { name: "created_at", type: "timestamptz" },
      ],
    },
  ];

  write("db-schema.json", {
    _description:
      "Database schema. Primary DB is Supabase (PostgreSQL). Mongoose models are legacy (MongoDB) and in migration.",
    _generated: new Date().toISOString(),
    supabase: {
      note: "Use libs/supabase.js (default export) for standard server-side queries. Use getSupabaseClient('prod'|'dev') to target a specific env.",
      tables: supabaseTables,
    },
    mongoose: {
      note: "Legacy. Two connection files: libs/mongoose.js (Mongoose) and libs/mongo.js (raw MongoClient for NextAuth adapter). Being migrated to Supabase.",
      models: mongooseModels,
    },
  });
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
      primaryDb: "Supabase (PostgreSQL)",
      legacyDb: "MongoDB via Mongoose (in migration to Supabase)",
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
          "Run bulk operations (migrate amenities, update walk times)",
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
      mongooseImport: "import dbConnect from '@/libs/mongoose';",
      note: "Prefer Supabase for all new code. Mongoose models are legacy and being migrated.",
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
