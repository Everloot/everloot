-- A house's current Blizzard rows by its two document times, not by scanning every stored day.
--
-- 20261115160000_blizzard_auction_browse.sql joined on `snapshot_at = case p.kind ... end`, which no index can serve:
-- each call read every price row of every house and day (the 30-day range on blizzard_auction_prices_snapshot) and
-- kept one house's. The page reads a US house (about 7,000 rows) in 1,000-row pages, each a fresh call, so the whole
-- table was read eight times per view and the read outgrew its 8-second limit as the stored days piled up.
-- Here each document time is an equality on that index. Same signature, columns, rows and order; the page is unchanged.
--
-- Safe to apply twice: the function and its privileges are replaced.
set lock_timeout = '3s';

create or replace function public.blizzard_auction_house_items(p_region text, p_house_id smallint)
returns table(item_id integer, kind text, snapshot_at timestamptz,
  min_unit bigint, typical_unit bigint, quantity integer, auctions integer)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select p.item_id, p.kind, p.snapshot_at, p.min_unit, p.typical_unit, p.quantity, p.auctions
  from public.blizzard_auction_houses h
  cross join lateral (values ('items', h.items_at), ('commodities', h.commodities_at)) d(kind, at)
  join public.blizzard_auction_prices p
    on p.snapshot_at = d.at and p.kind = d.kind and p.region = h.region and p.house_id = h.house_id
  where h.region = p_region and h.house_id = p_house_id
    and d.at >= now() - interval '30 days'
  order by p.item_id, p.kind;
$$;
revoke all on function public.blizzard_auction_house_items(text, smallint) from public, anon, authenticated;
grant execute on function public.blizzard_auction_house_items(text, smallint) to service_role;

-- Rollback: apply the function from 20261115160000_blizzard_auction_browse.sql again.
