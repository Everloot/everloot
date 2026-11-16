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
reset role;
rollback;
