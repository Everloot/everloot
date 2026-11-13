-- Blizzard Forever auction house prices (issue #1122): per-item summaries of each house, read hourly by
-- `kb blizzard-auctions` (.github/workflows/blizzard-auctions.yml). Blizzard API data, kept apart from the prices
-- players' addons report (market.json) and never folded into them.
--
-- Blizzard Developer API Terms: nothing older than 30 days is kept (blizzard_auctions_purge runs every pass, and on
-- its own schedule even when the refresh is off or failing) and nothing older is ever read back. The data goes only
-- to Everloot's own page for it (/blizzard-auctions/<item>): no export, open data, MCP tool, chat answer or public
-- API reads it. The tables are closed to every API role, service_role included; the job and that page use the
-- functions below. backup_exporter gets no grant either: a backup kept past 30 days must not hold this data, so the
-- nightly dump skips these two tables.
--
-- A house is served as two documents, items and commodities, each published at its own time. Each is a snapshot of
-- its own: the house keeps one time per document, and every price row the time of the document it came from.
-- History: one row per item, house, document and UTC day, holding that day's newest snapshot listing the item.
-- A house's current prices are the rows whose snapshot_at equals the house's time for that document.
--
-- Safe to apply twice: tables and indexes are conditional, functions and privileges are replaced.
set lock_timeout = '3s';

create table if not exists public.blizzard_auction_houses (
  region text check (region in ('us','eu')),
  house_id smallint check (house_id > 0),
  name text not null check (char_length(name) <= 80),
  items_at timestamptz,
  commodities_at timestamptz,
  fetched_at timestamptz not null default now(),
  primary key (region, house_id),
  check (items_at is not null or commodities_at is not null)
);

create table if not exists public.blizzard_auction_prices (
  item_id integer check (item_id > 0),
  region text,
  house_id smallint,
  kind text check (kind in ('items','commodities')),
  day date,
  snapshot_at timestamptz not null,
  min_unit bigint not null check (min_unit > 0),
  typical_unit bigint not null check (typical_unit >= min_unit),
  quantity integer not null check (quantity > 0),
  auctions integer not null check (auctions > 0 and auctions <= quantity),
  primary key (item_id, region, house_id, kind, day),
  foreign key (region, house_id) references public.blizzard_auction_houses(region, house_id) on delete cascade
);
create index if not exists blizzard_auction_prices_snapshot on public.blizzard_auction_prices(snapshot_at);

alter table public.blizzard_auction_houses enable row level security;
revoke all on public.blizzard_auction_houses from public, anon, authenticated, service_role;
alter table public.blizzard_auction_prices enable row level security;
revoke all on public.blizzard_auction_prices from public, anon, authenticated, service_role;
-- 20261110180000_backup_exporter_role.sql grants every table that exists when it runs; a re-run after this one
-- would open these two, so applying this file again closes them.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'backup_exporter') then
    revoke all on public.blizzard_auction_houses, public.blizzard_auction_prices from backup_exporter;
  end if;
end $$;
drop policy if exists backup_exporter_select on public.blizzard_auction_houses;
drop policy if exists backup_exporter_select on public.blizzard_auction_prices;

-- Replace one of a house's documents with a newer snapshot. p_house: {house_id, name, kind, snapshot_at}, kind
-- 'items' or 'commodities'; p_rows: [{item_id, min_unit, typical_unit, quantity, auctions}]. Returns the item rows
-- written, or null when the stored snapshot of that document is as new or newer (nothing is written).
create or replace function public.blizzard_auctions_put(p_region text, p_house jsonb, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_house smallint := (p_house->>'house_id')::smallint;
  v_kind text := p_house->>'kind';
  v_at timestamptz := (p_house->>'snapshot_at')::timestamptz;
  n integer;
begin
  if p_region is null or p_region not in ('us','eu') then raise exception 'region must be us or eu'; end if;
  if v_kind is null or v_kind not in ('items','commodities') then raise exception 'kind must be items or commodities'; end if;
  if v_at is null or v_at > now() + interval '1 hour' or v_at < now() - interval '30 days' then
    raise exception 'snapshot time out of range: %', v_at;
  end if;
  insert into public.blizzard_auction_houses as h (region, house_id, name, items_at, commodities_at, fetched_at)
  values (p_region, v_house, coalesce(left(p_house->>'name', 80), 'Auction House'),
    case when v_kind = 'items' then v_at end, case when v_kind = 'commodities' then v_at end, now())
  on conflict (region, house_id) do update
    set name = excluded.name,
        items_at = coalesce(excluded.items_at, h.items_at),
        commodities_at = coalesce(excluded.commodities_at, h.commodities_at),
        fetched_at = excluded.fetched_at
    where coalesce(case v_kind when 'items' then h.items_at else h.commodities_at end, '-infinity') < v_at;
  if not found then return null; end if;
  insert into public.blizzard_auction_prices as p (item_id, region, house_id, kind, day, snapshot_at, min_unit, typical_unit, quantity, auctions)
  select distinct on (r.item_id) r.item_id, p_region, v_house, v_kind, (v_at at time zone 'utc')::date, v_at,
    r.min_unit, r.typical_unit, r.quantity, r.auctions
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
    as r(item_id integer, min_unit bigint, typical_unit bigint, quantity integer, auctions integer)
  order by r.item_id
  on conflict (item_id, region, house_id, kind, day) do update
    set snapshot_at = excluded.snapshot_at, min_unit = excluded.min_unit, typical_unit = excluded.typical_unit,
        quantity = excluded.quantity, auctions = excluded.auctions;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.blizzard_auctions_put(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.blizzard_auctions_put(text, jsonb, jsonb) to service_role;

-- Delete every price row older than 30 days, current or history, and every house with no document newer than that;
-- a house's document time past 30 days is cleared. Returns the rows deleted.
create or replace function public.blizzard_auctions_purge()
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare v_cutoff timestamptz := now() - interval '30 days'; n integer; removed integer;
begin
  delete from public.blizzard_auction_prices where snapshot_at < v_cutoff;
  get diagnostics n = row_count;
  delete from public.blizzard_auction_houses where greatest(items_at, commodities_at) < v_cutoff;
  get diagnostics removed = row_count;
  update public.blizzard_auction_houses
    set items_at = case when items_at < v_cutoff then null else items_at end,
        commodities_at = case when commodities_at < v_cutoff then null else commodities_at end
    where items_at < v_cutoff or commodities_at < v_cutoff;
  return n + removed;
end;
$$;
revoke all on function public.blizzard_auctions_purge() from public, anon, authenticated;
grant execute on function public.blizzard_auctions_purge() to service_role;

-- One item's current prices in every house that lists it, each with the time of the document it came from. Never a
-- row older than 30 days, even before the purge has run. The Blizzard auction page is the only reader.
create or replace function public.blizzard_auction_item(p_item_id integer)
returns table(region text, house_id smallint, house_name text, snapshot_at timestamptz,
  min_unit bigint, typical_unit bigint, quantity integer, auctions integer)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select h.region, h.house_id, h.name, p.snapshot_at, p.min_unit, p.typical_unit, p.quantity, p.auctions
  from public.blizzard_auction_houses h
  join public.blizzard_auction_prices p
    on p.item_id = p_item_id and p.region = h.region and p.house_id = h.house_id
   and p.snapshot_at = case p.kind when 'items' then h.items_at else h.commodities_at end
  where p.snapshot_at >= now() - interval '30 days'
  order by h.region, h.house_id, p.kind;
$$;
revoke all on function public.blizzard_auction_item(integer) from public, anon, authenticated;
grant execute on function public.blizzard_auction_item(integer) to service_role;

-- Check after applying (expect no rows):
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name like 'blizzard_auction_%'
--     and grantee in ('anon','authenticated','service_role','backup_exporter','PUBLIC');
--
-- Rollback:
-- drop function if exists public.blizzard_auction_item(integer);
-- drop function if exists public.blizzard_auctions_purge();
-- drop function if exists public.blizzard_auctions_put(text, jsonb, jsonb);
-- drop table if exists public.blizzard_auction_prices;
-- drop table if exists public.blizzard_auction_houses;
