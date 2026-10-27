-- Spend orders for saved builds: each set's order token (docs/2026-10-17-talent-share-code.md, "Spend order") beside
-- its share code, saved with it in one transaction. Additive: two nullable columns on saved_builds with their shape
-- checks, a trigger that drops an order when a save changes its code, and save_build_plan, the one call the site makes
-- to save a build. The table's other columns, its grants and row security, and the eight functions of
-- 20261021150000_saved_builds.sql stay exactly as they are. Safe to apply twice.
-- The site's code works with or without this file. Without it, builds are read without orders, a save that names no
-- order goes through save_build, and one that names an order is refused with nothing written; orders are kept from
-- about a minute after the apply. Apply it before EVERLOOT_SAVED_BUILDS is turned on
-- (docs/2026-10-27-saved-builds-activation.md, "Spend orders").
--
-- An order is stored as its token only: O1, then p (planned by the player) or g (generated, so provisional), a dash
-- and one letter a point, at most 64. Who made the order travels in the token. Before a token gets here the server has
-- read it against its own set's code (each letter a point of that code, every point once); this file holds its shape.

alter table public.saved_builds
  add column if not exists point_order text,
  add column if not exists point_order2 text;
alter table public.saved_builds
  drop constraint if exists saved_builds_point_order_check,
  drop constraint if exists saved_builds_point_order2_check;
alter table public.saved_builds
  add constraint saved_builds_point_order_check
    check (point_order is null or point_order ~ '^O1[pg]-[A-Za-z0-9_-]{1,64}$'),
  add constraint saved_builds_point_order2_check
    check (point_order2 is null or (code2 is not null and point_order2 ~ '^O1[pg]-[A-Za-z0-9_-]{1,64}$'));

-- 1. An order belongs to the code it was saved with. An update that changes a code drops that set's order, which named
-- the points of the code before: this is how save_build, which knows nothing of orders, keeps them right for the site
-- that calls it from before this file. save_build_plan writes the codes first, through save_build, and then the orders
-- that came with them, in a second statement that does not touch the codes.
create or replace function public.saved_build_order_follows_code()
returns trigger
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  if new.code is distinct from old.code then new.point_order := null; end if;
  if new.code2 is distinct from old.code2 then new.point_order2 := null; end if;
  return new;
end;
$$;
revoke all on function public.saved_build_order_follows_code() from public, anon, authenticated, service_role;
drop trigger if exists saved_builds_order_follows_code on public.saved_builds;
create trigger saved_builds_order_follows_code
  before update of code, code2 on public.saved_builds
  for each row execute function public.saved_build_order_follows_code();

-- 2. Save a build and its spend orders in one transaction. p_payload is the build as the server checked it
-- (BuildInput in web/src/lib/saved-builds.ts): id, slug (a new build's, from the server), name, notes, characterId,
-- code, code2, shared, active, showName, order and order2, nothing else. save_build files the build exactly as it does
-- for its older callers, with its limits, ownership checks and refusals; then each set's order is written beside its
-- code. Anything that fails after save_build undoes the whole save, its count against the daily saves included.
-- A new build must give shared and showName: nothing here picks for it. On an update a null keeps the stored value, as
-- in save_build. An order in the payload is written as given, null for an unknown order; one left out of it stays only
-- while its code stays the same (the trigger above).
-- Returns {build_ref, build_slug, refusal} with save_build's refusals: not_found, class_mismatch, build_limit,
-- daily_limit, slug_taken. A payload of any other shape raises.
create or replace function public.save_build_plan(p_user_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  order_shape constant text := '^O1[pg]-[A-Za-z0-9_-]{1,64}$';
  v_id uuid;
  v_shared boolean;
  v_show_name boolean;
  v_order text;
  v_order2 text;
  v_saved record;
begin
  if p_user_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid build'; end if;
  if exists (select 1 from jsonb_each(p_payload) f where jsonb_typeof(f.value) <> all (case f.key
      when 'name' then array['string'] when 'code' then array['string']
      when 'id' then array['string', 'null'] when 'slug' then array['string', 'null'] when 'notes' then array['string', 'null']
      when 'characterId' then array['string', 'null'] when 'code2' then array['string', 'null']
      when 'shared' then array['boolean', 'null'] when 'active' then array['boolean', 'null'] when 'showName' then array['boolean', 'null']
      when 'order' then array['string', 'null'] when 'order2' then array['string', 'null']
      else array[]::text[] end)) then
    raise exception 'Invalid build';
  end if;
  v_id := (p_payload ->> 'id')::uuid;
  v_shared := (p_payload ->> 'shared')::boolean;
  v_show_name := (p_payload ->> 'showName')::boolean;
  v_order := p_payload ->> 'order';
  v_order2 := p_payload ->> 'order2';
  if (v_id is null and (v_shared is null or v_show_name is null))
    or (v_order is not null and v_order !~ order_shape)
    or (v_order2 is not null and (v_order2 !~ order_shape or p_payload ->> 'code2' is null)) then
    raise exception 'Invalid build';
  end if;

  select * into v_saved from public.save_build(p_user_id, v_id, p_payload ->> 'slug', (p_payload ->> 'characterId')::uuid,
    p_payload ->> 'name', p_payload ->> 'notes', p_payload ->> 'code', p_payload ->> 'code2', v_shared,
    (p_payload ->> 'active')::boolean, v_show_name);
  if v_saved.refusal is not null then
    return jsonb_build_object('build_ref', null, 'build_slug', null, 'refusal', v_saved.refusal);
  end if;
  if p_payload ? 'order' or p_payload ? 'order2' then
    update public.saved_builds b
      set point_order = case when p_payload ? 'order' then v_order else b.point_order end,
        point_order2 = case when p_payload ? 'order2' then v_order2 else b.point_order2 end
      where b.id = v_saved.build_ref and b.user_id = p_user_id;
  end if;
  return jsonb_build_object('build_ref', v_saved.build_ref, 'build_slug', v_saved.build_slug, 'refusal', null);
end;
$$;
revoke all on function public.save_build_plan(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_build_plan(uuid, jsonb) to service_role;
notify pgrst, 'reload schema';

-- Every order one account saved: select id, point_order, point_order2 from public.saved_builds where user_id = '<id>';
-- Rollback (run by hand). From its next save the site goes back to save_build for a save that names no order, and
-- refuses one that names an order:
--   drop function if exists public.save_build_plan(uuid, jsonb);
--   notify pgrst, 'reload schema';
-- The columns, every order in them and the trigger stay. Dropping the columns deletes every saved order; dropping the
-- trigger would let an older save leave an order beside a code it was not made for.
