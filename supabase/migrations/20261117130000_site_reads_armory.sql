-- The site reads Blizzard's character API through the armory instead of synced copies
-- (docs/design/specs/2026-11-17-blizzard-api-first.md). Apply after the site change that stops sending the retired
-- categories has shipped. The maintainer applies it; it is safe to apply twice.
--
-- 1. Private sync keeps only `raids` and `achievements`, and `achievements` keeps only titles. What was synced for
--    gear, stats, talents, pvp, professions and reputations is deleted with its consent, and earned achievements are
--    removed from the stored achievements facts. The category checks then refuse the retired categories.
-- 2. The synced gear boards' history (character_track) is deleted. The boards' stored file is an object in the
--    private bucket, not a table: the profile cron deletes it on its next run.
-- 3. public_character_armory: the armory character a public character page shows, with the page's section switches.
set lock_timeout = '3s';

do $$
begin
  if to_regclass('public.character_facts') is null or to_regclass('public.armory_links') is null then
    raise exception 'Apply 20261107140000_private_sync_stats_pvp.sql and 20261112190000_armory_profiles.sql first';
  end if;
end $$;

-- 1. Retired sync categories.
delete from public.character_facts where category in ('gear', 'stats', 'talents', 'pvp', 'professions', 'reputations');
delete from public.character_sync_consent where category in ('gear', 'stats', 'talents', 'pvp', 'professions', 'reputations');
update public.character_facts f
  set data = jsonb_build_object('titleIds', coalesce(f.data -> 'titleIds', '[]'::jsonb)),
    data_hash = encode(sha256(convert_to(jsonb_build_object('titleIds', coalesce(f.data -> 'titleIds', '[]'::jsonb))::text, 'UTF8')), 'hex')
  where f.category = 'achievements' and f.data ? 'achievements';
alter table public.character_sync_consent drop constraint if exists character_sync_consent_category_check;
alter table public.character_sync_consent add constraint character_sync_consent_category_check
  check (category in ('raids', 'achievements'));
alter table public.character_facts drop constraint if exists character_facts_category_check;
alter table public.character_facts add constraint character_facts_category_check
  check (category in ('raids', 'achievements'));

-- 2. The synced gear boards' history.
do $$
begin
  if to_regclass('public.character_track') is not null then
    delete from public.character_track;
  end if;
end $$;

-- 3. The armory character of a public character page, under the same checks as public_character_facts and
-- armory_public_link: a live, public, unhidden link with no frozen claim, an association whose armory identity still
-- matches the link, and no armory hide. The switches say which sections the page may show.
create or replace function public.public_character_armory(p_ruleset text, p_realm_slug text, p_name text)
returns table (region text, slug text, show_gear boolean, show_stats boolean, show_talents boolean, show_pvp boolean,
  show_professions boolean, show_reputations boolean, show_collections boolean)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select a.region, a.slug, v.show_gear, v.show_stats, v.show_talents, v.show_pvp, v.show_professions,
    v.show_reputations, v.show_collections
  from public.character_links l
  join public.character_visibility v on v.link_id = l.id
  join public.armory_links a on a.link_id = l.id
  where l.ruleset = p_ruleset and l.name_key = lower(p_name) and l.realm_key = public.link_realm_key(p_realm_slug)
    and l.status = 'linked' and v.page_public
    and exists (select 1 from public.armory_public_link(a.region, a.slug) p where p.ruleset = l.ruleset and p.name = l.name)
    and not exists (select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = l.realm_key and s.character = l.name_key)
    and not exists (select 1 from public.character_links o where o.id <> l.id and o.status = 'frozen'
      and (o.link_key = l.link_key or (o.ruleset = l.ruleset and o.realm_key = l.realm_key and o.name_key = l.name_key)))
  limit 1;
$$;
revoke all on function public.public_character_armory(text, text, text) from public, anon, authenticated;
grant execute on function public.public_character_armory(text, text, text) to service_role;
notify pgrst, 'reload schema';

-- Readback (every row t):
--   select 'facts' as check, not exists (select 1 from public.character_facts where category not in ('raids', 'achievements')) as ok
--   union all select 'no earned achievements', not exists (select 1 from public.character_facts where data ? 'achievements')
--   union all select 'history', not exists (select 1 from public.character_track)
--   union all select 'armory read', has_function_privilege('service_role', 'public.public_character_armory(text, text, text)', 'EXECUTE')
--     and not has_function_privilege('anon', 'public.public_character_armory(text, text, text)', 'EXECUTE');
-- Rollback: the deleted facts and history cannot be restored. To accept the old categories again, re-run section 1 of
-- 20261107140000_private_sync_stats_pvp.sql, and drop function if exists public.public_character_armory(text, text, text).
