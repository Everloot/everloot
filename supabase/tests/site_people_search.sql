-- Disposable database, all migrations applied, roles anon/authenticated/service_role present.
-- site_people_search answers the header type-ahead's characters and guilds in one read (#1271): armory characters by
-- first name, surname or full name, addon characters by name, armory guilds by name, each under the hide rule its own
-- search already has.
begin;

-- Invented fixtures.
select public.armory_upsert_characters('us', jsonb_build_array(
  jsonb_build_object('slug','volvik-morningstar','character_id',901,'name','Volvik','surname','Morningstar','level',31,
    'ruleset_id',1,'ruleset','PvP','race_id',1,'race','Human','class_id',1,'class','Warrior','faction','Alliance','equipment','[]'::jsonb),
  jsonb_build_object('slug','volvik-hushwood','character_id',903,'name','Volvik','surname','Hushwood','level',12,
    'ruleset_id',2,'ruleset','Normal','race_id',1,'race','Human','class_id',1,'class','Warrior','faction','Alliance','equipment','[]'::jsonb)));
select public.armory_hide('us','volvik-hushwood');
insert into public.armory_characters(region,slug,character_id,name,surname,level,ruleset_id,ruleset,race_id,race,class_id,class,faction,fetched_at,checked_at)
  values('us','volvik-hushwood',903,'Volvik','Hushwood',12,2,'Normal',1,'Human',1,'Warrior','Alliance',now(),now());
select public.upsert_players('forever', '[{"name":"Volvikar","realm":"Forever Pioneer","race":"Orc","class":"SHAMAN","level":24,"seen":"2026-11-20"}]'::jsonb);
insert into public.players values ('forever', 'forever pioneer', 'volvhide', 'Forever Pioneer', 'Volvhide', 'Orc', 'WARRIOR', 5, null, '2026-11-20');
insert into public.character_suppressions values ('forever pioneer', 'volvhide');
insert into public.armory_guilds(region,slug,guild_id,name,faction,ruleset_id,ruleset,member_count,fetched_at,checked_at) values
  ('us','volvik-guard',71,'Volvik Guard','Horde',1,'PvP',40,now(),now()),
  ('eu','volvik-guard',72,'Volvik Guard','Alliance',2,'Normal',12,now(),now()),
  ('us','volvik-veil',73,'Volvik Veil','Horde',1,'PvP',8,now(),now()),
  ('us','deleted',74,'DELETED','Horde',1,'PvP',0,now(),now());
-- A /guilds hide on a US realm hides the US guild of that name, not the EU one.
insert into public.guild_suppressions(realm_key,guild_key) values('camwow us1 realm 4 pvp','volvik veil');

do $$
declare
  f regprocedure := 'public.site_people_search(text,integer)'::regprocedure;
  got text[];
  q text;
begin
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'site_people_search is public'; end if;
  if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'server cannot search'; end if;
  if not (select prosecdef and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid=f) then raise exception 'unsafe site_people_search'; end if;

  -- One read: armory characters, addon characters and armory guilds, in that order; hidden ones out of all three.
  select array_agg(kind||'/'||source||'/'||coalesce(region,'-')||'/'||coalesce(slug,name) order by ordinality) into got
    from public.site_people_search('volvik',25) with ordinality;
  if got <> array['character/armory/us/volvik-morningstar','character/players/-/Volvikar','guild/armory/eu/volvik-guard','guild/armory/us/volvik-guard']
    then raise exception 'volvik rows %', got; end if;

  -- What a row carries: armory characters their class and faction, addon characters realm and ruleset, guilds faction and roster size.
  if not exists(select 1 from public.site_people_search('Volvik Morn',25) where kind='character' and surname='Morningstar' and class='Warrior'
      and faction='Alliance' and level=31 and ruleset='PvP') then raise exception 'armory character row'; end if;
  if not exists(select 1 from public.site_people_search('volvika',25) where source='players' and realm='Forever Pioneer' and ruleset='forever'
      and class='SHAMAN' and level=24) then raise exception 'addon character row'; end if;
  if not exists(select 1 from public.site_people_search('volvik g',25) where kind='guild' and region='us' and faction='Horde' and member_count=40)
    then raise exception 'guild row'; end if;

  -- Hidden and disbanded never come back, under any spelling.
  foreach q in array array['hushwood','volvh','volvik veil','deleted','  VOLVIK  '] loop
    if exists(select 1 from public.site_people_search(q,25) where slug in ('volvik-hushwood','deleted') or name='Volvhide' or (region='us' and slug='volvik-veil'))
      then raise exception 'hidden row for %', q; end if;
  end loop;

  -- Under two characters, wildcards and nulls read nothing; the limit applies to each kind, capped at 25.
  foreach q in array array['v','',' v ','vo%','v_lv','vo\'] loop
    if exists(select 1 from public.site_people_search(q,25)) then raise exception 'rows for %', q; end if;
  end loop;
  if exists(select 1 from public.site_people_search(null,25)) then raise exception 'rows for null'; end if;
  if (select count(*) from public.site_people_search('volvik',1)) <> 3 then raise exception 'limit is per kind'; end if;
  if (select count(*) from public.site_people_search('volvik',0)) <> 0 then raise exception 'limit 0'; end if;
end $$;

rollback;
