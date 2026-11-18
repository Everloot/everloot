-- On-demand armory lookup (#1270 item 2): when /search finds no stored character for a full "First Surname", the
-- site asks the Blizzard Profile API for that slug, US first, then EU, and stores a hit through
-- armory_upsert_characters (its hide guard included). Additive: one table, two functions and a 'lookup' quota scope;
-- the request, install, mcp, api, form and market scopes keep their limits. Apply before setting
-- EVERLOOT_ARMORY_LOOKUP=1. Until then the flag stays off, and with it on but this not applied every lookup is
-- refused by the quota (invalid scope), so the search answers "not found" as it does today.

-- Slugs both regions answered 404 for, kept six hours so the same name is not asked again. Read and written only by
-- the functions below; no grant to any role.
create table if not exists public.armory_lookup_misses (
  slug text primary key check (char_length(slug) <= 64 and slug ~ '^[[:alnum:]]+(-[[:alnum:]]+)*$'),
  until timestamptz not null
);
create index if not exists armory_lookup_misses_until on public.armory_lookup_misses (until);
alter table public.armory_lookup_misses enable row level security;
revoke all on public.armory_lookup_misses from public, anon, authenticated, service_role;

-- The regions a lookup may ask Blizzard about, in order: those where the slug is neither hidden nor stored. None
-- while a miss is cached. A hidden slug is never asked for in its region.
create or replace function public.armory_lookup_regions(p_slug text)
returns text[]
language plpgsql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  if p_slug is null or char_length(p_slug) > 64 or p_slug !~ '^[[:alnum:]]+(-[[:alnum:]]+)*$' then return '{}'; end if;
  if exists(select 1 from public.armory_lookup_misses m where m.slug = p_slug and m.until > now()) then return '{}'; end if;
  return coalesce((
    select array_agg(r.region order by r.ord)
    from (values ('us', 1), ('eu', 2)) as r(region, ord)
    where not exists(select 1 from public.armory_hides h where h.region = r.region and h.slug = p_slug)
      and not exists(select 1 from public.armory_characters c where c.region = r.region and c.slug = p_slug)
  ), '{}');
end;
$$;
revoke all on function public.armory_lookup_regions(text) from public, anon, authenticated;
grant execute on function public.armory_lookup_regions(text) to service_role;

-- Remember a slug no region knows, for six hours, and drop misses that have run out.
create or replace function public.armory_lookup_miss(p_slug text)
returns void
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  if p_slug is null or char_length(p_slug) > 64 or p_slug !~ '^[[:alnum:]]+(-[[:alnum:]]+)*$' then raise exception 'Invalid armory slug'; end if;
  delete from public.armory_lookup_misses where until <= now();
  insert into public.armory_lookup_misses(slug, until) values (p_slug, now() + interval '6 hours')
    on conflict (slug) do update set until = excluded.until;
end;
$$;
revoke all on function public.armory_lookup_miss(text) from public, anon, authenticated;
grant execute on function public.armory_lookup_miss(text) to service_role;

-- The 'lookup' scope: 300 lookups an hour site-wide (at most 4 Blizzard calls each, so 1,200 of the client's
-- 36,000 an hour) and 20 an hour per address. The rest is 20261104120000_market_quota_scope.sql unchanged.
create or replace function public.consume_intake_quota(p_scope text, p_key text)
returns table (allowed boolean, retry_after integer)
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  keys text[];
  limits integer[];
  i integer;
  current_bucket public.intake_quota_buckets%rowtype;
  time_now timestamptz;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_scope is null or p_scope not in ('request', 'install', 'mcp', 'api', 'form', 'market', 'lookup') then
    raise exception 'Invalid quota scope or key';
  end if;
  if p_scope = 'request' then
    keys := array['global', 'ip:' || p_key];
    limits := array[10000, 200];
  elsif p_scope = 'mcp' then
    keys := array['mcp_global', 'mcp:' || p_key];
    limits := array[5000, 200];
  elsif p_scope = 'api' then
    keys := array['api_global', 'api:' || p_key];
    limits := array[3000, 30];
  elsif p_scope = 'form' then
    keys := array['form_global', 'form:' || p_key];
    limits := array[2000, 30];
  elsif p_scope = 'market' then
    keys := array['market_global', 'market:' || p_key];
    limits := array[5000, 200];
  elsif p_scope = 'lookup' then
    keys := array['lookup_global', 'lookup:' || p_key];
    limits := array[300, 20];
  else
    keys := array['install:' || p_key];
    limits := array[20];
  end if;
  -- Always lock the global bucket before the IP one. Check it before creating an IP bucket so a
  -- full global quota cannot be used to create unlimited new rows with forged identities.
  for i in 1..array_length(keys, 1) loop
    time_now := clock_timestamp();
    insert into public.intake_quota_buckets values (keys[i], 0, time_now + interval '1 hour')
      on conflict (bucket) do update set bucket = excluded.bucket
      returning * into current_bucket;
    time_now := clock_timestamp();
    if current_bucket.reset_at <= time_now then
      update public.intake_quota_buckets set count = 0, reset_at = time_now + interval '1 hour' where bucket = keys[i];
      current_bucket.count := 0;
      current_bucket.reset_at := time_now + interval '1 hour';
    end if;
    if current_bucket.count >= limits[i] then
      allowed := false;
      retry_after := greatest(1, ceil(extract(epoch from current_bucket.reset_at - time_now))::integer);
      return next;
      return;
    end if;
  end loop;
  update public.intake_quota_buckets set count = count + 1 where bucket = any(keys);
  allowed := true;
  retry_after := 0;
  return next;
end;
$$;
revoke all on function public.consume_intake_quota(text, text) from public, anon, authenticated;
grant execute on function public.consume_intake_quota(text, text) to service_role;

-- Rollback:
-- (apply supabase/migrations/20261104120000_market_quota_scope.sql again to drop the 'lookup' scope)
-- drop function if exists public.armory_lookup_miss(text);
-- drop function if exists public.armory_lookup_regions(text);
-- drop table if exists public.armory_lookup_misses;
