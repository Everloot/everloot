-- The stored time of each house document in a region, for the hourly job (kb blizzard-auctions) only. The job sends it
-- to Blizzard as If-Modified-Since, so a document it already holds answers 304 with no body instead of several MB.
-- A time older than 30 days is never read back (it is null here, so that document is read in full).
set lock_timeout = '3s';

create or replace function public.blizzard_auctions_stamps(p_region text)
returns table(house_id smallint, items_at timestamptz, commodities_at timestamptz)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select h.house_id,
    case when h.items_at >= now() - interval '30 days' then h.items_at end,
    case when h.commodities_at >= now() - interval '30 days' then h.commodities_at end
  from public.blizzard_auction_houses h
  where h.region = p_region
  order by h.house_id;
$$;
revoke all on function public.blizzard_auctions_stamps(text) from public, anon, authenticated;
grant execute on function public.blizzard_auctions_stamps(text) to service_role;

-- Rollback:
-- drop function if exists public.blizzard_auctions_stamps(text);
