export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { getSupabaseClient } from "@/lib/supabase";
import * as XLSX from "xlsx";

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

async function requireSuperOrAdmin() {
  const session = await auth();
  if (!session || (session.user.role !== "super" && session.user.role !== "admin")) return null;
  return session;
}

function getSchemaCredentials(dbTarget) {
  const isProd = dbTarget === "prod" || (!dbTarget && process.env.NODE_ENV === "production");
  return {
    url: isProd ? process.env.PROD_SUPABASE_URL : process.env.DEV_SUPABASE_URL,
    key: isProd ? process.env.PROD_SUPABASE_SERVICE_KEY : process.env.DEV_SUPABASE_SERVICE_KEY,
  };
}

async function fetchAllowedTables(dbTarget) {
  const { url, key } = getSchemaCredentials(dbTarget);
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const spec = await res.json();
  return Object.keys(spec.definitions || {});
}

function safeSheetName(name) {
  // Excel sheet names: max 31 chars, no : \ / ? * [ ]
  return name.replace(/[:\\\/?*\[\]]/g, "_").slice(0, 31) || "sheet";
}

export async function POST(req) {
  const session = await requireSuperOrAdmin();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const tables = Array.isArray(body?.tables) ? body.tables : [];
  if (tables.length === 0) {
    return Response.json({ error: "tables array required" }, { status: 400 });
  }

  const dbTarget = getDbTarget(req);
  const allowed = await fetchAllowedTables(dbTarget);
  if (!allowed) return Response.json({ error: "Failed to fetch table list" }, { status: 500 });

  const requested = tables.filter((t) => allowed.includes(t));
  if (requested.length === 0) {
    return Response.json({ error: "No valid tables in request" }, { status: 400 });
  }

  const supabase = getSupabaseClient(dbTarget);
  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  for (const table of requested) {
    const { data, error } = await supabase.from(table).select("*").limit(50000);
    if (error) {
      console.error(`[admin export] table=${table}`, error);
      return Response.json({ error: `${table}: ${error.message}` }, { status: 500 });
    }
    const rows = Array.isArray(data) ? data : [];
    const ws = rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([["(empty)"]]);
    let name = safeSheetName(table);
    let suffix = 1;
    while (usedNames.has(name)) name = safeSheetName(`${table}_${++suffix}`);
    usedNames.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const date = new Date().toISOString().slice(0, 10);
  const envTag = dbTarget || (process.env.NODE_ENV === "production" ? "prod" : "dev");
  const filename = `proximity-${envTag}-${date}.xlsx`;

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
