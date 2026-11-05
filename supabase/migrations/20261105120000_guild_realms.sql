-- Guilds by realm: the guild directory's realm pages (/guilds/<realm>) and the realm list on /guilds, read from the
-- players table. Additive: one helper, one index and two functions. Apply after 20261025120000_guilds.sql. Until it
-- is applied the site shows its "unreachable" line on a realm page and leaves the realm list off /guilds. The owner
-- runs this: the site never applies a migration.
--
-- Both reads follow the guild search: visible rows only (the character hide and the guild hide, the same rules as
-- search_guilds), one row per realm and lower(guild), a hard row limit.

-- The realm's address segment, from its key: the slug guildSlug (kb/src/guilds.ts) writes for the key, apostrophes
-- dropped and every other run of characters outside a-z and 0-9 one hyphen. "mal'ganis" is "malganis",
-- "forever pioneer" is "forever-pioneer". The site writes realm links from the key the same way (realmPath).
create or replace function public.realm_slug(p_realm_key text)
returns text
language sql immutable set search_path = ''
as $$
  select btrim(regexp_replace(replace(p_realm_key, '''', ''), '[^a-z0-9]+', '-', 'g'), '-');
$$;
revoke all on function public.realm_slug(text) from public, anon, authenticated;
grant execute on function public.realm_slug(text) to service_role;

-- A realm page finds its rows by slug through this index, so an address naming no realm reads nothing.
create index if not exists players_realm_slug on public.players (ruleset, public.realm_slug(realm_key));

-- 1. Read, the realms: each realm with at least one visible guild, how many guilds and how many characters in a guild
-- were seen on it, most guilds first, at most 200 rows. The realm is spelled as one of its rows spells it. The site
-- lists only realms past a minimum, so a few rows under made-up realm names cannot fill the list.
create or replace function public.guild_realms(p_ruleset text)
returns table (realm text, guilds bigint, characters bigint)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select min(p.realm) as realm, count(distinct lower(p.guild)) as guilds, count(*) as characters
  from public.players p
  where p.ruleset = p_ruleset and p.guild is not null
    and not exists (select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = p.realm_key and s.character = p.name_key)
    and not exists (select 1 from public.guild_suppressions g where g.realm_key = p.realm_key and g.guild_key = lower(p.guild))
  group by p.realm_key
  order by count(distinct lower(p.guild)) desc, p.realm_key
  limit 200;
$$;
revoke all on function public.guild_realms(text) from public, anon, authenticated;
grant execute on function public.guild_realms(text) to service_role;

-- 2. Read, one realm's guilds by the realm's slug: one row per guild with how many characters were seen in it and the
-- newest day, most members first, then name order, at most 1000 rows. Two realm keys with one slug (rare: they differ
-- only in characters the slug drops) read as the one with more rows, never as a mix.
create or replace function public.realm_guilds(p_ruleset text, p_realm_slug text, p_limit integer)
returns table (realm text, guild text, members bigint, last_seen date)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  with chosen as (
    select p.realm_key from public.players p
    where p.ruleset = p_ruleset and public.realm_slug(p.realm_key) = p_realm_slug
    group by p.realm_key
    order by count(*) desc, p.realm_key
    limit 1
  )
  select min(p.realm) as realm, min(p.guild) as guild, count(*) as members, max(p.last_seen) as last_seen
  from public.players p join chosen c on c.realm_key = p.realm_key
  where p.ruleset = p_ruleset and p.guild is not null
    and not exists (select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = p.realm_key and s.character = p.name_key)
    and not exists (select 1 from public.guild_suppressions g where g.realm_key = p.realm_key and g.guild_key = lower(p.guild))
  group by lower(p.guild)
  order by count(*) desc, lower(p.guild)
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;
revoke all on function public.realm_guilds(text, text, integer) from public, anon, authenticated;
grant execute on function public.realm_guilds(text, text, integer) to service_role;
notify pgrst, 'reload schema';

-- Readback (run by hand after applying): select * from public.guild_realms('forever');
-- Rollback (run by hand; no row is touched):
--   drop function if exists public.realm_guilds(text, text, integer);
--   drop function if exists public.guild_realms(text);
--   drop index if exists public.players_realm_slug;
--   drop function if exists public.realm_slug(text);
--   notify pgrst, 'reload schema';
