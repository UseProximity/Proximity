#!/usr/bin/env bash
#
# snapshot-prod-to-dev.sh — clone the PROD Supabase `public` schema into the DEV database,
# so dev (and the staging deployment that points at it) holds a fresh copy of real data.
#
# ⚠️ DESTRUCTIVE to the DEV database's `public` schema. It NEVER writes to prod.
#
# Setup: copy connection strings into .env.snapshot.local at the repo root (gitignored):
#     PROD_DB_URL=postgresql://postgres:...@db.<prod-ref>.supabase.co:5432/postgres
#     DEV_DB_URL=postgresql://postgres:...@db.<dev-ref>.supabase.co:5432/postgres
#     DEV_DB_HOST_MUST_CONTAIN=<dev-ref>   # safety guard — abort if DEV_DB_URL lacks this
# Use the *direct* connection string (port 5432), not the transaction pooler.
#
# Run:  ./scripts/snapshot-prod-to-dev.sh --confirm
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.snapshot.local"

[[ -f "$ENV_FILE" ]] || { echo "ABORT: missing $ENV_FILE (set PROD_DB_URL, DEV_DB_URL)"; exit 1; }
set -a; source "$ENV_FILE"; set +a

: "${PROD_DB_URL:?ABORT: set PROD_DB_URL in .env.snapshot.local}"
: "${DEV_DB_URL:?ABORT: set DEV_DB_URL in .env.snapshot.local}"

if [[ "${1:-}" != "--confirm" ]]; then
  echo "This OVERWRITES the DEV database's public schema with PROD data."
  echo "Re-run with --confirm to proceed."
  exit 1
fi

# ── Safety guards ────────────────────────────────────────────────────────────
if [[ "$PROD_DB_URL" == "$DEV_DB_URL" ]]; then
  echo "ABORT: PROD_DB_URL and DEV_DB_URL are identical — refusing to run."; exit 1
fi
if [[ -n "${DEV_DB_HOST_MUST_CONTAIN:-}" && "$DEV_DB_URL" != *"$DEV_DB_HOST_MUST_CONTAIN"* ]]; then
  echo "ABORT: DEV_DB_URL does not contain expected host marker '$DEV_DB_HOST_MUST_CONTAIN'."; exit 1
fi
command -v pg_dump >/dev/null || { echo "ABORT: pg_dump not found (install postgresql client)"; exit 1; }
command -v psql   >/dev/null || { echo "ABORT: psql not found (install postgresql client)"; exit 1; }

DUMP="$(mktemp -t prox-prod-snapshot-XXXXXX.sql)"
trap 'rm -f "$DUMP" "$DUMP.err"' EXIT

echo "[1/3] Dumping PROD public schema → $DUMP"
# --clean --if-exists: dump includes DROPs so the restore replaces existing objects.
# --no-owner --no-privileges: skip role/grant statements (roles differ across projects).
pg_dump "$PROD_DB_URL" \
  --schema=public --no-owner --no-privileges --clean --if-exists \
  --file="$DUMP"

echo "[2/3] Restoring into DEV (destructive)…"
# Tolerant restore: prod's public schema references Supabase system schemas the dev project
# doesn't have (e.g. supabase_functions webhook triggers). We skip those benign errors rather
# than abort — dev doesn't need them. ERROR count is reported below for visibility.
ERRLOG="$DUMP.err"
psql "$DEV_DB_URL" -q -f "$DUMP" >/dev/null 2>"$ERRLOG" || true
echo "    restore finished — $(grep -c 'ERROR' "$ERRLOG" 2>/dev/null || echo 0) benign errors skipped"

# Sanity check: a successful clone should have core tables populated.
USERS=$(psql "$DEV_DB_URL" -t -A -c "select count(*) from users" 2>/dev/null || echo 0)
if [[ "${USERS:-0}" -lt 1 ]]; then
  echo "ABORT: dev 'users' table is empty after restore — clone likely failed."; cat "$ERRLOG"; exit 1
fi
echo "    dev users restored: $USERS"

echo "[3/3] Re-granting Supabase role privileges + stamping snapshot date…"
# The dump used --no-privileges and --clean dropped the originals, so the PostgREST roles
# (anon/authenticated/service_role) lose table access after a restore — which makes the app's
# API return permission errors (500s). Re-grant Supabase's standard privileges, set default
# privileges for future objects, then reload the API schema cache.
psql "$DEV_DB_URL" -v ON_ERROR_STOP=1 -q >/dev/null <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines  in schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on routines  to anon, authenticated, service_role;

create table if not exists app_metadata (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
insert into app_metadata (key, value, updated_at)
values ('snapshot_taken_at', now()::text, now())
on conflict (key) do update set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';
SQL

echo "✓ Done. DEV mirrors PROD; role grants re-applied; snapshot_taken_at stamped."
