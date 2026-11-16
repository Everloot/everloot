-- Read-only browsing and daily history for the ad-free Blizzard auction pages only.
-- No table grants, public API, exports or player-price rollups.
set lock_timeout = '3s';

create or replace function public.blizzard_auction_house_items(p_region text, p_house_id smallint)
returns table(item_id integer, kind text, snapshot_at timestamptz,
  min_unit bigint, typical_unit bigint, quantity integer, auctions integer)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select p.item_id, p.kind, p.snapshot_at, p.min_unit, p.typical_unit, p.quantity, p.auctions
  from public.blizzard_auction_houses h
  join public.blizzard_auction_prices p
    on p.region = h.region and p.house_id = h.house_id
   and p.snapshot_at = case p.kind when 'items' then h.items_at else h.commodities_at end
  where h.region = p_region and h.house_id = p_house_id
    and p.snapshot_at >= now() - interval '30 days'
  order by p.item_id, p.kind;
$$;
revoke all on function public.blizzard_auction_house_items(text, smallint) from public, anon, authenticated;
grant execute on function public.blizzard_auction_house_items(text, smallint) to service_role;

-- Stored rows already hold the newest listing per item, region, house, kind and UTC day.
-- History intentionally includes items that have since left a house's current snapshot.
create or replace function public.blizzard_auction_item_history(p_item_id integer)
returns table(region text, house_id smallint, house_name text, kind text, day date, snapshot_at timestamptz,
  min_unit bigint, typical_unit bigint, quantity integer, auctions integer)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select p.region, p.house_id, h.name, p.kind, p.day, p.snapshot_at,
    p.min_unit, p.typical_unit, p.quantity, p.auctions
  from public.blizzard_auction_prices p
  join public.blizzard_auction_houses h on h.region = p.region and h.house_id = p.house_id
  where p.item_id = p_item_id and p.snapshot_at >= now() - interval '30 days'
  order by p.region, p.house_id, p.kind, p.day;
$$;
revoke all on function public.blizzard_auction_item_history(integer) from public, anon, authenticated;
grant execute on function public.blizzard_auction_item_history(integer) to service_role;

-- Rollback:
-- drop function if exists public.blizzard_auction_house_items(text, smallint);
-- drop function if exists public.blizzard_auction_item_history(integer);
