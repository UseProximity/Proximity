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

// Fetch rows for a table. For `users`, resolve role_id -> a readable `role`
// column and optionally filter by role name (e.g. only students / landlords).
async function fetchTableRows(supabase, table, { roleFilter, roleNameById }) {
  const usingRoleFilter = table === "users" && Array.isArray(roleFilter) && roleFilter.length > 0;

  let ids = null;
  if (usingRoleFilter && roleNameById) {
    ids = Object.entries(roleNameById)
      .filter(([, name]) => roleFilter.includes(name))
      .map(([id]) => id);
    // Filter requested but no matching roles -> no rows.
    if (ids.length === 0) return { rows: [] };
  }

  let query = supabase.from(table).select("*").limit(50000);
  if (ids) query = query.in("role_id", ids);

  const { data, error } = await query;
  if (error) return { error };

  let rows = Array.isArray(data) ? data : [];
  if (table === "users" && roleNameById) {
    rows = rows.map((r) => ({ ...r, role: roleNameById[r.role_id] ?? null }));
  }
  return { rows };
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

  const format = body?.format === "csv" ? "csv" : "xlsx";
  const roleFilter = Array.isArray(body?.roleFilter) ? body.roleFilter.filter(Boolean) : [];

  const dbTarget = getDbTarget(req);
  const allowed = await fetchAllowedTables(dbTarget);
  if (!allowed) return Response.json({ error: "Failed to fetch table list" }, { status: 500 });

  const requested = tables.filter((t) => allowed.includes(t));
  if (requested.length === 0) {
    return Response.json({ error: "No valid tables in request" }, { status: 400 });
  }

  // CSV is a single-table format (no zip bundling available).
  if (format === "csv" && requested.length > 1) {
    return Response.json(
      { error: "CSV export supports one table at a time. Select a single table, or use .xlsx for multiple." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseClient(dbTarget);

  // Resolve role_id -> readable role name for the users table.
  let roleNameById = null;
  if (requested.includes("users")) {
    const { data: roles } = await supabase.from("roles").select("id, name");
    roleNameById = Object.fromEntries((roles || []).map((r) => [r.id, r.name]));
  }

  const date = new Date().toISOString().slice(0, 10);
  const envTag = dbTarget || (process.env.NODE_ENV === "production" ? "prod" : "dev");

  if (format === "csv") {
    const table = requested[0];
    const { rows, error } = await fetchTableRows(supabase, table, { roleFilter, roleNameById });
    if (error) {
      console.error(`[admin export] table=${table}`, error);
      return Response.json({ error: `${table}: ${error.message}` }, { status: 500 });
    }
    const ws = rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([["(empty)"]]);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const filename = `proximity-${envTag}-${table}-${date}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  for (const table of requested) {
    const { rows, error } = await fetchTableRows(supabase, table, { roleFilter, roleNameById });
    if (error) {
      console.error(`[admin export] table=${table}`, error);
      return Response.json({ error: `${table}: ${error.message}` }, { status: 500 });
    }
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
