-- Disposable database with armory and character-link migrations applied. Invented identities only.
begin;
insert into public.users(id) values('10000000-0000-4000-8000-000000000001');
insert into public.character_links(id,user_id,link_key,ruleset,realm_key,name_key,realm,name,race,class,faction,level,completion_ref)
values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',repeat('a',64),'forever','us1 realm 4 pvp','ember','US1 Realm 4 PvP','Ember','Troll','WARLOCK','Horde',26,repeat('b',64));
insert into public.character_visibility(link_id) values('20000000-0000-4000-8000-000000000001');

select public.armory_upsert_characters('us','[{"slug":"ember-vale","character_id":9001,"name":"Ember","surname":"Vale","level":26,"ruleset_id":1,"ruleset":"PvP","race_id":8,"race":"Troll","class_id":9,"class":"Warlock","faction":"Horde","equipment":[],"details":{"revision":1,"statistics":{"asOf":"2026-11-12T12:00:00.000Z","rows":[{"label":"Intellect","value":69,"percent":false}]}}}]');

do $$ begin
  if (select details->'statistics'->'rows'->0->>'value' from public.armory_character('us','ember-vale'))<>'69' then raise exception 'details not stored'; end if;
  if exists(select 1 from public.armory_take('us','character',100) where slug='ember-vale') then raise exception 'fresh profile requeued'; end if;
  if public.armory_refresh('us','ember-vale')<>'cooldown' then raise exception 'fresh refresh bypass'; end if;
  if public.armory_refresh('us','missing-person')<>'unavailable' then raise exception 'unknown refresh'; end if;
  if public.armory_associate('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','us','ember-vale') then raise exception 'other account associated'; end if;
  if not public.armory_associate('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','us','ember-vale') then raise exception 'matching profile refused'; end if;
  if not exists(select 1 from public.armory_own_links('10000000-0000-4000-8000-000000000001')) then raise exception 'own association missing'; end if;
  if exists(select 1 from public.armory_public_link('us','ember-vale')) then raise exception 'private association leaked'; end if;
end $$;

update public.character_visibility set page_public=true;
do $$ begin
  if not exists(select 1 from public.armory_public_link('us','ember-vale')) then raise exception 'public association missing'; end if;
end $$;
update public.armory_characters set checked_at=now()-interval '2 days';
do $$ begin
  if not exists(select 1 from public.armory_take('us','character',100) where slug='ember-vale') then raise exception 'linked character automatic refresh missing'; end if;
end $$;
update public.armory_characters set checked_at=now();
update public.character_links set status='frozen';
do $$ begin
  if exists(select 1 from public.armory_public_link('us','ember-vale')) then raise exception 'frozen association leaked'; end if;
  if public.armory_associate('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','us','ember-vale') then raise exception 'frozen link associated'; end if;
end $$;
update public.character_links set status='linked';
update public.armory_characters set class='Mage';
do $$ begin
  if public.armory_associate('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','us','ember-vale') then raise exception 'class mismatch associated'; end if;
  if exists(select 1 from public.armory_public_link('us','ember-vale')) then raise exception 'mismatched public identity'; end if;
end $$;
update public.armory_characters set class='Warlock',checked_at=now()-interval '2 hours';
do $$ begin
  if public.armory_refresh('us','ember-vale')<>'queued' then raise exception 'stale refresh failed'; end if;
  if public.armory_refresh('us','ember-vale')<>'queued-already' then raise exception 'duplicate refresh'; end if;
end $$;
delete from public.armory_queue;
update public.armory_characters set details='{}',checked_at=now();
do $$ begin
  if not exists(select 1 from public.armory_take('us','character',100) where slug='ember-vale') then raise exception 'legacy detail backfill missing'; end if;
end $$;

insert into public.character_suppressions(realm,character) values('US1 Realm 4 PvP','ember');
do $$ begin
  if exists(select 1 from public.armory_public_link('us','ember-vale')) then raise exception 'suppression leaked'; end if;
end $$;
delete from public.character_suppressions;
select public.armory_hide('us','ember-vale');
do $$ begin
  if exists(select 1 from public.armory_links) then raise exception 'hide retained association'; end if;
  if public.armory_refresh('us','ember-vale')<>'unavailable' then raise exception 'hide refresh bypass'; end if;
end $$;

-- The same named-upload path discovers the uploader and nearby players without guessing a surname.
select public.upsert_players_armory('forever',jsonb_build_array(
  jsonb_build_object('name','Nova','surname','Stone','realm','US1 Realm 4 PvP','race','Troll','class','WARLOCK','level',26,'seen',current_date),
  jsonb_build_object('name','Nova','surname','Vale','realm','US1 Realm 4 PvP','race','Troll','class','WARLOCK','level',26,'seen',current_date),
  jsonb_build_object('name','Legacy','realm','US1 Realm 4 PvP','race','Troll','class','WARLOCK','level',26,'seen',current_date),
  jsonb_build_object('name','Unknown','surname','Region','realm','Forever Pioneer','race','Troll','class','WARLOCK','level',26,'seen',current_date)
));
do $$ begin
  if (select count(*) from public.armory_queue where source='addon')<>2 then raise exception 'full-name discovery missing or guessed'; end if;
  if not exists(select 1 from public.armory_queue where slug='nova-stone' and addon_seen=current_date) then raise exception 'observation date missing'; end if;
  if exists(select 1 from public.players where name_key='nova') then raise exception 'full surnames collapsed into a legacy first-name sighting'; end if;
  if not exists(select 1 from public.players where name_key='legacy') then raise exception 'legacy sighting lost'; end if;
end $$;
select public.armory_upsert_characters('us','[{"slug":"nova-stone","character_id":9002,"name":"Nova","surname":"Stone","level":26,"ruleset_id":1,"ruleset":"PvP","race_id":8,"race":"Troll","class_id":9,"class":"Warlock","faction":"Horde","equipment":[],"details":{"revision":1}}]');
do $$ begin
  if not exists(select 1 from public.armory_character('us','nova-stone') where addon_seen=current_date) then raise exception 'profile lost observation source'; end if;
end $$;
select public.armory_hide('us','nova-vale');
select public.upsert_players_armory('forever',jsonb_build_array(jsonb_build_object('name','Nova','surname','Vale','realm','US1 Realm 4 PvP','race','Troll','class','WARLOCK','level',26,'seen',current_date)));
do $$ begin
  if exists(select 1 from public.armory_queue where slug='nova-vale') then raise exception 'upload bypassed hide'; end if;
end $$;
update public.armory_characters set addon_seen=current_date-31;
update public.armory_characters set details=jsonb_build_object('revision',1,'statistics',jsonb_build_object('asOf',to_char(now() at time zone 'UTC'-interval '31 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'rows','[]'::jsonb));
select public.armory_purge();
do $$ begin
  if exists(select 1 from public.armory_characters where addon_seen is not null) then raise exception 'expired sighting retained'; end if;
  if exists(select 1 from public.armory_characters where details ? 'statistics') then raise exception 'expired optional section retained'; end if;
end $$;

do $$ declare r text; f regprocedure; begin
  if exists(select 1 from pg_roles where rolname='backup_exporter') then
    if not has_table_privilege('backup_exporter','public.armory_links','SELECT')
      or has_table_privilege('backup_exporter','public.armory_links','INSERT,UPDATE,DELETE') then raise exception 'association backup grants'; end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='armory_links' and policyname='backup_exporter_select' and cmd='SELECT') then raise exception 'association backup policy'; end if;
  end if;
  foreach r in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(r,'public.armory_links','SELECT,INSERT,UPDATE,DELETE') then raise exception 'direct association access %',r; end if;
  end loop;
  foreach f in array array['public.armory_refresh(text,text)'::regprocedure,'public.armory_associate(uuid,uuid,text,text)'::regprocedure,'public.armory_public_link(text,text)'::regprocedure,'public.armory_own_links(uuid)'::regprocedure] loop
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'public function access %',f; end if;
    if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'missing server access %',f; end if;
  end loop;
end $$;
rollback;
