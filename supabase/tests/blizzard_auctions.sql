-- Disposable database with 20261113120000_blizzard_auctions.sql applied (twice in CI) and the roles anon,
-- authenticated and service_role present; backup_exporter too when 20261110180000_backup_exporter_role.sql ran first.
-- Rolled back at the end.
begin;

-- Effective grants: no API role and no backup role reaches the tables; only service_role runs the functions.
do $$
declare t text; f regprocedure; r text; n integer := 0;
begin
  foreach t in array array['blizzard_auction_houses','blizzard_auction_prices'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'RLS disabled: %', t; end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'direct table access: % %', r, t; end if;
    end loop;
    -- Backups outlive 30 days, so the backup role never reads Blizzard data.
    if exists (select 1 from pg_roles where rolname = 'backup_exporter')
        and has_table_privilege('backup_exporter', 'public.' || t, 'SELECT') then raise exception 'backup_exporter can read %', t; end if;
    if exists (select 1 from pg_policy where polrelid = ('public.' || t)::regclass) then raise exception 'policy on %', t; end if;
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname like 'blizzard_auction%' loop
    n := n + 1;
    foreach r in array array['anon','authenticated'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception 'function access: % %', r, f; end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'backup_exporter') and has_function_privilege('backup_exporter', f, 'EXECUTE')
      then raise exception 'backup_exporter can execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'server cannot execute %', f; end if;
    if not (select prosecdef and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid = f) then raise exception 'unsafe function %', f; end if;
  end loop;
  if n <> 3 then raise exception 'expected 3 functions, got %', n; end if;
end $$;

-- Invented prices.
do $$
declare v_now timestamptz := date_trunc('hour', now()) - interval '1 hour'; v_later timestamptz := date_trunc('hour', now()) - interval '1 minute';
  h jsonb := jsonb_build_object('house_id', 110, 'name', 'Alliance Auction House');
begin
  if public.blizzard_auctions_put('us', h || jsonb_build_object('kind', 'items', 'snapshot_at', v_now),
      '[{"item_id":9797,"min_unit":1900,"typical_unit":2100,"quantity":3,"auctions":3}]') <> 1
    then raise exception 'items put'; end if;
  if public.blizzard_auctions_put('us', h || jsonb_build_object('kind', 'commodities', 'snapshot_at', v_now - interval '5 minutes'),
      '[{"item_id":954,"min_unit":150,"typical_unit":172,"quantity":26,"auctions":3}]') <> 1
    then raise exception 'commodities put'; end if;
  if public.blizzard_auctions_put('eu', h || jsonb_build_object('kind', 'commodities', 'snapshot_at', v_now),
      '[{"item_id":954,"min_unit":90,"typical_unit":95,"quantity":4,"auctions":2}]') <> 1 then raise exception 'eu put'; end if;
  -- The same document again writes nothing.
  if public.blizzard_auctions_put('us', h || jsonb_build_object('kind', 'items', 'snapshot_at', v_now),
      '[{"item_id":9797,"min_unit":1,"typical_unit":1,"quantity":1,"auctions":1}]') is not null then raise exception 'stale put wrote'; end if;
  if (select count(*) from public.blizzard_auction_item(954)) <> 2 then raise exception 'reader regions'; end if;
  -- Each row carries its own document's time.
  if not exists (select 1 from public.blizzard_auction_item(954) where region = 'us' and house_name = 'Alliance Auction House' and min_unit = 150 and typical_unit = 172 and snapshot_at = v_now - interval '5 minutes')
    then raise exception 'reader values'; end if;
  if not exists (select 1 from public.blizzard_auction_item(9797) where region = 'us' and snapshot_at = v_now) then raise exception 'items reader'; end if;
  -- A newer commodities document is taken although the items document is newer than it: each has its own time.
  if public.blizzard_auctions_put('us', h || jsonb_build_object('kind', 'commodities', 'snapshot_at', v_now - interval '2 minutes'),
      '[{"item_id":954,"min_unit":155,"typical_unit":170,"quantity":20,"auctions":2}]') <> 1 then raise exception 'commodities refused'; end if;
  if not exists (select 1 from public.blizzard_auction_item(954) where region = 'us' and min_unit = 155 and snapshot_at = v_now - interval '2 minutes')
    then raise exception 'newer commodities not current'; end if;
  if not exists (select 1 from public.blizzard_auction_item(9797) where region = 'us' and snapshot_at = v_now) then raise exception 'items lost their time'; end if;
  -- A newer items document without item 9797: the item leaves the current prices, the row stays as that day's history.
  if public.blizzard_auctions_put('us', h || jsonb_build_object('kind', 'items', 'snapshot_at', v_later), '[]') <> 0 then raise exception 'second items put'; end if;
  if exists (select 1 from public.blizzard_auction_item(9797)) then raise exception 'sold-out item still current'; end if;
  if not exists (select 1 from public.blizzard_auction_prices where item_id = 9797) then raise exception 'history row lost'; end if;
  if not exists (select 1 from public.blizzard_auction_item(954) where region = 'us') then raise exception 'commodities dropped by an items put'; end if;
  begin
    perform public.blizzard_auctions_put('kr', h || jsonb_build_object('kind', 'items', 'snapshot_at', v_now), '[]');
    raise exception 'bad region accepted';
  exception when raise_exception then
    if sqlerrm = 'bad region accepted' then raise; end if;
  end;
  begin
    perform public.blizzard_auctions_put('us', h || jsonb_build_object('kind', 'pets', 'snapshot_at', v_now), '[]');
    raise exception 'bad kind accepted';
  exception when raise_exception then
    if sqlerrm = 'bad kind accepted' then raise; end if;
  end;
  begin
    perform public.blizzard_auctions_put('us', jsonb_build_object('house_id', 111, 'name', 'x', 'kind', 'items', 'snapshot_at', now() - interval '31 days'), '[]');
    raise exception 'old snapshot accepted';
  exception when raise_exception then
    if sqlerrm = 'old snapshot accepted' then raise; end if;
  end;
end $$;

-- Rows past 30 days, as if the purge had not run: the reader never returns them, current or not.
insert into public.blizzard_auction_houses (region, house_id, name, items_at, commodities_at) values
  ('eu', 116, 'Blackwater Auction House', now() - interval '31 days', null),
  ('us', 113, 'Horde Auction House', now() - interval '45 days', now() - interval '1 day');
insert into public.blizzard_auction_prices (item_id, region, house_id, kind, day, snapshot_at, min_unit, typical_unit, quantity, auctions) values
  (954, 'eu', 116, 'items', ((now() - interval '31 days') at time zone 'utc')::date, now() - interval '31 days', 5, 5, 1, 1),
  (954, 'us', 113, 'items', ((now() - interval '45 days') at time zone 'utc')::date, now() - interval '45 days', 5, 5, 1, 1),
  (954, 'us', 110, 'commodities', ((now() - interval '40 days') at time zone 'utc')::date, now() - interval '40 days', 5, 5, 1, 1),
  (955, 'us', 110, 'commodities', ((now() - interval '29 days') at time zone 'utc')::date, now() - interval '29 days', 5, 5, 1, 1);
do $$
begin
  if exists (select 1 from public.blizzard_auction_item(954) where snapshot_at < now() - interval '30 days') then raise exception 'reader returned an expired row'; end if;
  if (select count(*) from public.blizzard_auction_item(954)) <> 2 then raise exception 'reader lost current rows'; end if;
end $$;

-- The 30-day purge: rows past 30 days go, history included; a house with no recent document goes; a stale
-- document time is cleared; newer rows stay.
do $$
declare n integer;
begin
  n := public.blizzard_auctions_purge();
  if n <> 4 then raise exception 'purge removed %, expected 4', n; end if;
  if exists (select 1 from public.blizzard_auction_prices where snapshot_at < now() - interval '30 days') then raise exception 'old price kept'; end if;
  if exists (select 1 from public.blizzard_auction_houses where region = 'eu' and house_id = 116) then raise exception 'old house kept'; end if;
  if (select items_at from public.blizzard_auction_houses where region = 'us' and house_id = 113) is not null then raise exception 'stale document time kept'; end if;
  if (select commodities_at from public.blizzard_auction_houses where region = 'us' and house_id = 113) is null then raise exception 'recent document time cleared'; end if;
  if not exists (select 1 from public.blizzard_auction_prices where item_id = 955) then raise exception 'recent history purged'; end if;
  if (select count(*) from public.blizzard_auction_item(954)) <> 2 then raise exception 'current prices purged'; end if;
  if public.blizzard_auctions_purge() <> 0 then raise exception 'second purge removed rows'; end if;
end $$;

rollback;
