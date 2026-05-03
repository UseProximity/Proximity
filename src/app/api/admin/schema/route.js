export const dynamic = "force-dynamic";

import { auth } from "@/auth";

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

function getCredentials(dbTarget) {
  const isProd = dbTarget === "prod" || (!dbTarget && process.env.NODE_ENV === "production");
  return {
    url: isProd ? process.env.PROD_SUPABASE_URL : process.env.DEV_SUPABASE_URL,
    key: isProd ? process.env.PROD_SUPABASE_SERVICE_KEY : process.env.DEV_SUPABASE_SERVICE_KEY,
  };
}

function inferType(colName, prop) {
  if (colName === "id") return "id";
  if (colName === "created_at" || colName === "updated_at") return "readonly";
  const type = prop.type || "";
  const format = prop.format || "";
  if (type === "boolean") return "boolean";
  if (type === "integer" || type === "number") return "number";
  if (type === "array") return "json";
  if (format.includes("json")) return "json";
  return "text";
}

function toLabel(colName) {
  return colName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET(req) {
  const session = await auth();
  if (!session || session.user.role !== "super") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { url, key } = getCredentials(getDbTarget(req));
  if (!url || !key) {
    return Response.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }

  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) {
      return Response.json({ error: `Supabase schema fetch failed: ${res.status}` }, { status: 500 });
    }

    const spec = await res.json();
    const definitions = spec.definitions || {};

    const schemas = {};
    for (const [tableName, def] of Object.entries(definitions)) {
      const props = def.properties || {};
      schemas[tableName] = Object.entries(props).map(([colName, prop]) => ({
        key: colName,
        label: toLabel(colName),
        type: inferType(colName, prop),
      }));
    }

    const tables = Object.keys(schemas).sort();
    return Response.json({ tables, schemas });
  } catch (err) {
    console.error("[admin/schema]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
