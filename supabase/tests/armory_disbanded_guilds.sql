-- Disposable database with the guild directory and 20261118120000_armory_disbanded_guilds.sql applied. Invented identities only.
begin;

select public.armory_upsert_guild('us','{"slug":"oak-ring","guild_id":31,"name":"Oak Ring","faction":"Alliance","ruleset_id":1,"ruleset":"PvP","member_count":12}','[]');
-- Blizzard's record for a disbanded guild: the name "DELETED".
select public.armory_upsert_guild('us','{"slug":"old-ring","guild_id":32,"name":"DELETED","faction":"Alliance","ruleset_id":1,"ruleset":"PvP","member_count":0}','[]');
select public.armory_upsert_guild('eu','{"slug":"gone-band","guild_id":33,"name":"DELETED","faction":"Horde","ruleset_id":2,"ruleset":"Normal","member_count":0}','[]');

do $$
begin
  if exists(select 1 from public.armory_guild_directory(null,null,null,'members',100,0) where name='DELETED') then raise exception 'disbanded guild listed'; end if;
  if exists(select 1 from public.armory_guild_directory('DE',null,null,'members',100,0)) then raise exception 'disbanded guild found by name'; end if;
  if (select min(total) from public.armory_guild_directory(null,null,null,'members',100,0))<>1 then raise exception 'disbanded guild in the total'; end if;
  if (select sum(guilds) from public.armory_counts())<>1 then raise exception 'disbanded guild counted'; end if;
  -- The rows stay stored.
  if (select count(*) from public.armory_guilds where name='DELETED')<>2 then raise exception 'rows removed'; end if;
end $$;
rollback;
