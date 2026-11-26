-- One Proxy thread per listing per person (Wyatt, 2026-10-27: "there are two
-- chat threads for the Clover"). Two panels mounting at once each created a
-- thread before the other's insert landed. chat_threads.proxy_key names the
-- pair (listing + signed-in student, or listing + visitor cookie); a trigger
-- fills it for Proxy threads and a partial unique index refuses a second
-- live one. The app catches the conflict and reuses the first.

alter table public.chat_threads add column if not exists proxy_key text;

create or replace function public.fn_chat_proxy_key()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_proxy uuid;
begin
  select id into v_proxy from public.thread_types where name = 'proxy';
  if new.thread_type_id = v_proxy and new.deleted_at is null then
    if new.interested_user_id is not null then
      new.proxy_key := new.listing_id::text || ':u:' || new.interested_user_id::text;
    elsif new.visitor_id is not null then
      new.proxy_key := new.listing_id::text || ':v:' || new.visitor_id;
    else
      new.proxy_key := null;
    end if;
  else
    new.proxy_key := null;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_chat_proxy_key() from public, anon, authenticated;
grant execute on function public.fn_chat_proxy_key() to service_role;

drop trigger if exists trg_chat_proxy_key on public.chat_threads;
create trigger trg_chat_proxy_key
  before insert or update of listing_id, interested_user_id, visitor_id, thread_type_id, deleted_at
  on public.chat_threads
  for each row execute function public.fn_chat_proxy_key();

-- Existing rows: keep the oldest live thread per pair, soft-delete the rest
-- only when they are empty; a duplicate with messages keeps its key cleared
-- so the index can be built, and the app's claim/merge handles it later.
update public.chat_threads t set proxy_key = null where proxy_key is not null;
update public.chat_threads t
  set proxy_key = sub.key
  from (
    select c.id,
      c.listing_id::text || case when c.interested_user_id is not null then ':u:' || c.interested_user_id::text else ':v:' || c.visitor_id end as key,
      row_number() over (partition by c.listing_id, coalesce(c.interested_user_id::text, 'v:' || c.visitor_id) order by c.created_at) as rn
    from public.chat_threads c
    where c.thread_type_id = (select id from public.thread_types where name = 'proxy')
      and c.deleted_at is null
      and (c.interested_user_id is not null or c.visitor_id is not null)
  ) sub
  where sub.id = t.id and sub.rn = 1;
update public.chat_threads t
  set deleted_at = now()
  where t.thread_type_id = (select id from public.thread_types where name = 'proxy')
    and t.deleted_at is null and t.proxy_key is null
    and not exists (select 1 from public.chat_messages m where m.thread_id = t.id);

create unique index if not exists chat_threads_proxy_key_unique
  on public.chat_threads (proxy_key)
  where proxy_key is not null and deleted_at is null;
