-- Run after every migration up to 20261117130000_site_reads_armory.sql on a disposable database. Invented identities
-- only. Everything is rolled back at the end.
begin;
insert into public.users(id) values('10000000-0000-4000-8000-000000000002');
insert into public.character_links(id,user_id,link_key,ruleset,realm_key,name_key,realm,name,race,class,faction,level,completion_ref)
values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',repeat('e',64),'forever','us1 realm 4 pvp','nova','US1 Realm 4 PvP','Nova','Troll','WARLOCK','Horde',26,repeat('f',64));
insert into public.character_visibility(link_id,page_public,show_gear,show_stats,show_collections) values('20000000-0000-4000-8000-000000000002',true,true,false,true);
select public.armory_upsert_characters('us','[{"slug":"nova-vale","character_id":9002,"name":"Nova","surname":"Vale","level":26,"ruleset_id":1,"ruleset":"PvP","race_id":8,"race":"Troll","class_id":9,"class":"Warlock","faction":"Horde","equipment":[],"details":{"revision":1}}]');

do $$ begin
  if exists(select 1 from public.public_character_armory('forever','us1-realm-4-pvp','Nova')) then raise exception 'unassociated character read'; end if;
  if not public.armory_associate('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','us','nova-vale') then raise exception 'association refused'; end if;
  if not exists(select 1 from public.public_character_armory('forever','us1-realm-4-pvp','Nova') where region='us' and slug='nova-vale' and show_gear and not show_stats and show_collections) then raise exception 'public armory read missing'; end if;
end $$;
update public.character_visibility set page_public=false where link_id='20000000-0000-4000-8000-000000000002';
do $$ begin
  if exists(select 1 from public.public_character_armory('forever','us1-realm-4-pvp','Nova')) then raise exception 'private page read'; end if;
end $$;
update public.character_visibility set page_public=true where link_id='20000000-0000-4000-8000-000000000002';
update public.character_links set status='frozen' where id='20000000-0000-4000-8000-000000000002';
do $$ begin
  if exists(select 1 from public.public_character_armory('forever','us1-realm-4-pvp','Nova')) then raise exception 'frozen link read'; end if;
end $$;
update public.character_links set status='linked' where id='20000000-0000-4000-8000-000000000002';
select public.armory_hide('us','nova-vale');
do $$ begin
  if exists(select 1 from public.public_character_armory('forever','us1-realm-4-pvp','Nova')) then raise exception 'hidden armory character read'; end if;
end $$;

do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if has_function_privilege(r,'public.public_character_armory(text,text,text)','EXECUTE') then raise exception 'public access %',r; end if;
  end loop;
  if not has_function_privilege('service_role','public.public_character_armory(text,text,text)','EXECUTE') then raise exception 'missing server access'; end if;
end $$;

-- The retired categories cannot be stored again.
do $$ begin
  begin
    insert into public.character_sync_consent(link_id,category) values('20000000-0000-4000-8000-000000000002','gear');
    raise exception 'retired consent stored';
  exception when check_violation then null;
  end;
  begin
    insert into public.character_facts(link_id,category,captured_at,data,data_hash,source_ref) values('20000000-0000-4000-8000-000000000002','stats',now(),'{}',repeat('c',64),repeat('d',64));
    raise exception 'retired fact stored';
  exception when check_violation then null;
  end;
end $$;
rollback;
