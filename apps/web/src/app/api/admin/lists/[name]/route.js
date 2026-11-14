/*
 * /api/admin/lists/[name]: the admin dashboard's plain lists, defined in
 * lib/admin/lists.js (reports and flags, email suppressions, import and sync
 * health, billing history, student activity, PMS, activity log, scheduled jobs).
 *
 *   GET                  { title, note, columns, rows, filters, canAct }
 *   POST { action, id }  run one of the list's actions on a row (super only)
 *
 * Reads follow the dashboard's dev/prod switch. Lists marked superOnly (billing)
 * are refused for the read-only admin role.
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";

import { requireDbRole, hasDbRole } from "@/lib/userRole";
import { adminDb, missingTable } from "@/lib/admin/adminDb";
import { LISTS } from "@/lib/admin/lists";

async function context(req, params, roles) {
  const session = await requireDbRole(roles);
  if (!session) return { res: Response.json({ error: "Forbidden" }, { status: 403 }) };
  const { name } = await params;
  const list = Object.hasOwn(LISTS, name) ? LISTS[name] : null;
  if (!list) return { res: Response.json({ error: "Not found" }, { status: 404 }) };
  const isSuper = await hasDbRole(session.user.id, ["super"]);
  if (list.superOnly && !isSuper) return { res: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return { list, name, isSuper, ...adminDb(req) };
}

export async function GET(req, { params }) {
  const c = await context(req, params, ["super", "admin"]);
  if (c.res) return c.res;
  const head = {
    title: c.list.title,
    note: c.list.note ?? null,
    columns: c.list.columns.map(([key, label]) => ({ key, label })),
    actions: Object.fromEntries(Object.entries(c.list.actions ?? {}).map(([key, a]) => [key, { label: a.label, confirm: a.confirm ?? null, ownOnly: !!a.ownOnly }])),
    canAct: c.isSuper,
    ownDatabase: c.writable,
  };
  try {
    const out = await c.list.load(c.db);
    return Response.json({ ...head, rows: out.rows ?? [], filters: out.filters ?? [], defaultFilter: out.defaultFilter ?? null, summary: out.summary ?? null });
  } catch (err) {
    // A table that has not reached this database yet reads as an empty list.
    if (missingTable(err)) return Response.json({ ...head, rows: [], filters: [], unavailable: true });
    console.error(`GET admin/lists/${c.name} failed:`, err);
    return Response.json({ error: "Could not load this list" }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  const c = await context(req, params, ["super"]);
  if (c.res) return c.res;
  const body = await req.json().catch(() => ({}));
  const action = Object.hasOwn(c.list.actions ?? {}, body?.action) ? c.list.actions[body.action] : null;
  if (!action || typeof body?.id !== "string" || !body.id || body.id.length > 320) return Response.json({ error: "Unknown action" }, { status: 400 });
  if (action.ownOnly && !c.writable) return Response.json({ error: "This can only be done on the site that owns this database." }, { status: 409 });
  try {
    const changed = await action.run(c.db, body.id);
    if (Array.isArray(changed) && changed.length === 0) return Response.json({ error: "That row is gone." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`POST admin/lists/${c.name} failed:`, err);
    return Response.json({ error: "Could not do that" }, { status: 500 });
  }
}
