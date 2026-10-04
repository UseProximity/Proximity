-- snapshot-preserve.sql: keep partner sandbox data alive across the weekly prod -> dev snapshot.
--
-- Partners (e.g. the WashU UX club) get accounts that exist ONLY in the dev database, which the
-- snapshot overwrites every week. This file installs a small `snapshot_preserve` schema in DEV that
-- the snapshot never touches (it only dumps/restores `public`), plus two functions:
--
--   snapshot_preserve.save()     run BEFORE the restore. Starts from every protected user and walks
--                                the foreign-key graph to collect every row they created on dev,
--                                then stores those rows as JSON.
--   snapshot_preserve.restore()  run AFTER the restore (and FK reconciliation). Puts the saved rows
--                                back into `public`, skipping any that already exist.
--
-- Protect a new account:   insert into snapshot_preserve.protected_users (email, note)
--                          values ('someone@example.com', 'why');
--
-- What counts as "theirs": the protected user rows, every row that references something of theirs
-- (their listings' units, leases, photos, ...), and every row of theirs references that does NOT
-- exist in prod (e.g. a listing they created, reached through listing_landlords). Rows that exist in
-- prod are never saved: the snapshot brings back the prod version, so edits a partner makes to a
-- prod listing are not kept. Other `users` rows are never pulled in, so one partner's data cannot
-- drag in a staging tester's account.
--
-- The walk is driven by the live FK catalog, not a table list, so new tables are covered without
-- touching this file. Nothing in this schema has an FK into `public`; that matters, because a
-- dev-only FK into `public` blocks the snapshot's DROP TABLEs (see step [5/6] in the script).
--
-- Safe to re-run: everything is create-if-missing / create-or-replace.

set client_min_messages = warning;

create schema if not exists snapshot_preserve;

create table if not exists snapshot_preserve.protected_users (
  email    text primary key,
  note     text,
  added_at timestamptz not null default now()
);

-- Saved rows. `ident` is the row's primary key as JSON (the whole row when a table has none).
create table if not exists snapshot_preserve.saved_rows (
  table_name text  not null,
  ident      jsonb not null,
  row_data   jsonb not null,
  saved_at   timestamptz not null default now(),
  primary key (table_name, ident)
);

-- Keys of every prod row that dev rows can point at, loaded fresh by the script before save().
create table if not exists snapshot_preserve.prod_keys (
  table_name text  not null,
  key        jsonb not null
);
create index if not exists prod_keys_lookup on snapshot_preserve.prod_keys (table_name, key);

-- last_restore_ok guards the backup: if the previous restore did not finish, the next save() merges
-- into the old backup instead of replacing it, so a failed week never loses partner data.
create table if not exists snapshot_preserve.state (
  id              int primary key default 1 check (id = 1),
  last_save_at    timestamptz,
  last_restore_at timestamptz,
  last_restore_ok boolean not null default true
);
insert into snapshot_preserve.state (id) values (1) on conflict do nothing;

-- Every FK in `public`, one row per constraint, with its column names in matching order.
create or replace view snapshot_preserve.public_fks as
select c.oid                                  as conoid,
       ct.relname                             as child,
       pt.relname                             as parent,
       array(select a.attname from unnest(c.conkey) with ordinality k(attnum, ord)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
             order by k.ord)                  as child_cols,
       array(select a.attname from unnest(c.confkey) with ordinality k(attnum, ord)
             join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
             order by k.ord)                  as parent_cols
from pg_constraint c
join pg_class ct     on ct.oid = c.conrelid
join pg_class pt     on pt.oid = c.confrelid
join pg_namespace cn on cn.oid = ct.relnamespace
join pg_namespace pn on pn.oid = pt.relnamespace
where c.contype = 'f' and cn.nspname = 'public' and pn.nspname = 'public';

-- SQL expression for a row's identity: jsonb_build_object over its PK columns, or the whole row.
create or replace function snapshot_preserve.ident_expr(tbl text, alias text)
returns text language sql stable as $$
  select coalesce(
    (select 'jsonb_build_object(' ||
            string_agg(format('%L, %I.%I', a.attname, alias, a.attname), ', ' order by k.ord) || ')'
     from pg_index i
     join pg_class t     on t.oid = i.indrelid
     join pg_namespace n on n.oid = t.relnamespace
     cross join unnest(i.indkey) with ordinality k(attnum, ord)
     join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
     where i.indisprimary and n.nspname = 'public' and t.relname = tbl),
    format('to_jsonb(%I)', alias));
$$;

-- "a.col1 = b->'col1' and ..." comparing real columns against JSON fields, type-agnostic.
create or replace function snapshot_preserve.match_expr(
  col_alias text, cols text[], json_ref text, json_cols text[])
returns text language sql immutable as $$
  select string_agg(format('to_jsonb(%I.%I) = %s->%L', col_alias, cols[i], json_ref, json_cols[i]),
                    ' and ')
  from generate_subscripts(cols, 1) i;
$$;

create or replace function snapshot_preserve.save()
returns table (table_name text, rows_saved bigint)
language plpgsql as $$
#variable_conflict use_column
declare
  fk      record;
  added   bigint;
  total   bigint;
  pass    int := 0;
  prev_ok boolean;
begin
  create temp table if not exists _found (
    table_name text, ident jsonb, row_data jsonb, primary key (table_name, ident)
  ) on commit drop;
  truncate _found;

  -- Seed: the protected accounts themselves.
  execute format(
    'insert into _found select ''users'', %s, to_jsonb(u) from public.users u
     where lower(u.email) in (select lower(email) from snapshot_preserve.protected_users)',
    snapshot_preserve.ident_expr('users', 'u'));

  loop
    pass  := pass + 1;
    total := 0;
    for fk in select * from snapshot_preserve.public_fks loop
      -- Down: rows that point at something already found (their listing's units, leases, ...).
      if fk.child <> 'users' then
        execute format(
          'insert into _found select %L, %s, to_jsonb(c) from public.%I c
           where exists (select 1 from _found f where f.table_name = %L and %s)
           on conflict do nothing',
          fk.child, snapshot_preserve.ident_expr(fk.child, 'c'), fk.child, fk.parent,
          snapshot_preserve.match_expr('c', fk.child_cols, 'f.row_data', fk.parent_cols));
        get diagnostics added = row_count;
        total := total + added;
      end if;

      -- Up: rows that something found points at, but only ones prod does not have.
      if fk.parent <> 'users' then
        execute format(
          'insert into _found select %L, %s, to_jsonb(p) from public.%I p
           where exists (select 1 from _found f where f.table_name = %L and %s)
             and not exists (select 1 from snapshot_preserve.prod_keys k
                             where k.table_name = %L and k.key = jsonb_build_object(%s))
           on conflict do nothing',
          fk.parent, snapshot_preserve.ident_expr(fk.parent, 'p'), fk.parent, fk.child,
          snapshot_preserve.match_expr('p', fk.parent_cols, 'f.row_data', fk.child_cols),
          fk.parent,
          (select string_agg(format('%L, p.%I', c, c), ', ') from unnest(fk.parent_cols) c));
        get diagnostics added = row_count;
        total := total + added;
      end if;
    end loop;
    exit when total = 0 or pass >= 50;
  end loop;

  select last_restore_ok into prev_ok from snapshot_preserve.state where id = 1;
  if prev_ok then
    delete from snapshot_preserve.saved_rows;
  else
    raise warning 'previous restore did not finish; merging into the existing backup instead of replacing it';
  end if;

  insert into snapshot_preserve.saved_rows (table_name, ident, row_data)
  select f.table_name, f.ident, f.row_data from _found f
  on conflict (table_name, ident) do update
    set row_data = excluded.row_data, saved_at = now();

  update snapshot_preserve.state
     set last_save_at = now(), last_restore_ok = false
   where id = 1;

  return query
    select s.table_name, count(*) from snapshot_preserve.saved_rows s
    group by s.table_name order by s.table_name;
end $$;

create or replace function snapshot_preserve.restore()
returns table (table_name text, restored bigint, already_present bigint, failed bigint)
language plpgsql as $$
#variable_conflict use_column
declare
  r        record;
  cols     text;
  n        bigint;
  progress bigint;
  pass     int := 0;
begin
  create temp table if not exists _restore (
    table_name text, ident jsonb, row_data jsonb,
    status text not null default 'pending', last_error text
  ) on commit drop;
  truncate _restore;
  insert into _restore (table_name, ident, row_data)
  select s.table_name, s.ident, s.row_data from snapshot_preserve.saved_rows s;

  -- Rows are retried in passes until nothing more lands, which sorts out FK ordering (parents
  -- before children) without needing a dependency graph.
  loop
    pass     := pass + 1;
    progress := 0;
    for r in select * from _restore where status in ('pending', 'failed') order by table_name loop
      begin
        -- Only columns that exist now AND were saved: a column added since keeps its default, a
        -- column dropped since is ignored. Generated columns are always skipped.
        select string_agg(format('%I', a.attname), ', ' order by a.attnum) into cols
        from pg_attribute a
        join pg_class t     on t.oid = a.attrelid
        join pg_namespace s on s.oid = t.relnamespace
        where s.nspname = 'public' and t.relname = r.table_name
          and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
          and r.row_data ? a.attname;

        if cols is null then
          raise exception 'table public.% no longer exists', r.table_name;
        end if;

        execute format(
          'insert into public.%I (%s) overriding system value
           select %s from jsonb_populate_record(null::public.%I, $1)
           on conflict do nothing',
          r.table_name, cols, cols, r.table_name)
        using r.row_data;
        get diagnostics n = row_count;

        update _restore set status = case when n > 0 then 'restored' else 'present' end,
                            last_error = null
         where table_name = r.table_name and ident = r.ident;
        progress := progress + 1;
      exception when others then
        update _restore set status = 'failed', last_error = sqlerrm
         where table_name = r.table_name and ident = r.ident;
      end;
    end loop;
    exit when progress = 0 or pass >= 20;
  end loop;

  for r in select x.table_name, x.ident, x.last_error from _restore x where x.status = 'failed' loop
    raise warning 'could not restore % %: %', r.table_name, r.ident, r.last_error;
  end loop;

  update snapshot_preserve.state
     set last_restore_at = now(), last_restore_ok = true
   where id = 1;

  return query
    select x.table_name,
           count(*) filter (where x.status = 'restored'),
           count(*) filter (where x.status = 'present'),
           count(*) filter (where x.status = 'failed')
    from _restore x group by x.table_name order by x.table_name;
end $$;
