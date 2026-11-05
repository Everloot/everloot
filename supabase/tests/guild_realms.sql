-- Run after 20261007070647_verified_publication.sql, 20261021130000_players.sql, 20261022160000_players_realm_key.sql,
-- 20261025120000_guilds.sql and 20261105120000_guild_realms.sql on a disposable local PostgreSQL database that has the
-- roles anon, authenticated and service_role.
begin;

-- Only the server's role may call the reads and the slug helper.
do $$
declare role_name text; fn text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach fn in array array['public.guild_realms(text)', 'public.realm_guilds(text, text, integer)', 'public.realm_slug(text)'] loop
      if has_function_privilege(role_name, fn, 'EXECUTE') then raise exception '% can execute %', role_name, fn; end if;
    end loop;
  end loop;
  foreach fn in array array['public.guild_realms(text)', 'public.realm_guilds(text, text, integer)'] loop
    if not has_function_privilege('service_role', fn, 'EXECUTE') then raise exception 'server cannot execute %', fn; end if;
  end loop;
end $$;

-- the slug is the one the site writes (guildSlug of the realm key)
do $$
begin
  if public.realm_slug('forever pioneer') <> 'forever-pioneer' then raise exception 'slug of a two-word realm'; end if;
  if public.realm_slug('mal''ganis') <> 'malganis' then raise exception 'slug keeps the apostrophe'; end if;
  if public.realm_slug(public.link_realm_key('Mal’Ganis')) <> 'malganis' then raise exception 'curly apostrophe slug'; end if;
end $$;

select public.upsert_players('forever', '[
  {"name":"Thrallina","realm":"Forever Pioneer","race":"Orc","class":"SHAMAN","level":25,"guild":"Night Watch","seen":"2026-10-21"},
  {"name":"Throgar","realm":"Forever Pioneer","race":"Orc","class":"WARRIOR","level":12,"guild":"night watch","seen":"2026-10-23"},
  {"name":"Hidden","realm":"Forever Pioneer","race":"Human","class":"MAGE","level":9,"guild":"Quiet Ones","seen":"2026-10-22"},
  {"name":"Loner","realm":"Forever Pioneer","race":"Orc","class":"WARRIOR","level":12,"seen":"2026-10-23"},
  {"name":"Elsewhere","realm":"Forever Nomad","race":"Orc","class":"HUNTER","level":30,"guild":"Night Watch","seen":"2026-10-20"},
  {"name":"Nimble","realm":"Forever Pioneer","race":"Gnome","class":"ROGUE","level":40,"guild":"Nightfall","seen":"2026-10-19"},
  {"name":"Quiet","realm":"Forever Pioneer","race":"Gnome","class":"MAGE","level":40,"guild":"Quiet Ones","seen":"2026-10-19"},
  {"name":"Apostle","realm":"Mal’Ganis","race":"Human","class":"PRIEST","level":20,"guild":"Dawn","seen":"2026-10-19"}
]'::jsonb);
select public.suppress_player('Forever Pioneer', 'Hidden');
-- The hide deletes the row; put it back as an older write could have, so the reads' own filter is what keeps it out.
insert into public.players (ruleset, realm_key, name_key, realm, name, race, class, level, guild, last_seen)
  values ('forever', 'forever pioneer', 'hidden', 'Forever Pioneer', 'Hidden', 'Human', 'MAGE', 9, 'Quiet Ones', date '2026-10-22');

-- the realms: one row per realm, counting its visible guilds once whatever their spelling and its visible characters in
-- a guild; a character with no guild adds nothing; most guilds first
do $$
declare hit record;
begin
  if (select count(*) from public.guild_realms('forever')) <> 3 then raise exception 'realms: % rows', (select count(*) from public.guild_realms('forever')); end if;
  select * into hit from public.guild_realms('forever') r where r.realm = 'Forever Pioneer';
  if hit.guilds <> 3 or hit.characters <> 4 then raise exception 'Forever Pioneer has % guilds, % characters', hit.guilds, hit.characters; end if;
  if (select r.realm from public.guild_realms('forever') r limit 1) <> 'Forever Pioneer' then raise exception 'most guilds not first'; end if;
  if (select count(*) from public.guild_realms('other')) <> 0 then raise exception 'ruleset not separated'; end if;
end $$;

-- one realm's guilds by slug: most members first, then name; members and newest day per guild
do $$
declare names text[]; hit record;
begin
  select array_agg(lower(g.guild) order by g.members desc, lower(g.guild)) into names from public.realm_guilds('forever', 'forever-pioneer', 1000) g;
  if names is distinct from array['night watch', 'nightfall', 'quiet ones'] then raise exception 'realm guilds were %', names; end if;
  select * into hit from public.realm_guilds('forever', 'forever-pioneer', 1000) g where lower(g.guild) = 'night watch';
  if hit.members <> 2 or hit.last_seen <> date '2026-10-23' or hit.realm <> 'Forever Pioneer' then raise exception 'grouping: % seen, newest %, realm %', hit.members, hit.last_seen, hit.realm; end if;
  -- the hidden character's row is there, and still left out of its guild's count
  if not exists (select 1 from public.players where name_key = 'hidden') then raise exception 'test row missing'; end if;
  if (select g.members from public.realm_guilds('forever', 'forever-pioneer', 1000) g where g.guild = 'Quiet Ones') <> 1 then raise exception 'suppressed character counted'; end if;
  if (select count(*) from public.realm_guilds('forever', 'forever-nomad', 1000)) <> 1 then raise exception 'realm not separated'; end if;
  if (select g.guild from public.realm_guilds('forever', 'malganis', 1000) g) is distinct from 'Dawn' then raise exception 'apostrophe realm not found by slug'; end if;
  if (select count(*) from public.realm_guilds('forever', 'forever-pioneer', 1)) <> 1 then raise exception 'limit ignored'; end if;
  if (select count(*) from public.realm_guilds('forever', 'forever-pioneer', 100000)) <> 3 then raise exception 'limit above the cap'; end if;
  if (select count(*) from public.realm_guilds('forever', 'nowhere', 1000)) <> 0 then raise exception 'unknown realm has guilds'; end if;
  if (select count(*) from public.realm_guilds('forever', 'Forever Pioneer', 1000)) <> 0 then raise exception 'a name is not a slug'; end if;
end $$;

-- a hidden guild leaves both reads at once; the same name on another realm stays
select public.suppress_guild('Forever-Pioneer', 'Night Watch');
do $$
begin
  if exists (select 1 from public.realm_guilds('forever', 'forever-pioneer', 1000) g where lower(g.guild) = 'night watch') then raise exception 'hidden guild still listed'; end if;
  if (select r.guilds from public.guild_realms('forever') r where r.realm = 'Forever Pioneer') <> 2 then raise exception 'hidden guild still counted'; end if;
  if not exists (select 1 from public.realm_guilds('forever', 'forever-nomad', 1000) g where g.guild = 'Night Watch') then raise exception 'the same name on another realm was hidden too'; end if;
end $$;
rollback;
