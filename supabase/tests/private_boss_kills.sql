-- Disposable local database only, after all migrations. Never run against production.
begin;
insert into public.users (id, bnet_id, battletag) values
 ('00000000-0000-4000-8000-0000000000a2', 'boss-a', 'Alpha#1'),
 ('00000000-0000-4000-8000-0000000000b2', 'boss-b', 'Bravo#2');
insert into public.character_links (id,user_id,link_key,ruleset,realm_key,name_key,realm,name,race,class,faction,level,completion_ref) values
 ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000a2',repeat('1',64),'forever','forever pioneer','thrallina','Forever Pioneer','Thrallina','Orc','SHAMAN','Horde',60,repeat('c',64));
create function pg_temp.check_it(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; end $$;

do $$ declare r text; fn text; begin
 foreach r in array array['anon','authenticated','service_role'] loop
  perform pg_temp.check_it(not has_table_privilege(r,'public.character_boss_kills','SELECT,INSERT,UPDATE,DELETE'),r || ' table closed');
 end loop;
 perform pg_temp.check_it((select relrowsecurity from pg_class where oid='public.character_boss_kills'::regclass),'RLS enabled');
 perform pg_temp.check_it(has_table_privilege('backup_exporter','public.character_boss_kills','SELECT'),'backup reads');
 perform pg_temp.check_it(not has_table_privilege('backup_exporter','public.character_boss_kills','INSERT,UPDATE,DELETE'),'backup cannot write');
 foreach fn in array array['public.set_boss_kill_consent(uuid,uuid,boolean)',
  'public.sync_boss_kills(uuid,text,text,text,text,timestamptz,jsonb)','public.own_boss_kills(uuid,uuid)'] loop
  perform pg_temp.check_it(has_function_privilege('service_role',fn,'EXECUTE'),'server RPC');
  foreach r in array array['anon','authenticated','backup_exporter'] loop
   perform pg_temp.check_it(not has_function_privilege(r,fn,'EXECUTE'),r || ' RPC closed');
  end loop;
 end loop;
end $$;

-- Calls execute as the actual service role; its table grants remain revoked.
set local role service_role;
do $$ declare
 a constant uuid := '00000000-0000-4000-8000-0000000000a2';
 b constant uuid := '00000000-0000-4000-8000-0000000000b2';
 l constant uuid := '30000000-0000-4000-8000-000000000001';
 kills constant jsonb := '[{"encounterId":2916,"instanceMapId":48,"difficulty":1,"firstKillAt":"2026-11-01T10:00:00Z","lastKillAt":"2026-11-02T10:00:00Z","killCount":2}]';
 answer text;
begin
 perform pg_temp.check_it(public.own_boss_kills(b,l) is null,'other account reads nothing');
 perform pg_temp.check_it(public.set_boss_kill_consent(b,l,true)='not_found','other account cannot opt in');
 perform pg_temp.check_it(public.sync_boss_kills(b,'forever','forever pioneer','Thrallina',repeat('a',64),'2026-11-02T10:00:00Z',kills)='not_linked','other account cannot write');
 perform pg_temp.check_it(public.sync_boss_kills(a,'forever','forever pioneer','Thrallina',repeat('a',64),'2026-11-02T10:00:00Z',kills)='no_consent','opt in required');
 perform pg_temp.check_it(public.set_boss_kill_consent(a,l,true) is null,'owner opts in');
 perform pg_temp.check_it(public.sync_boss_kills(a,'forever','forever pioneer','Thrallina',repeat('a',64),'2026-11-02T10:00:00Z',kills)='stored','owner stores');
 perform pg_temp.check_it(public.sync_boss_kills(a,'forever','forever pioneer','Thrallina',repeat('a',64),'2026-11-02T10:00:00Z',kills)='duplicate','duplicate');
 perform pg_temp.check_it(public.sync_boss_kills(a,'forever','forever pioneer','Thrallina',repeat('a',64),'2026-11-03T10:00:00Z',kills)='stored','newer');
 perform pg_temp.check_it(public.sync_boss_kills(a,'forever','forever pioneer','Thrallina',repeat('a',64),'2026-11-02T10:00:00Z',kills)='older','older');
 perform pg_temp.check_it(public.own_boss_kills(a,l)->'kills'=kills,'owner reads exact kills');
 perform pg_temp.check_it(not (public.own_boss_kills(a,l) ? 'source_ref'),'source stays private');
 perform pg_temp.check_it(not exists(select from public.public_character_facts('forever','forever-pioneer','Thrallina')),'no public fact created');
 begin
  perform public.sync_boss_kills(a,'forever','forever pioneer','Thrallina',repeat('a',64),'2026-11-03T10:00:00Z',jsonb_build_array(kills->0 || '{"characterKey":"abcd1234"}'::jsonb));
  raise exception 'raw identity accepted';
 exception when raise_exception then if sqlerrm <> 'Invalid kills' then raise; end if; end;
 perform pg_temp.check_it(public.set_boss_kill_consent(a,l,false) is null,'withdraw consent');
 perform pg_temp.check_it(public.own_boss_kills(a,l)->'kills'='null'::jsonb,'withdrawal deletes kills');
end $$;
reset role;
-- Frozen links stop writes and reads, but withdrawal still works.
select public.set_boss_kill_consent('00000000-0000-4000-8000-0000000000a2','30000000-0000-4000-8000-000000000001',true);
update public.character_links set status='frozen' where id='30000000-0000-4000-8000-000000000001';
select pg_temp.check_it(public.set_boss_kill_consent('00000000-0000-4000-8000-0000000000a2','30000000-0000-4000-8000-000000000001',true)='frozen','frozen grant');
select pg_temp.check_it(public.own_boss_kills('00000000-0000-4000-8000-0000000000a2','30000000-0000-4000-8000-000000000001')->'kills'='null'::jsonb,'frozen read');
set local role backup_exporter;
select pg_temp.check_it((select count(*) from public.character_boss_kills)=1,'backup can read through RLS');
reset role;
delete from public.character_links where id='30000000-0000-4000-8000-000000000001';
select pg_temp.check_it(not exists(select from public.character_boss_kills),'unlink deletes history and consent');
rollback;
