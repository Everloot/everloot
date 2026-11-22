-- Extends the disposable public-boss-kills fixture. Two characters share a first name and game traits.
insert into armory_characters(region,slug,name,class,faction,race,ruleset_id,surname)
values('us','mira-vale','Mira','Mage','Alliance','Human',2,'Vale');
set role service_role;
select pg_temp.check_it((select count(*)=2 from public.armory_match_candidates(
  '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001')),'owner sees both possible matches');
select pg_temp.check_it((select count(*)=0 from public.armory_match_candidates(
  '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001')),'another owner cannot read candidates');
select pg_temp.check_it(public.dungeon_progress_page('US PvE',0,array[33])->'rows'='[]','armory surnames alone never enter the feed');
select pg_temp.check_it(public.sync_dungeon_progress('00000000-0000-4000-8000-000000000002','forever','US PvE','Mira',repeat('a',64),
 '2026-11-18T01:00:00Z','[{"encounterId":2748,"instanceMapId":33,"difficulty":1,"firstKillAt":"2026-11-18T00:00:00Z","lastKillAt":"2026-11-18T00:00:00Z","killCount":1}]','Dawn')='duplicate','existing captures can add an observed surname');
select pg_temp.check_it((select array_agg(slug)=array['mira-dawn'] from public.armory_match_candidates(
  '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001')),'the owner capture resolves ambiguity');
select pg_temp.check_it(public.dungeon_progress_page('US PvE',0,array[33])->'rows'=
 '[{"name":"Mira","surname":"Dawn","kills":[{"instanceMapId":33,"encounterId":2748}]}]','feed is realm scoped, guildless and limited to observed identity and kills');
select pg_temp.check_it(public.dungeon_progress_page('EU PvE',0,array[33])->'rows'='[]','other realms are absent');
select pg_temp.check_it(public.dungeon_progress_page('US PvE',0,array[43])->'rows'=
 '[{"name":"Mira","surname":"Dawn","kills":[]}]','known zero is preserved');
reset role;
update armory_characters set surname='Wrong' where slug='mira-dawn';
select pg_temp.check_it(public.dungeon_progress_page('US PvE',0,array[33])->'rows'='[]','ambiguous identity is excluded');
update armory_characters set surname='Dawn' where slug='mira-dawn';
insert into armory_hides values('us','mira-dawn');
select pg_temp.check_it(public.dungeon_progress_page('US PvE',0,array[33])->'rows'='[]','an Armory hide filters the next read');
delete from armory_hides;
insert into character_suppressions values('US PvE','mira');
select pg_temp.check_it(public.dungeon_progress_page('US PvE',0,array[33])->'rows'='[]','a character suppression filters the next read');
delete from character_suppressions;
select pg_temp.check_it(not has_function_privilege('anon','public.dungeon_progress_page(text,integer,integer[])','EXECUTE'),'feed cannot be queried directly by public clients');
select pg_temp.check_it(not has_function_privilege('authenticated','public.armory_match_candidates(uuid,uuid)','EXECUTE'),'candidates are server only');
