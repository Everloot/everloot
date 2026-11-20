-- Disposable PGlite fixture only. All names are invented.
insert into character_links values ('00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002','linked','forever','us pve','mira','US PvE','Mira','MAGE','Alliance','Human');
insert into armory_links values ('00000000-0000-4000-8000-000000000001','us','mira-dawn');
insert into armory_characters values ('us','mira-dawn','Mira','Mage','Alliance','Human',2);
insert into armory_guilds values ('us','star-watch','Star Watch');
insert into armory_members values ('us','star-watch','mira-dawn');
create function pg_temp.check_it(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
set role service_role;
select pg_temp.check_it(public.sync_boss_kills('00000000-0000-4000-8000-000000000002','forever','US PvE','Mira',repeat('a',64),
 '2026-11-18T00:00:00Z','[{"encounterId":2748,"instanceMapId":33,"difficulty":1,"firstKillAt":"2026-11-18T00:00:00Z","lastKillAt":"2026-11-18T00:00:00Z","killCount":1}]')='stored','linked sync needs no separate consent');
select pg_temp.check_it((select count(*)=1 from public.public_boss_kills('[{"ruleset":"forever","realm":"US PvE","name":"Mira"}]')),'public identity read');
select pg_temp.check_it((select count(*)=1 from public.public_boss_kill_characters('us')),'regional roster read');
select pg_temp.check_it((select count(*)=0 from public.public_boss_kill_characters('eu')),'region filter');
select pg_temp.check_it((public.own_boss_kills('00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000001')->>'sync')::boolean,'legacy reader reports linked sync');
reset role;
select pg_temp.check_it(not has_table_privilege('service_role','character_boss_kills','SELECT'),'table stays closed');
do $$ declare f text; r text; begin
 foreach f in array array['public.public_boss_kills(jsonb)','public.public_boss_kill_characters(text)'] loop
  perform pg_temp.check_it(has_function_privilege('service_role',f,'EXECUTE'),'server reads');
  foreach r in array array['anon','authenticated'] loop
   perform pg_temp.check_it(not has_function_privilege(r,f,'EXECUTE'),'client RPC denied');
  end loop;
 end loop;
end $$;
-- A retired opt-out never blocks the standard linked sync. Keep same-second/stale protections.
select public.set_boss_kill_consent('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',false);
select pg_temp.check_it((public.own_boss_kills('00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000001')->>'sync')::boolean,'retired consent does not disable linked sync');
set role service_role;
do $$ declare k jsonb := '[{"encounterId":2748,"instanceMapId":33,"difficulty":1,"firstKillAt":"2026-11-18T00:00:00Z","lastKillAt":"2026-11-18T00:00:00Z","killCount":1}]';
begin
 perform pg_temp.check_it(public.sync_boss_kills('00000000-0000-4000-8000-000000000002','forever','US PvE','Mira',repeat('a',64),'2026-11-18T00:00:00Z',k)='stored','old opt-out cannot refuse sync');
 perform pg_temp.check_it(public.sync_boss_kills('00000000-0000-4000-8000-000000000002','forever','US PvE','Mira',repeat('a',64),'2026-11-18T00:00:00Z',k)='duplicate','duplicate retained');
 perform pg_temp.check_it(public.sync_boss_kills('00000000-0000-4000-8000-000000000002','forever','US PvE','Mira',repeat('a',64),'2026-11-18T01:00:00Z',k)='stored','new capture retained');
 perform pg_temp.check_it(public.sync_boss_kills('00000000-0000-4000-8000-000000000002','forever','US PvE','Mira',repeat('a',64),'2026-11-18T00:00:00Z',k)='older','stale capture refused');
 perform pg_temp.check_it(public.sync_boss_kills('00000000-0000-4000-8000-000000000003','forever','US PvE','Mira',repeat('a',64),'2026-11-18T01:00:00Z',k)='not_linked','other account cannot write');
end $$;
reset role;
update character_links set status='frozen';
select pg_temp.check_it((select count(*)=0 from public_boss_kills('[{"region":"us","slug":"mira-dawn"}]')),'frozen read');
update character_links set status='linked';
update armory_characters set class='Warrior';
select pg_temp.check_it((select count(*)=0 from public_boss_kill_characters('us')),'stale association cannot attach history to a different identity');
update armory_characters set class='Mage';
insert into armory_hides values('us','mira-dawn');
select pg_temp.check_it((select count(*)=0 from public_boss_kill_characters('us')),'hidden character excluded');
delete from armory_hides;
insert into character_suppressions values('US PvE','mira');
select pg_temp.check_it((select count(*)=0 from public_boss_kills('[{"region":"us","slug":"mira-dawn"}]')),'suppressed character excluded');
delete from character_suppressions;
insert into guild_suppressions values('us pve','star watch');
select pg_temp.check_it((select count(*)=0 from public_boss_kill_characters('us')),'hidden guild excluded');
delete from guild_suppressions;
update armory_guilds set name='DELETED';
select pg_temp.check_it((select count(*)=0 from public_boss_kill_characters('us')),'disbanded guild excluded');
update armory_guilds set name='Star Watch';
delete from armory_members;
select pg_temp.check_it((select count(*)=0 from public_boss_kill_characters('us')),'uploads never infer roster membership');
select pg_temp.check_it((select count(*)=1 from public_boss_kills('[{"region":"us","slug":"mira-dawn"}]')),'guildless character still public');
