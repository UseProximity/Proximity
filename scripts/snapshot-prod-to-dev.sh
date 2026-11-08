#!/usr/bin/env bash
#
# snapshot-prod-to-dev.sh — clone the PROD Supabase `public` schema into the DEV database,
# so dev (and the staging deployment that points at it) holds a fresh copy of real data.
#
# ⚠️ DESTRUCTIVE to the DEV database's `public` schema. It NEVER writes to prod.
#
# Steps: [1] dump prod (+ capture its FK set and function grants)  [2] save partner sandbox data,
#        then detach FKs from dev-only tables into prod tables  [3] restore into dev, then verify
#        every prod table holds exactly the dumped rows or abort  [4] re-grant Supabase roles, then
#        copy prod's function grants and verify no definer function is left public or abort
#        [5] reconcile FKs against prod, then verify parity or abort
#        [6] put partner sandbox data back, then reattach the dev-only FKs.
# Steps 2 and 6 keep dev-only partner accounts (snapshot_preserve.protected_users) and everything
# they created alive across the wipe, and keep dev-only tables (features migrated on dev first)
# from blocking the restore. See scripts/snapshot-preserve.sql.
# Step 5 exists because the tolerant restore in step 3 can silently lose foreign keys, which
# breaks PostgREST embeds with PGRST200 → HTTP 500. See the comment on step 5 for the mechanism.
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
FNACL="$(mktemp -t prox-prod-fn-grants-XXXXXX.sql)"
TMPFILES=("$DUMP" "$DUMP.err" "$DUMP.counts" "$FKS" "$FKSQL" "$FNACL")

# If the run dies after step 2 detached the dev-only FKs, put them back on the way out so dev-only
# features keep their PostgREST embeds until the next run. Best effort: whatever cannot go back
# stays in snapshot_preserve.detached_fks and the next run retries it.
FKS_DETACHED=0
# Step 4 opens every function to anon/authenticated and only locks them back down after the
# Stripe/Documenso scrub. If anything in between fails, the lockdown must still run, or dev
# (which staging, previews and the partner sandbox use, with the public staging anon key) is
# left with SECURITY DEFINER functions anyone can call (review of 2026-11-07).
GRANTS_OPENED=0
lock_down_functions() {
  [[ -s "$FNACL" ]] && psql "$DEV_DB_URL" -q --no-psqlrc -f "$FNACL" >/dev/null 2>&1
  psql "$DEV_DB_URL" -q --no-psqlrc -v ON_ERROR_STOP=1 \
    -f "$REPO_ROOT/supabase/migrations/202610220004_lock_down_definer_functions.sql" >/dev/null
}
open_definer_functions() {
  psql "$DEV_DB_URL" -t -A --no-psqlrc -v ON_ERROR_STOP=1 -c "
    select string_agg(p.oid::regprocedure::text, ', ')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
      and p.proname not in ('fn_current_user_role', 'fn_is_chat_participant')
      and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'));"
}
cleanup() {
  local code=$?
  if [[ $code -ne 0 && $GRANTS_OPENED -eq 1 ]]; then
    echo "    run failed after function grants were opened; locking definer functions back down…"
    if lock_down_functions && [[ -z "$(open_definer_functions)" ]]; then
      echo "    definer functions locked down"
    else
      # A failed workflow run emails the team; this line makes the reason plain in the log.
      echo "::error::SNAPSHOT LEFT DEV EXPOSED: SECURITY DEFINER functions may be callable with the anon key. Run supabase/migrations/202610220004_lock_down_definer_functions.sql on dev now."
    fi
  fi
  if [[ $code -ne 0 && $FKS_DETACHED -eq 1 ]]; then
    echo "    run failed; putting the detached dev-only foreign keys back…"
    psql "$DEV_DB_URL" -t -A --no-psqlrc -c "select * from snapshot_preserve.reattach_dev_only_fks();" \
      >/dev/null 2>&1 \
      && psql "$DEV_DB_URL" -q --no-psqlrc -c "notify pgrst, 'reload schema';" >/dev/null 2>&1 \
      || echo "    could not reattach them all; the next run will retry"
  fi
  rm -f "${TMPFILES[@]}"
}
trap cleanup EXIT

echo "[1/6] Dumping PROD public schema → $DUMP"
# --clean --if-exists: dump includes DROPs so the restore replaces existing objects.
# --no-owner --no-privileges: skip role/grant statements (roles differ across projects).
# --exclude-table-data=public.device_push_tokens: that table holds real users' Expo push tokens,
# which must never be copied from PROD into DEV (staging could push real people's phones). Only the
# rows are skipped; the table, indexes, FK and RLS are still dumped, so DEV keeps the table, empty.
pg_dump "$PROD_DB_URL" \
  --schema=public --no-owner --no-privileges --clean --if-exists \
  --exclude-table-data=public.device_push_tokens \
  --file="$DUMP"

# Capture prod's foreign keys separately so step [5/6] can reconcile them. The dump *does*
# contain these, but the tolerant restore below can silently drop them (see step 5's note),
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
# definitions are escaped correctly, and so step 5 can run one self-contained SQL file —
# \copy does not interpolate psql variables, so a file path cannot be passed into the session.
psql "$PROD_DB_URL" -t -A --no-psqlrc -v ON_ERROR_STOP=1 -o "$FKSQL" \
  -c "select format('insert into _prod_fks values (%L,%L,%L);',
                    t.relname, c.conname, pg_get_constraintdef(c.oid)) $FK_SELECT;"

echo "    prod foreign keys captured: $(grep -c . "$FKS" 2>/dev/null || echo 0)"

# Capture who may execute each prod function, as SQL that step 4 replays on dev. The dump uses
# --no-privileges, and step 4 has to re-grant routines wholesale, which would leave every
# SECURITY DEFINER function callable with the public anon key (they trust a caller-supplied
# p_user_id, so that means writing as any user). Each statement is a no-op if dev lacks the
# function. Extension-owned functions are skipped: their grants are not ours to manage.
psql "$PROD_DB_URL" -t -A --no-psqlrc -v ON_ERROR_STOP=1 -o "$FNACL" <<'SQL'
select format(
  'do $f$ begin if to_regprocedure(%L) is not null then '
  'revoke all on function %s from public, anon, authenticated; %s end if; end $f$;',
  sig, sig,
  coalesce((select string_agg(format('grant execute on function %s to %I;', sig, r), ' ')
              from unnest(array['anon', 'authenticated', 'service_role']) r
              where has_function_privilege(r, oid, 'execute')), ''))
from (
  select p.oid, p.oid::regprocedure::text as sig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
) f
order by sig;
SQL
echo "    prod function grants captured: $(grep -c . "$FNACL" 2>/dev/null || echo 0)"

echo "[2/6] Saving partner sandbox data (snapshot_preserve)…"
# Partner accounts live only in dev, so the restore below would wipe them. Install/refresh the
# snapshot_preserve schema, tell it which rows prod has (so it only saves rows created on dev), then
# save. Any failure here aborts BEFORE dev is touched, so partner data is never lost to a bad run.
psql "$DEV_DB_URL" -q --no-psqlrc -v ON_ERROR_STOP=1 -f "$REPO_ROOT/scripts/snapshot-preserve.sql" >/dev/null

# Built from PROD's catalog (not dev's), because dev has tables prod lacks. One SELECT per table
# that an FK points at, yielding (table, key-as-json) for every prod row.
PROD_KEYS_SQL="$(psql "$PROD_DB_URL" -t -A --no-psqlrc -v ON_ERROR_STOP=1 -c "
  select coalesce(string_agg(q, ' union all '), 'select null::text, null::text where false')
  from (
    select distinct format('select %L, jsonb_build_object(%s)::text from public.%I',
             pt.relname,
             (select string_agg(format('%L, %I', a.attname, a.attname), ', ' order by k.ord)
                from unnest(c.confkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum),
             pt.relname) as q
    from pg_constraint c
    join pg_class pt     on pt.oid = c.confrelid
    join pg_namespace pn on pn.oid = pt.relnamespace
    join pg_class ct     on ct.oid = c.conrelid
    join pg_namespace cn on cn.oid = ct.relnamespace
    where c.contype = 'f' and pn.nspname = 'public' and cn.nspname = 'public'
      and pt.relname <> 'users'
  ) s;")"
psql "$DEV_DB_URL" -q --no-psqlrc -v ON_ERROR_STOP=1 -c "truncate snapshot_preserve.prod_keys"
psql "$PROD_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -c "copy ($PROD_KEYS_SQL) to stdout" \
  | psql "$DEV_DB_URL" -q --no-psqlrc -v ON_ERROR_STOP=1 \
      -c "copy snapshot_preserve.prod_keys (table_name, key) from stdin"
psql "$DEV_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -c "select * from snapshot_preserve.save();"

# Dev-only tables (features migrated on dev before prod) are not in the prod dump, so the restore
# never drops them, but their FKs into prod tables make Postgres refuse the dump's DROP TABLE for
# listings, users and friends. That failure is silent under the tolerant restore: the old dev
# tables survive, the COPY into them fails on duplicate keys, and dev keeps serving stale rows
# while the run reports success. So save and drop those FKs first; step 6 adds them back.
psql "$PROD_DB_URL" -t -A --no-psqlrc -v ON_ERROR_STOP=1 -c "
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p');" \
  | psql "$DEV_DB_URL" -q --no-psqlrc -v ON_ERROR_STOP=1 \
      -c "truncate snapshot_preserve.prod_tables" \
      -c "copy snapshot_preserve.prod_tables (relname) from stdin"
DETACHED=$(psql "$DEV_DB_URL" -t -A --no-psqlrc -v ON_ERROR_STOP=1 \
  -c "select snapshot_preserve.detach_dev_only_fks();")
FKS_DETACHED=1
echo "    detached $DETACHED foreign key(s) from dev-only tables (reattached in step 6)"

echo "[3/6] Restoring into DEV (destructive)…"
# Tolerant restore: prod's public schema references Supabase system schemas the dev project
# doesn't have (e.g. supabase_functions webhook triggers). We skip those errors rather than abort,
# because dev doesn't need them, and list them below so a new kind of error is visible in the log.
# The row count check that follows is what catches a restore that did not really happen.
ERRLOG="$DUMP.err"
psql "$DEV_DB_URL" -q -f "$DUMP" >/dev/null 2>"$ERRLOG" || true
echo "    restore finished, $(grep -c 'ERROR' "$ERRLOG" 2>/dev/null || echo 0) errors skipped:"
grep 'ERROR' "$ERRLOG" | sed -E 's/^psql:[^:]+:[0-9]+: //' | sort | uniq -c | sort -rn | head -25 \
  | sed 's/^/      /' || true

# Every table the dump carries data for must now hold exactly that many rows. A table the restore
# could not drop keeps its old rows (and its COPY fails), so its count will not match. Counts come
# from the dump itself, which is one consistent snapshot of prod, so live prod writes do not matter.
EXPECTED="$DUMP.counts"
awk '
  /^COPY public\./ { t = $2; sub(/^public\./, "", t); gsub(/"/, "", t); n = 0; inblk = 1; next }
  inblk && /^\\\.$/ { print t "\t" n; inblk = 0; next }
  inblk { n++ }
' "$DUMP" > "$EXPECTED"
MISMATCH=$({
  echo "create temp table _expected (relname text, n bigint);"
  echo "copy _expected from stdin;"
  cat "$EXPECTED"
  echo '\.'
  cat <<'SQL'
select e.relname, e.n, a.n
from _expected e
cross join lateral (
  select (xpath('/row/c/text()',
          query_to_xml(format('select count(*) as c from public.%I', e.relname), false, true, '')
         ))[1]::text::bigint as n
) a
where a.n is distinct from e.n
order by e.relname;
SQL
} | psql "$DEV_DB_URL" -q -t -A -F$'\t' --no-psqlrc -v ON_ERROR_STOP=1)
if [[ -n "$MISMATCH" ]]; then
  echo
  echo "✗ ABORT: these DEV tables do not match the PROD dump after the restore (table, prod rows, dev rows):"
  echo "$MISMATCH" | sed 's/^/    /'
  echo "  DEV was not refreshed. The errors above show what blocked it. If someone wrote to DEV"
  echo "  during the few minutes of the restore, re-running is enough."
  exit 1
fi
echo "    row counts match the PROD dump on all $(grep -c . "$EXPECTED") tables"

# Sanity check: a successful clone should have core tables populated.
USERS=$(psql "$DEV_DB_URL" -t -A -c "select count(*) from users" 2>/dev/null || echo 0)
if [[ "${USERS:-0}" -lt 1 ]]; then
  echo "ABORT: dev 'users' table is empty after restore — clone likely failed."; cat "$ERRLOG"; exit 1
fi
echo "    dev users restored: $USERS"

echo "[4/6] Re-granting Supabase role privileges + stamping snapshot date…"
# The dump used --no-privileges and --clean dropped the originals, so the PostgREST roles
# (anon/authenticated/service_role) lose table access after a restore — which makes the app's
# API return permission errors (500s). Re-grant Supabase's standard privileges, set default
# privileges for future objects, then reload the API schema cache.
GRANTS_OPENED=1
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

-- Prod holds live-mode Stripe ids. Dev and staging use sandbox keys, which reject them, so strip
-- every one (customer, payment method, invoice, invoice item, dispute, webhook event). Rows whose
-- Stripe id is the whole point (payment methods, disputes, events) are deleted rather than nulled.
-- This runs before step 6, so partner sandbox rows put back there keep their own sandbox ids.
-- Guarded per table so a snapshot still works before the billing migration reaches prod.
do $$
begin
  if to_regclass('public.charges') is not null then
    update public.charges set stripe_invoice_item_id = null where stripe_invoice_item_id is not null;
  end if;
  if to_regclass('public.billing_invoices') is not null then
    update public.billing_invoices
       set stripe_invoice_id = null, hosted_invoice_url = null, invoice_pdf_url = null
     where stripe_invoice_id is not null or hosted_invoice_url is not null or invoice_pdf_url is not null;
  end if;
  if to_regclass('public.billing_accounts') is not null then
    update public.billing_accounts set stripe_customer_id = null where stripe_customer_id is not null;
  end if;
  if to_regclass('public.billing_disputes') is not null then delete from public.billing_disputes; end if;
  -- Autopay points at payment methods with ON DELETE RESTRICT (202611050002), so its records go
  -- first, or deleting the methods fails and rolls back this whole scrub (review of 2026-11-07).
  if to_regclass('public.autopay_authorizations') is not null then delete from public.autopay_authorizations; end if;
  if to_regclass('public.billing_invoices') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'billing_invoices' and column_name = 'autopay_payment_method_id') then
    update public.billing_invoices set autopay_payment_method_id = null where autopay_payment_method_id is not null;
  end if;
  if to_regclass('public.payment_methods') is not null then delete from public.payment_methods; end if;
  if to_regclass('public.stripe_webhook_events') is not null then delete from public.stripe_webhook_events; end if;
  -- Documenso: every environment shares ONE Documenso team (Teams plan), only kept
  -- apart by folder and a [TEST] title prefix, and a team API key can act on any
  -- document in it. So no prod envelope id may survive here: dev code holding one
  -- could cancel a real landlord's copy. Agreement versions go back to drafts
  -- without a template (an admin reconnects one in dev to test signing), and a copy
  -- in progress, master or Exhibit A amendment, is voided. Signed documents keep
  -- their record; their PDFs live in prod's bucket.
  if to_regclass('public.agreement_versions') is not null then
    update public.landlord_agreements
       set status = 'voided', ended_reason = 'snapshot: prod Documenso copy', ended_at = now()
     where status in ('not_sent', 'sent') and provider_envelope_id is not null;
    update public.landlord_agreements set provider_envelope_id = null where provider_envelope_id is not null;
    if to_regclass('public.agreement_amendments') is not null then
      update public.agreement_amendments
         set status = 'voided', ended_reason = 'snapshot: prod Documenso copy', ended_at = now()
       where status in ('not_sent', 'sent') and provider_envelope_id is not null;
      update public.agreement_amendments set provider_envelope_id = null where provider_envelope_id is not null;
      if to_regclass('public.agreement_coverage') is not null then
        update public.agreement_coverage set status = 'released'
         where status = 'proposed'
           and amendment_id in (select id from public.agreement_amendments where ended_reason = 'snapshot: prod Documenso copy');
      end if;
    end if;
    update public.agreement_versions
       set provider_template_id = null, provider_recipient_id = null, provider_title_field_id = null,
           provider_editor_url = null, fields_checked_at = null,
           status = case when status = 'live' then 'retired' else status end
     where provider_template_id is not null or status = 'live';
    update public.agreement_versions set status = 'draft' where status = 'ready';
  end if;
end $$;

notify pgrst, 'reload schema';
SQL

# The blanket routine grant above reopened every function to anon and authenticated. Put back
# exactly what prod allows, then run the definer lockdown migration as a safety net for any
# dev-only function prod doesn't have.
psql "$DEV_DB_URL" -q --no-psqlrc -v ON_ERROR_STOP=1 -f "$FNACL" >/dev/null
psql "$DEV_DB_URL" -q --no-psqlrc -v ON_ERROR_STOP=1 \
  -f "$REPO_ROOT/supabase/migrations/202610220004_lock_down_definer_functions.sql" >/dev/null

# Verify: the only definer functions the public may call are the two RLS policies depend on
# (see that migration). Anything else means dev is exposed, so stop here, loudly.
OPEN_FNS=$(open_definer_functions)
if [[ -n "$OPEN_FNS" ]]; then
  echo "ABORT: these SECURITY DEFINER functions are still callable with the anon key on DEV: $OPEN_FNS"
  exit 1
fi
GRANTS_OPENED=0
echo "    function grants copied from prod; no definer function left public"

echo "[5/6] Reconciling foreign keys against PROD…"
# WHY THIS EXISTS: the restore above is deliberately tolerant (`|| true`), because prod's schema
# references Supabase system schemas dev lacks. But that tolerance also hides a real failure mode:
# any table that exists ONLY in dev (e.g. chat_access_tokens) is absent from the prod dump, so the
# dump has no DROP for it — yet it holds FKs into `users`/`listings`. Postgres then refuses the
# dump's `DROP TABLE public.users` ("other objects depend on it"), and every dependent statement
# after it — including the `ADD CONSTRAINT ... FOREIGN KEY` block pg_dump emits last — fails and
# is swallowed. The result is a dev DB that looks fine but has lost inbound FKs, which breaks
# PostgREST embeds with PGRST200 and 500s the app (browse, admin dashboard).
# Step 2 now detaches those dev-only FKs before the restore, and step 3's row count check aborts if
# a table still could not be replaced, so this step is a safety net for anything new.
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
TMPFILES+=("$PROD_KEYS" "$DEV_KEYS" "$MISSING_KEYS")

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

echo "[6/6] Putting partner sandbox data back…"
# Runs last so FKs are in place: rows that no longer fit (e.g. they point at something prod deleted)
# are reported as warnings and skipped rather than restored as orphans. The restore is one statement,
# so it gets a longer timeout than the database's 2 minute default; 15 minutes still fails a hung run.
psql "$DEV_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -c "set statement_timeout = '15min'" \
  -c "select * from snapshot_preserve.restore();"

# Put back the dev-only FKs detached in step 2. Last, so partner rows they point at are back first.
REATTACH=$(psql "$DEV_DB_URL" -t -A -F' ' --no-psqlrc -v ON_ERROR_STOP=1 \
  -c "select * from snapshot_preserve.reattach_dev_only_fks();")
read -r RE_OK RE_NV RE_BAD <<<"$REATTACH"
FKS_DETACHED=0
psql "$DEV_DB_URL" -q --no-psqlrc -v ON_ERROR_STOP=1 -c "notify pgrst, 'reload schema';"
echo "    dev-only foreign keys: $RE_OK reattached, $RE_NV reattached NOT VALID, $RE_BAD failed"
if [[ "${RE_BAD:-0}" -ne 0 ]]; then
  echo "✗ ABORT: $RE_BAD dev-only foreign key(s) could not be reattached; they are kept in"
  echo "  snapshot_preserve.detached_fks and the next run retries them."
  exit 1
fi

echo "✓ Done. DEV mirrors PROD (row counts verified); role grants re-applied; function grants match prod; FKs reconciled; partner data restored; dev-only FKs reattached; snapshot_taken_at stamped."
