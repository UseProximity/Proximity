#!/usr/bin/env bash
#
# snapshot-prod-to-dev.sh — clone the PROD Supabase `public` schema into the DEV database,
# so dev (and the staging deployment that points at it) holds a fresh copy of real data.
#
# ⚠️ DESTRUCTIVE to the DEV database's `public` schema. It NEVER writes to prod.
#
# Steps: [1] dump prod (+ capture its FK set)  [2] restore into dev  [3] re-grant Supabase roles
#        [4] reconcile FKs against prod, then verify parity or abort.
# Step 4 exists because the tolerant restore in step 2 can silently lose foreign keys, which
# breaks PostgREST embeds with PGRST200 → HTTP 500. See the comment on step 4 for the mechanism.
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

# Local runs read connection strings from .env.snapshot.local; CI (GitHub Actions) passes
# PROD_DB_URL / DEV_DB_URL via env from repo secrets, so the file is optional.
if [[ -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a; fi

: "${PROD_DB_URL:?ABORT: set PROD_DB_URL (in .env.snapshot.local or the environment)}"
: "${DEV_DB_URL:?ABORT: set DEV_DB_URL (in .env.snapshot.local or the environment)}"

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
FKS="$(mktemp -t prox-prod-fks-XXXXXX.tsv)"
FKSQL="$(mktemp -t prox-prod-fks-XXXXXX.sql)"
trap 'rm -f "$DUMP" "$DUMP.err" "$FKS" "$FKSQL"' EXIT

echo "[1/4] Dumping PROD public schema → $DUMP"
# --clean --if-exists: dump includes DROPs so the restore replaces existing objects.
# --no-owner --no-privileges: skip role/grant statements (roles differ across projects).
pg_dump "$PROD_DB_URL" \
  --schema=public --no-owner --no-privileges --clean --if-exists \
  --file="$DUMP"

# Capture prod's foreign keys separately so step [4/4] can reconcile them. The dump *does*
# contain these, but the tolerant restore below can silently drop them (see step 4's note),
# and PostgREST builds its embedded-resource graph from FKs — a missing one turns every
# nested select into a PGRST200 / HTTP 500.
FK_SELECT="
  from pg_constraint c
  join pg_class t     on t.oid  = c.conrelid
  join pg_namespace n on n.oid  = t.relnamespace
  where c.contype = 'f' and n.nspname = 'public'
  order by t.relname, c.conname"

# (a) tab-separated table/constraint/definition — drives the parity check at the end.
psql "$PROD_DB_URL" -t -A -F$'\t' --no-psqlrc -v ON_ERROR_STOP=1 -o "$FKS" \
  -c "select t.relname, c.conname, pg_get_constraintdef(c.oid) $FK_SELECT;"

# (b) the same rows as INSERT statements. Built server-side with format(%L) so identifiers and
# definitions are escaped correctly, and so step 4 can run one self-contained SQL file —
# \copy does not interpolate psql variables, so a file path cannot be passed into the session.
psql "$PROD_DB_URL" -t -A --no-psqlrc -v ON_ERROR_STOP=1 -o "$FKSQL" \
  -c "select format('insert into _prod_fks values (%L,%L,%L);',
                    t.relname, c.conname, pg_get_constraintdef(c.oid)) $FK_SELECT;"

echo "    prod foreign keys captured: $(grep -c . "$FKS" 2>/dev/null || echo 0)"

echo "[2/4] Restoring into DEV (destructive)…"
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

echo "[3/4] Re-granting Supabase role privileges + stamping snapshot date…"
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

echo "[4/4] Reconciling foreign keys against PROD…"
# WHY THIS EXISTS: the restore above is deliberately tolerant (`|| true`), because prod's schema
# references Supabase system schemas dev lacks. But that tolerance also hides a real failure mode:
# any table that exists ONLY in dev (e.g. chat_access_tokens) is absent from the prod dump, so the
# dump has no DROP for it — yet it holds FKs into `users`/`listings`. Postgres then refuses the
# dump's `DROP TABLE public.users` ("other objects depend on it"), and every dependent statement
# after it — including the `ADD CONSTRAINT ... FOREIGN KEY` block pg_dump emits last — fails and
# is swallowed. The result is a dev DB that looks fine but has lost inbound FKs, which breaks
# PostgREST embeds with PGRST200 and 500s the app (browse, admin dashboard).
#
# So: diff prod's FK set against dev's and re-add whatever is missing. Each is tried VALID first
# (full enforcement); if pre-existing orphan rows block validation we fall back to NOT VALID,
# which still registers the relationship for PostgREST and still enforces new writes.
RECONCILE="$(mktemp -t prox-fk-reconcile-XXXXXX.sql)"
{
  echo 'create temp table _prod_fks (relname text, conname text, def text);'
  cat "$FKSQL"
  cat <<'SQL'
do $$
declare
  r        record;
  added    int := 0;
  notvalid int := 0;
  failed   int := 0;
begin
  for r in
    select p.relname, p.conname, p.def
    from _prod_fks p
    where not exists (
      select 1
      from pg_constraint c
      join pg_class t      on t.oid = c.conrelid
      join pg_namespace ns on ns.oid = t.relnamespace
      where ns.nspname = 'public'
        and c.contype  = 'f'
        and t.relname  = p.relname
        and c.conname  = p.conname
    )
    order by p.relname, p.conname
  loop
    begin
      execute format('alter table public.%I add constraint %I %s',
                     r.relname, r.conname, r.def);
      added := added + 1;
      raise notice 'restored % on %', r.conname, r.relname;
    exception
      when foreign_key_violation then
        -- Orphans accumulated while the FK was missing; register it unvalidated.
        begin
          execute format('alter table public.%I add constraint %I %s not valid',
                         r.relname, r.conname, r.def);
          notvalid := notvalid + 1;
          raise notice 'restored % on % (NOT VALID — orphan rows present)', r.conname, r.relname;
        exception when others then
          failed := failed + 1;
          raise warning 'could not restore % on %: %', r.conname, r.relname, sqlerrm;
        end;
      when others then
        failed := failed + 1;
        raise warning 'could not restore % on %: %', r.conname, r.relname, sqlerrm;
    end;
  end loop;

  raise notice 'foreign keys — % restored, % restored NOT VALID, % failed',
    added, notvalid, failed;
end $$;

notify pgrst, 'reload schema';
SQL
} > "$RECONCILE"
psql "$DEV_DB_URL" -q --no-psqlrc -v ON_ERROR_STOP=1 -f "$RECONCILE"
rm -f "$RECONCILE"

# Fail loudly if dev still does not match prod — a snapshot that silently loses FKs is the exact
# bug this step exists to prevent, so it must not pass quietly.
PROD_KEYS="$(mktemp -t prox-fk-prod-XXXXXX)"
DEV_KEYS="$(mktemp -t prox-fk-dev-XXXXXX)"
MISSING_KEYS="$(mktemp -t prox-fk-missing-XXXXXX)"
trap 'rm -f "$DUMP" "$DUMP.err" "$FKS" "$FKSQL" "$PROD_KEYS" "$DEV_KEYS" "$MISSING_KEYS"' EXIT

cut -f1,2 "$FKS" | sort > "$PROD_KEYS"
psql "$DEV_DB_URL" -t -A -F$'\t' --no-psqlrc -v ON_ERROR_STOP=1 -c "
  select t.relname, c.conname
  from pg_constraint c
  join pg_class t     on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where c.contype = 'f' and n.nspname = 'public';" | sort > "$DEV_KEYS"
comm -23 "$PROD_KEYS" "$DEV_KEYS" > "$MISSING_KEYS"

if [[ -s "$MISSING_KEYS" ]]; then
  echo
  echo "✗ ABORT: $(grep -c . "$MISSING_KEYS") prod foreign key(s) still missing on DEV after reconciliation:"
  sed 's/^/    /' "$MISSING_KEYS"
  echo "  PostgREST embeds across these relations will fail with PGRST200 (HTTP 500)."
  exit 1
fi
echo "    foreign key parity with PROD verified ($(grep -c . "$PROD_KEYS") constraints)"

echo "✓ Done. DEV mirrors PROD; role grants re-applied; FKs reconciled; snapshot_taken_at stamped."
