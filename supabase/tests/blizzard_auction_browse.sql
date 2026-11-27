begin;

do $$
declare f regprocedure; r text;
begin
  foreach f in array array['public.blizzard_auction_house_items(text,smallint)'::regprocedure,
    'public.blizzard_auction_item_history(integer)'::regprocedure] loop
    foreach r in array array['anon','authenticated','backup_exporter'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception 'function access: % %', r, f; end if;
    end loop;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'server cannot execute %', f; end if;
    if not (select prosecdef and provolatile = 's' and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid = f)
      then raise exception 'unsafe reader %', f; end if;
  end loop;
end $$;

insert into public.blizzard_auction_houses(region,house_id,name,items_at,commodities_at) values
  ('us',110,'Alliance Auction House',now() - interval '1 hour',now() - interval '2 hours'),
  ('eu',110,'Alliance Auction House',now() - interval '1 hour',null),
  ('us',113,'Horde Auction House',now() - interval '31 days',null);
insert into public.blizzard_auction_prices(item_id,region,house_id,kind,day,snapshot_at,min_unit,typical_unit,quantity,auctions) values
  (954,'us',110,'items',current_date,now() - interval '1 hour',10,20,4,2),
  (955,'us',110,'commodities',current_date,now() - interval '2 hours',30,40,6,3),
  (956,'us',110,'items',current_date,now() - interval '3 hours',50,60,8,4),
  (954,'us',110,'items',current_date - 1,now() - interval '1 day',70,80,10,5),
  (954,'us',110,'commodities',current_date - 2,now() - interval '2 days',90,100,12,6),
  (954,'eu',110,'items',current_date,now() - interval '1 hour',110,120,14,7),
  (954,'us',113,'items',current_date - 31,now() - interval '31 days',130,140,16,8),
  (954,'us',110,'items',current_date - 31,now() - interval '31 days',150,160,18,9);

-- Twenty days of two more houses (20,000 rows), each document at its own time, to measure what a house read touches.
insert into public.blizzard_auction_houses(region,house_id,name,items_at,commodities_at) values
  ('us',112,'Neutral Auction House',now() - interval '30 minutes',now() - interval '40 minutes'),
  ('eu',112,'Neutral Auction House',now() - interval '35 minutes',now() - interval '45 minutes');
insert into public.blizzard_auction_prices(item_id,region,house_id,kind,day,snapshot_at,min_unit,typical_unit,quantity,auctions)
select 10000 + i, h.region, h.house_id, k.kind, current_date - g,
  case k.kind when 'items' then h.items_at else h.commodities_at end - g * interval '1 day', 10, 20, 4, 2
from public.blizzard_auction_houses h, generate_series(0, 19) g, unnest(array['items','commodities']) k(kind), generate_series(1, 250) i
where h.house_id = 112;
analyze public.blizzard_auction_prices;

set local role service_role;
do $$
begin
  if (select count(*) from public.blizzard_auction_house_items('us',110::smallint)) <> 2 then raise exception 'current house rows'; end if;
  if not exists (select 1 from public.blizzard_auction_house_items('us',110::smallint) where item_id = 955 and kind = 'commodities' and min_unit = 30 and typical_unit = 40 and quantity = 6 and auctions = 3)
    then raise exception 'commodity snapshot lost'; end if;
  if (select count(*) from public.blizzard_auction_house_items('eu',110::smallint)) <> 1 then raise exception 'region isolation'; end if;
  if exists (select 1 from public.blizzard_auction_house_items('us',113::smallint)) then raise exception 'expired current rows'; end if;
  if exists (select 1 from public.blizzard_auction_house_items('us',125::smallint)) then raise exception 'unknown house'; end if;
  if (select count(*) from public.blizzard_auction_item_history(954)) <> 4 then raise exception 'history lost region, kind or day'; end if;
  if not exists (select 1 from public.blizzard_auction_item_history(954) where region = 'us' and house_id = 110 and kind = 'items' and day = current_date - 1 and min_unit = 70 and typical_unit = 80)
    then raise exception 'history values'; end if;
  if exists (select 1 from public.blizzard_auction_item_history(954) where snapshot_at < now() - interval '30 days') then raise exception 'expired history'; end if;
  if exists (select 1 from public.blizzard_auction_item_history(999)) then raise exception 'unknown item'; end if;
end $$;

-- A house read touches that house's current rows, not every stored day of every house: the page calls it once per
-- 1,000 rows, so a whole-table read per call outgrew the page's 8-second limit (US, 11/27).
do $$
declare
  t regclass := 'public.blizzard_auction_prices';
  before bigint := pg_stat_get_xact_tuples_returned(t) + pg_stat_get_xact_tuples_fetched(t);
  got integer;
  touched bigint;
begin
  select count(*) into got from public.blizzard_auction_house_items('us',112::smallint);
  touched := pg_stat_get_xact_tuples_returned(t) + pg_stat_get_xact_tuples_fetched(t) - before;
  if got <> 500 then raise exception 'house 112 current rows: %', got; end if;
  if touched > 2 * got then raise exception 'house read touched % price rows for % current rows', touched, got; end if;
end $$;
reset role;
rollback;
