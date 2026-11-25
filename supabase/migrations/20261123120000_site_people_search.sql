-- The site search's characters and guilds in one read (#1271).
--
-- The header type-ahead asked for characters and guilds with separate reads: armory_search (armory characters),
-- search_players (characters the addon saw) and, for guilds, the players table and the kill and board files only, so a
-- guild the armory knows never showed. site_people_search answers all three kinds in one round trip, by name prefix:
--   character/armory  armory_characters by first name, surname or "first surname" (armory_search's rule and indexes)
--   character/players players by name (search_players's rule and players_name_prefix)
--   guild/armory      armory_guilds by name (armory_guilds_name), as armory_guild_directory lists them
-- Each kind keeps the hide rule its own search has: armory_hides, character_suppressions, and a /guilds hide in the
-- region its realm names (armory_guild_directory's rule). A disbanded guild ("DELETED") is left out. Nothing new is
-- read: every column returned is one the character, player and guild pages already show.
--
-- The text is trimmed, lower cased and any run of spaces read as one; under two characters, or with a LIKE wildcard
-- or backslash, nothing is read. At most p_limit rows of each kind (25 at most), in name order.
--
-- Adds one function; no table, index or row changes (every prefix index it needs exists). Safe to apply twice. Apply
-- after 20261117140000_armory_full_name_search.sql and 20261025120000_guilds.sql. The owner applies this: the site never
-- applies a migration, and until it is applied the site keeps its separate reads.
set lock_timeout = '3s';

do $$
begin
  if to_regclass('public.armory_characters_full_name') is null or to_regclass('public.guild_suppressions') is null
    or to_regclass('public.players_name_prefix') is null then
    raise exception 'Apply 20261117140000_armory_full_name_search.sql, 20261025120000_guilds.sql and 20261021130000_players.sql first';
  end if;
end $$;

-- PL/pgSQL so the pattern is a known value when each query is planned, which lets each LIKE use its prefix index.
create or replace function public.site_people_search(p_prefix text, p_limit integer)
returns table (kind text, source text, region text, slug text, name text, surname text, level smallint, class text,
  faction text, ruleset text, realm text, member_count integer)
language plpgsql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_pattern text := lower(regexp_replace(btrim(coalesce(p_prefix, '')), '\s+', ' ', 'g'));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 0), 25);
begin
  if char_length(v_pattern) < 2 or v_pattern !~ '^[^%_\\]+$' or v_limit = 0 then return; end if;
  v_pattern := v_pattern || '%';

  return query
  select 'character'::text, 'armory'::text, c.region, c.slug, c.name, c.surname, c.level, c.class, c.faction, c.ruleset, null::text, null::integer
  from public.armory_characters c
  where (lower(c.name) like v_pattern or lower(c.surname) like v_pattern or lower(c.name || ' ' || c.surname) like v_pattern)
    and not exists(select 1 from public.armory_hides h where h.region=c.region and h.slug=c.slug)
  order by c.name, c.surname, c.region, c.slug limit v_limit;

  return query
  select 'character'::text, 'players'::text, null::text, null::text, p.name, null::text, p.level, p.class, null::text, p.ruleset, p.realm, null::integer
  from public.players p
  where p.name_key like v_pattern
    and not exists(select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = p.realm_key and s.character = p.name_key)
  order by p.name_key, p.realm, p.level limit v_limit;

  return query
  select 'guild'::text, 'armory'::text, g.region, g.slug, g.name, null::text, null::smallint, null::text, g.faction, g.ruleset, null::text, g.member_count
  from public.armory_guilds g
  where lower(g.name) like v_pattern and g.name <> 'DELETED'
    and not exists(select 1 from public.guild_suppressions s
      where s.guild_key = lower(g.name) and s.realm_key ~ ('(^| )' || g.region || '[0-9]*( |$)'))
  order by g.name, g.region, g.slug limit v_limit;
end;
$$;
revoke all on function public.site_people_search(text, integer) from public, anon, authenticated;
grant execute on function public.site_people_search(text, integer) to service_role;
notify pgrst, 'reload schema';
reset lock_timeout;

-- Readback (every row t):
--   select has_function_privilege('service_role','public.site_people_search(text,integer)','EXECUTE')
--     and not has_function_privilege('anon','public.site_people_search(text,integer)','EXECUTE') as ok;
--   select count(*) >= 0 as ok from public.site_people_search('ab',1);
-- Rollback (the site goes back to its separate reads by itself):
--   drop function if exists public.site_people_search(text, integer);
