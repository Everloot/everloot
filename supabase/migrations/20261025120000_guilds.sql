-- Guilds as a ladder (docs/design/specs/2026-10-24-guild-board-design.md, section 6): the seen roster and the
-- guild search, read from the players table, and a guild hide. Additive: one index, one table and five functions.
-- Apply after 20261022160000_players_realm_key.sql and before setting EVERLOOT_GUILDS=1; until then the site never
-- calls anything here. The owner runs this: the site never applies a migration.
--
-- A guild is (ruleset, realm_key, lower(guild)). Its seen roster is every visible player row with that guild on
-- that realm, newest first: characters the addon saw in the guild, not the game's member list. A guild hidden
-- through guild_suppressions leaves both reads at once; its characters keep their own rows and pages, which the
-- character hide form governs. The kill rows live in the upload corpus, not here.

create index if not exists players_guild on public.players (ruleset, realm_key, lower(guild));

create table if not exists public.guild_suppressions (
  realm_key text not null check (realm_key = public.link_realm_key(realm_key) and char_length(realm_key) between 2 and 40),
  guild_key text not null check (char_length(guild_key) between 2 and 24),
  created_at timestamptz not null default now(),
  primary key (realm_key, guild_key)
);
alter table public.guild_suppressions enable row level security;
revoke all on public.guild_suppressions from public, anon, authenticated, service_role;
-- The nightly backup reads every table with the server's key (20261023130000_players_backup_read.sql).
grant select on public.guild_suppressions to service_role;

-- 1. Read, the seen roster: the visible rows with that guild on that realm (the same suppression rule as
-- search_players), newest last_seen first, at most 500. The realm is compared as one key, so the page address
-- finds the guild however the realm is spelled.
create or replace function public.guild_members(p_ruleset text, p_realm_key text, p_guild_key text)
returns table (name text, realm text, ruleset text, race text, class text, level smallint, guild text, last_seen date)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select p.name, p.realm, p.ruleset, p.race, p.class, p.level, p.guild, p.last_seen
  from public.players p
  where p.ruleset = p_ruleset and p.realm_key = public.link_realm_key(p_realm_key) and lower(p.guild) = lower(btrim(p_guild_key))
    and not exists (select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = p.realm_key and s.character = p.name_key)
    and not exists (select 1 from public.guild_suppressions g where g.realm_key = p.realm_key and g.guild_key = lower(p.guild))
  order by p.last_seen desc, p.name_key
  limit 500;
$$;
revoke all on function public.guild_members(text, text, text) from public, anon, authenticated;
grant execute on function public.guild_members(text, text, text) to service_role;

-- 2. Read, search: guilds whose name starts with a prefix of at least two letters, one row per realm and guild
-- with how many characters were seen in it and the newest day, at most 25 rows, in name order.
create or replace function public.search_guilds(p_prefix text, p_limit integer)
returns table (realm text, guild text, members bigint, last_seen date)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select min(p.realm) as realm, min(p.guild) as guild, count(*) as members, max(p.last_seen) as last_seen
  from public.players p
  where char_length(btrim(p_prefix)) >= 2 and p_prefix ~ '^[^%_\\]+$'
    and p.guild is not null and lower(p.guild) like lower(btrim(p_prefix)) || '%'
    and not exists (select 1 from public.character_suppressions s where public.link_realm_key(s.realm) = p.realm_key and s.character = p.name_key)
    and not exists (select 1 from public.guild_suppressions g where g.realm_key = p.realm_key and g.guild_key = lower(p.guild))
  group by p.realm_key, lower(p.guild)
  order by lower(p.guild), p.realm_key
  limit least(greatest(coalesce(p_limit, 25), 1), 25);
$$;
revoke all on function public.search_guilds(text, integer) from public, anon, authenticated;
grant execute on function public.search_guilds(text, integer) to service_role;

-- 3. Hide a guild. Safe to repeat. Anyone may ask; undoing it is the owner's tool. The characters' rows stay:
-- a character leaves through the character hide form.
create or replace function public.suppress_guild(p_realm text, p_guild text)
returns void
language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
begin
  if p_realm is null or p_guild is null or char_length(btrim(p_realm)) not between 2 and 40 or char_length(btrim(p_guild)) not between 2 and 24 then
    raise exception 'Invalid guild';
  end if;
  insert into public.guild_suppressions (realm_key, guild_key)
    values (public.link_realm_key(p_realm), lower(btrim(p_guild))) on conflict do nothing;
end;
$$;
revoke all on function public.suppress_guild(text, text) from public, anon, authenticated;
grant execute on function public.suppress_guild(text, text) to service_role;

-- 4. Every hidden guild, so the ladder and the directory (built from the upload corpus) can leave them out too.
create or replace function public.hidden_guilds()
returns table (realm_key text, guild_key text)
language sql stable security definer set search_path = '' set lock_timeout = '3s'
as $$
  select g.realm_key, g.guild_key from public.guild_suppressions g order by g.realm_key, g.guild_key;
$$;
revoke all on function public.hidden_guilds() from public, anon, authenticated;
grant execute on function public.hidden_guilds() to service_role;
notify pgrst, 'reload schema';

-- Lift a guild hide by hand (the owner's tool): delete from public.guild_suppressions where realm_key = '<realm key>' and guild_key = '<guild, lower case>';
-- Rollback (run by hand; the players table and its rows are untouched):
--   drop function if exists public.hidden_guilds();
--   drop function if exists public.suppress_guild(text, text);
--   drop function if exists public.search_guilds(text, integer);
--   drop function if exists public.guild_members(text, text, text);
--   drop table if exists public.guild_suppressions;
--   drop index if exists public.players_guild;
--   notify pgrst, 'reload schema';
