-- Guilds by realm: the guild directory's realm pages (/guilds/<realm>) and the realm list on /guilds, read from the
-- players table. Additive: two functions, no table and no index (players_guild from 20261025120000_guilds.sql serves
-- both). Apply after 20261025120000_guilds.sql. Until it is applied the site shows its "unreachable" line on a realm
-- page and leaves the realm list off /guilds. The owner runs this: the site never applies a migration.
--
-- Both reads follow the guild search: visible rows only (the character hide and the guild hide, the same rules as
-- search_guilds), one row per realm and lower(guild), a hard row limit.

-- 1. Read, the realms: each realm with at least one visible guild and how many guilds were seen on it, in realm order,
-- at most 500 rows. The realm is spelled as one of its rows spells it.
create or replace function public.guild_realms(p_ruleset text)
returns table (realm text, guilds bigint)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select min(p.realm) as realm, count(distinct lower(p.guild)) as guilds
  from public.players p
  where p.ruleset = p_ruleset and p.guild is not null
    and not exists (select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = p.realm_key and s.character = p.name_key)
    and not exists (select 1 from public.guild_suppressions g where g.realm_key = p.realm_key and g.guild_key = lower(p.guild))
  group by p.realm_key
  order by p.realm_key
  limit 500;
$$;
revoke all on function public.guild_realms(text) from public, anon, authenticated;
grant execute on function public.guild_realms(text) to service_role;

-- 2. Read, one realm's guilds: one row per guild with how many characters were seen in it and the newest day, most
-- members first, then name order, at most 1000 rows. The realm is compared as one key, however it is spelled.
create or replace function public.realm_guilds(p_ruleset text, p_realm_key text, p_limit integer)
returns table (realm text, guild text, members bigint, last_seen date)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select min(p.realm) as realm, min(p.guild) as guild, count(*) as members, max(p.last_seen) as last_seen
  from public.players p
  where p.ruleset = p_ruleset and p.realm_key = public.link_realm_key(p_realm_key) and p.guild is not null
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
--   notify pgrst, 'reload schema';
