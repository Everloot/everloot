-- The gear rankings' one read (leaderboards plan, 2026-11-06; rankings design section 6.2, approved 2026-10-21).
-- Additive: one function, nothing else. Needs 20261106120000_private_sync.sql first. Apply before setting
-- EVERLOOT_LEADERBOARDS=1; until then the site never calls it. Safe to apply twice.
--
-- A character is on the boards only while all of these hold: its link is live (linked, not frozen, and no frozen link
-- claims it), its owner made the page public and turned "Rank my gear" on (ranked_gear), gear sync is still on, it is
-- not hidden by a hide request, and its gear was captured in the last 30 days. Turning any of them off takes it off on
-- the next request: nothing is stored for the boards. The equipped items leave this function only to be scored by the
-- site (kb/src/gear-score.ts); the boards print the two numbers, never the items. No account, key, source or hash.

do $$
begin
  if to_regclass('public.character_facts') is null then
    raise exception 'Apply 20261106120000_private_sync.sql first';
  end if;
end $$;

create or replace function public.ranked_gear_board()
returns table (ruleset text, realm text, name text, race text, class text, faction text, level smallint,
  captured_at timestamptz, data jsonb)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select l.ruleset, l.realm, l.name, l.race, l.class, l.faction, l.level, f.captured_at, f.data
  from public.character_links l
  join public.character_visibility v on v.link_id = l.id
  join public.character_facts f on f.link_id = l.id and f.category = 'gear'
  join public.character_sync_consent c on c.link_id = l.id and c.category = 'gear' and c.revoked_at is null
  where l.status = 'linked' and v.page_public and v.ranked_gear
    and f.captured_at >= now() - interval '30 days'
    and not exists (select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = l.realm_key and s.character = l.name_key)
    and not exists (select 1 from public.character_links o where o.id <> l.id and o.status = 'frozen'
      and (o.link_key = l.link_key or (o.ruleset = l.ruleset and o.realm_key = l.realm_key and o.name_key = l.name_key)))
  order by l.ruleset, l.realm_key, l.name_key
  limit 5000;
$$;
revoke all on function public.ranked_gear_board() from public, anon, authenticated;
grant execute on function public.ranked_gear_board() to service_role;
notify pgrst, 'reload schema';

-- Readback (every row t):
--   select 'board' as check, has_function_privilege('service_role', 'public.ranked_gear_board()', 'EXECUTE') as ok
--   union all select 'closed', not has_function_privilege('anon', 'public.ranked_gear_board()', 'EXECUTE')
--     and not has_function_privilege('authenticated', 'public.ranked_gear_board()', 'EXECUTE');
-- Rollback (run by hand): drop function if exists public.ranked_gear_board(); notify pgrst, 'reload schema';
