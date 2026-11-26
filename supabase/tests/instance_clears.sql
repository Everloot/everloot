-- Disposable local database only, after all migrations. Never run against production. Invented identities only.
begin;
insert into public.users (id, bnet_id, battletag) values
 ('00000000-0000-4000-8000-0000000000c2', 'clears-a', 'Clears#1');
insert into public.character_links (id,user_id,link_key,ruleset,realm_key,name_key,realm,name,race,class,faction,level,completion_ref) values
 ('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000c2',repeat('4',64),'forever','us pve','mira','US PvE','Mira','Human','MAGE','Alliance',60,repeat('d',64)),
 ('40000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-0000000000c2',repeat('5',64),'forever','us pve','tavi','US PvE','Tavi','Human','MAGE','Alliance',60,repeat('e',64));
select public.armory_upsert_characters('us','[
 {"slug":"mira-dawn","character_id":9101,"name":"Mira","surname":"Dawn","level":60,"ruleset_id":2,"ruleset":"PvE","race_id":1,"race":"Human","class_id":8,"class":"Mage","faction":"Alliance","equipment":[]},
 {"slug":"tavi-reed","character_id":9102,"name":"Tavi","surname":"Reed","level":60,"ruleset_id":2,"ruleset":"PvE","race_id":1,"race":"Human","class_id":8,"class":"Mage","faction":"Alliance","equipment":[]}]');
insert into public.armory_links(link_id,region,slug) values
 ('40000000-0000-4000-8000-000000000001','us','mira-dawn'),('40000000-0000-4000-8000-000000000002','us','tavi-reed');
create function pg_temp.check_it(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;

set role service_role;
select pg_temp.check_it(public.sync_boss_kills('00000000-0000-4000-8000-0000000000c2','forever','US PvE','Mira',repeat('a',64),'2026-11-20T00:00:00Z',
 '[{"encounterId":2748,"instanceMapId":33,"difficulty":1,"firstKillAt":"2026-11-18T00:00:00Z","lastKillAt":"2026-11-20T00:00:00Z","killCount":3},
   {"encounterId":2749,"instanceMapId":34,"difficulty":1,"firstKillAt":"2026-11-19T00:00:00Z","lastKillAt":"2026-11-19T00:00:00Z","killCount":1}]')='stored','first history stored');
select pg_temp.check_it(public.sync_boss_kills('00000000-0000-4000-8000-0000000000c2','forever','US PvE','Tavi',repeat('b',64),'2026-11-21T00:00:00Z',
 '[{"encounterId":2748,"instanceMapId":33,"difficulty":1,"firstKillAt":"2026-11-21T00:00:00Z","lastKillAt":"2026-11-21T00:00:00Z","killCount":1}]')='stored','second history stored');

-- Newest kill here first; only this instance's kills; the armory's name and surname; nothing account-shaped.
select pg_temp.check_it((select array_agg(slug order by ord)=array['tavi-reed','mira-dawn'] from
  (select slug,row_number() over () as ord from public.public_instance_clears(33)) r),'newest kill first');
select pg_temp.check_it((select kills='[{"encounterId":2748,"instanceMapId":33,"difficulty":1,"firstKillAt":"2026-11-18T00:00:00Z","lastKillAt":"2026-11-20T00:00:00Z","killCount":3}]'::jsonb
  and name='Mira' and surname='Dawn' from public.public_instance_clears(33) where slug='mira-dawn'),'only this instance''s kills, with the armory name');
select pg_temp.check_it((select count(*)=1 from public.public_instance_clears(34)),'another instance lists its own killers');
select pg_temp.check_it((select count(*)=0 from public.public_instance_clears(35)),'an instance nobody killed in is empty');
reset role;

-- Every public_boss_kills rule applies: hides, suppressions, frozen links and stale associations.
insert into public.armory_hides(region,slug) values('us','mira-dawn');
select pg_temp.check_it((select array_agg(slug)=array['tavi-reed'] from public.public_instance_clears(33)),'a hidden character is left out');
delete from public.armory_hides;
insert into public.character_suppressions values('us pve','mira');
select pg_temp.check_it((select array_agg(slug)=array['tavi-reed'] from public.public_instance_clears(33)),'a suppressed character is left out');
delete from public.character_suppressions;
update public.character_links set status='frozen' where name_key='mira';
select pg_temp.check_it((select array_agg(slug)=array['tavi-reed'] from public.public_instance_clears(33)),'a frozen link is left out');
update public.character_links set status='linked' where name_key='mira';
update public.armory_characters set class='Warrior' where slug='mira-dawn';
select pg_temp.check_it((select array_agg(slug)=array['tavi-reed'] from public.public_instance_clears(33)),'a stale association attaches no history');
update public.armory_characters set class='Mage' where slug='mira-dawn';

select pg_temp.check_it(has_function_privilege('service_role','public.public_instance_clears(integer)','EXECUTE'),'the server reads');
select pg_temp.check_it(not has_function_privilege('anon','public.public_instance_clears(integer)','EXECUTE'),'anon cannot call it');
select pg_temp.check_it(not has_function_privilege('authenticated','public.public_instance_clears(integer)','EXECUTE'),'signed-in clients cannot call it');
rollback;
