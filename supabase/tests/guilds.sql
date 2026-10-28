-- Run after 20261007070647_verified_publication.sql, 20261021130000_players.sql, 20261022160000_players_realm_key.sql
-- and 20261025120000_guilds.sql on a disposable local PostgreSQL database that has the roles anon, authenticated
-- and service_role.
begin;

-- Only the server's role may call anything here; the suppressions table is closed to every API role.
do $$
declare role_name text; fn text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_table_privilege(role_name, 'public.guild_suppressions', 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception '% can touch guild_suppressions', role_name;
    end if;
    foreach fn in array array[
      'public.guild_members(text, text, text)', 'public.search_guilds(text, integer)', 'public.suppress_guild(text, text)', 'public.hidden_guilds()'
    ] loop
      if has_function_privilege(role_name, fn, 'EXECUTE') then raise exception '% can execute %', role_name, fn; end if;
    end loop;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.guild_suppressions'::regclass) then raise exception 'RLS disabled on guild_suppressions'; end if;
  if has_table_privilege('service_role', 'public.guild_suppressions', 'INSERT,UPDATE,DELETE') then raise exception 'server can write guild_suppressions directly'; end if;
  if not has_function_privilege('service_role', 'public.suppress_guild(text, text)', 'EXECUTE') then raise exception 'server cannot hide a guild'; end if;
end $$;

select public.upsert_players('forever', '[
  {"name":"Thrallina","realm":"Forever Pioneer","race":"Orc","class":"SHAMAN","level":25,"guild":"Night Watch","seen":"2026-10-21"},
  {"name":"Throgar","realm":"Forever Pioneer","race":"Orc","class":"WARRIOR","level":12,"guild":"night watch","seen":"2026-10-23"},
  {"name":"Hidden","realm":"Forever Pioneer","race":"Human","class":"MAGE","level":9,"guild":"Night Watch","seen":"2026-10-22"},
  {"name":"Loner","realm":"Forever Pioneer","race":"Orc","class":"WARRIOR","level":12,"seen":"2026-10-23"},
  {"name":"Elsewhere","realm":"Forever Nomad","race":"Orc","class":"HUNTER","level":30,"guild":"Night Watch","seen":"2026-10-20"},
  {"name":"Nimble","realm":"Forever Pioneer","race":"Gnome","class":"ROGUE","level":40,"guild":"Nightfall","seen":"2026-10-19"},
  {"name":"Quiet","realm":"Forever Pioneer","race":"Gnome","class":"MAGE","level":40,"guild":"Quiet Ones","seen":"2026-10-19"}
]'::jsonb);
select public.suppress_player('Forever Pioneer', 'Hidden');

-- the seen roster: the guild's visible characters on that realm, newest first, however the realm or guild is spelled
do $$
declare names text[];
begin
  select array_agg(m.name order by m.last_seen desc, m.name) into names from public.guild_members('forever', 'forever-pioneer', 'NIGHT WATCH') m;
  if names is distinct from array['Throgar', 'Thrallina'] then raise exception 'roster was %', names; end if;
  if (select count(*) from public.guild_members('forever', 'Forever Nomad', 'Night Watch')) <> 1 then raise exception 'realm not separated'; end if;
  if (select m.name from public.guild_members('forever', 'forever pioneer', 'night watch') m limit 1) <> 'Throgar' then raise exception 'newest not first'; end if;
  if exists (select 1 from public.guild_members('forever', 'forever-pioneer', 'Night Watch') m where m.name = 'Hidden') then raise exception 'suppressed character in roster'; end if;
end $$;

-- the search: one row per realm and guild, with how many were seen and the newest day; a prefix of two or more, no wildcards
do $$
declare hit record;
begin
  if (select count(*) from public.search_guilds('Night', 25)) <> 3 then raise exception 'prefix search found % rows', (select count(*) from public.search_guilds('Night', 25)); end if;
  select * into hit from public.search_guilds('night w', 25) s where s.realm = 'Forever Pioneer';
  if hit.members <> 2 or hit.last_seen <> date '2026-10-23' then raise exception 'grouping: % seen, newest %', hit.members, hit.last_seen; end if;
  if (select count(*) from public.search_guilds('N', 25)) <> 0 then raise exception 'one letter must find nothing'; end if;
  if (select count(*) from public.search_guilds('ni%', 25)) <> 0 then raise exception 'wildcard must find nothing'; end if;
  if (select count(*) from public.search_guilds('Night', 1)) <> 1 then raise exception 'limit ignored'; end if;
end $$;

-- a hidden guild leaves both reads at once, is listed for the ladder, and its characters keep their own rows
select public.suppress_guild('Forever-Pioneer', 'Night Watch');
select public.suppress_guild('forever pioneer', 'NIGHT WATCH');
do $$
begin
  if (select count(*) from public.guild_suppressions) <> 1 then raise exception 'hide not recorded once'; end if;
  if exists (select 1 from public.guild_members('forever', 'forever-pioneer', 'Night Watch')) then raise exception 'hidden guild still has a roster'; end if;
  if exists (select 1 from public.search_guilds('Night W', 25) s where s.realm = 'Forever Pioneer') then raise exception 'hidden guild still searched'; end if;
  if not exists (select 1 from public.search_guilds('Night W', 25) s where s.realm = 'Forever Nomad') then raise exception 'the same name on another realm was hidden too'; end if;
  if (select count(*) from public.hidden_guilds() h where h.realm_key = 'forever pioneer' and h.guild_key = 'night watch') <> 1 then raise exception 'hidden guild not listed'; end if;
  if not exists (select 1 from public.get_player('forever', 'forever-pioneer', 'thrallina')) then raise exception 'the character lost its page'; end if;
end $$;

-- a name that is not a guild's is refused
do $$
begin
  begin
    perform public.suppress_guild('Forever Pioneer', 'x');
    raise exception 'one-letter guild accepted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid guild' then raise; end if;
  end;
end $$;
rollback;
