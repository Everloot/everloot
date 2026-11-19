-- Run after every migration on a disposable local PostgreSQL database that has the roles anon, authenticated and
-- service_role. Everything is rolled back at the end.
-- The "last used" time a key's owner sees on /settings (#1278): every keyed request writes it, at most once a minute
-- per key, so a busy key costs one row write a minute however many requests it makes.
begin;

-- Every function that writes the time keeps the once-a-minute guard.
do $$
declare writers integer;
begin
  select count(*) into writers from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%set last_used_at = now()%';
  if writers < 4 then raise exception 'expected the four key checks to write last_used_at, found %', writers; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc like '%set last_used_at = now()%'
        and p.prosrc not like '%(last_used_at is null or last_used_at < now() - interval ''1 minute'')%') then
    raise exception 'a function writes last_used_at without the once-a-minute guard';
  end if;
end $$;

insert into public.users (id, bnet_id, battletag) values ('00000000-0000-4000-8000-0000000000d1', 'test-last-used', 'Delta#4');
insert into public.api_keys (id, user_id, token_hash, hint, label) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', repeat('a', 64), 'aaaa', 'one'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000d1', repeat('b', 64), 'bbbb', 'two');

do $$
declare
  used timestamptz;
  ok boolean;
  key_one constant uuid := '00000000-0000-4000-8000-0000000000e1';
  key_two constant uuid := '00000000-0000-4000-8000-0000000000e2';
begin
  -- Never used: the first request writes the time.
  select allowed into ok from public.consume_api_key(repeat('a', 64), 'mcp');
  if not ok then raise exception 'the key was refused'; end if;
  select last_used_at into used from public.api_keys where id = key_one;
  if used is distinct from now() then raise exception 'first use not written: %', used; end if;

  -- Used 30 seconds ago: the request is counted, but the time is not written again.
  update public.api_keys set last_used_at = now() - interval '30 seconds' where id = key_one;
  select allowed into ok from public.consume_api_key(repeat('a', 64), 'corpus');
  if not ok then raise exception 'the second request was refused'; end if;
  select last_used_at into used from public.api_keys where id = key_one;
  if used is distinct from now() - interval '30 seconds' then raise exception 'written again within the minute: %', used; end if;

  -- Used two minutes ago: written again.
  update public.api_keys set last_used_at = now() - interval '2 minutes' where id = key_one;
  perform public.consume_api_key(repeat('a', 64), 'mcp');
  select last_used_at into used from public.api_keys where id = key_one;
  if used is distinct from now() then raise exception 'not written after the minute: %', used; end if;

  -- Every request was counted, though the time was written twice.
  if (select sum(count) from public.api_key_usage where key_id = key_one) <> 3 then raise exception 'requests not all counted'; end if;

  -- Only the key that was used: the account's other key keeps no time.
  if (select last_used_at from public.api_keys where id = key_two) is not null then raise exception 'another key was touched'; end if;

  -- A revoked key is refused and writes nothing.
  update public.api_keys set revoked_at = now() where id = key_two;
  select allowed into ok from public.consume_api_key(repeat('b', 64), 'mcp');
  if ok then raise exception 'a revoked key was let in'; end if;
  if (select last_used_at from public.api_keys where id = key_two) is not null then raise exception 'a revoked key wrote a time'; end if;
end $$;

rollback;
