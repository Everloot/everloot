-- Run after every migration up to 20261121100000_armory_play_history.sql on a disposable database. Invented identities
-- only. Everything is rolled back at the end.
begin;
select public.armory_upsert_characters('eu', '[
 {"slug":"xelra-fable","character_id":821,"name":"Xelra","surname":"Fable","level":60,"ruleset_id":1,"ruleset":"PvP","race_id":1,"race":"Human","class_id":8,"class":"Mage","faction":"Alliance","last_login":"2026-11-17T00:00:00Z","equipment":[],
  "details":{"revision":1,"playHistory":{"asOf":"2026-11-20T00:00:00Z","groups":[],"ranked":{"quests":900,"fish":5,"creatures":10,"flights":1,"dungeons":2,"deaths":3}}}},
 {"slug":"zovra-fable","character_id":822,"name":"Zovra","surname":"Fable","level":60,"ruleset_id":1,"ruleset":"PvP","race_id":2,"race":"Orc","class_id":1,"class":"Warrior","faction":"Horde","last_login":"2026-11-18T00:00:00Z","equipment":[],
  "details":{"revision":1,"playHistory":{"asOf":"2026-11-20T00:00:00Z","groups":[],"ranked":{"quests":800,"fish":50}}}},
 {"slug":"nilra-fable","character_id":823,"name":"Nilra","surname":"Fable","level":60,"ruleset_id":1,"ruleset":"PvP","race_id":1,"race":"Human","class_id":5,"class":"Priest","faction":"Alliance","equipment":[],
  "details":{"revision":1,"playHistory":{"asOf":"2026-11-20T00:00:00Z","groups":[],"ranked":{"quests":"abc"}}}}
]'::jsonb);
insert into public.users(id,name,email) values('10000000-0000-4000-8000-000000000021','Fable','fable@users.everloot.invalid');
insert into public.character_links(id,user_id,link_key,ruleset,realm_key,name_key,realm,name,race,class,faction,level,completion_ref)
values('20000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000021',repeat('a',64),'forever','eu1 realm 1 pvp','xelra','EU1 Realm 1 PvP','Xelra','Human','MAGE','Alliance',60,repeat('b',64));
insert into public.character_visibility(link_id,page_public) values('20000000-0000-4000-8000-000000000021',true);

do $$
declare n integer; r record; m text;
begin
  -- A value that is not a JSON number is stored as null, never a failed write.
  select count(*) into n from public.armory_characters where region='eu' and slug='nilra-fable' and quests_completed is null;
  if n <> 1 then raise exception 'non-numeric ranked value not null'; end if;
  select count(*) into n from public.armory_board('quests_completed','eu',1::smallint,10);
  if n <> 2 then raise exception 'quests board size %', n; end if;
  select * into r from public.armory_board('quests_completed','eu',1::smallint,10) where rank=1;
  if r.slug is distinct from 'xelra-fable' or r.value is distinct from 900 then raise exception 'quests board order'; end if;
  select * into r from public.armory_board_filtered('fish_caught','eu',1::smallint,null,'Horde',10);
  if r.slug is distinct from 'zovra-fable' or r.value is distinct from 50 then raise exception 'filtered fish board'; end if;
  select count(*) into n from public.armory_board_top_per_class('fish_caught','eu',1::smallint);
  if n <> 2 then raise exception 'top per class fish'; end if;
  if not exists(select 1 from public.armory_rank('eu','zovra-fable') where metric='quests_completed' and rank=2 and "of"=2) then
    raise exception 'quests rank'; end if;
  foreach m in array array['quests_completed','creatures_killed','fish_caught','flight_paths','dungeons_entered','total_deaths'] loop
    if not exists(select 1 from public.armory_board(m,'eu',1::smallint,10) where slug='xelra-fable') then raise exception 'board % missing', m; end if;
    if not exists(select 1 from public.armory_rank('eu','xelra-fable') where metric=m) then raise exception 'rank % missing', m; end if;
  end loop;
  -- A hidden character leaves every board and its rank.
  insert into public.armory_hides(region,slug) values ('eu','xelra-fable');
  foreach m in array array['quests_completed','creatures_killed','fish_caught','flight_paths','dungeons_entered','total_deaths'] loop
    if exists(select 1 from public.armory_board(m,null,null,100) where slug='xelra-fable')
      or exists(select 1 from public.armory_board_filtered(m,null,null,null,null,100) where slug='xelra-fable') then raise exception 'hidden on %', m; end if;
  end loop;
  if exists(select 1 from public.armory_rank('eu','xelra-fable')) then raise exception 'hidden rank'; end if;
  delete from public.armory_hides where region='eu' and slug='xelra-fable';
  -- The show_history switch: off by default, set by the owner, returned with the public armory read.
  if not public.armory_associate('10000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000021','eu','xelra-fable') then
    raise exception 'association refused'; end if;
  if not exists(select 1 from public.public_character_armory('forever','eu1-realm-1-pvp','Xelra') where not show_history) then
    raise exception 'show_history default'; end if;
  if not public.set_visibility('10000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000021','{"show_history":true}') then
    raise exception 'set show_history refused'; end if;
  if not exists(select 1 from public.public_character_armory('forever','eu1-realm-1-pvp','Xelra') where show_history) then
    raise exception 'show_history not returned'; end if;
  if has_function_privilege('anon','public.public_character_armory(text,text,text)','EXECUTE')
    or not has_function_privilege('service_role','public.public_character_armory(text,text,text)','EXECUTE') then
    raise exception 'public_character_armory grants'; end if;
end $$;
rollback;
