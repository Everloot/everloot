-- Disposable database, all migrations applied, roles anon/authenticated/service_role present.
begin;

do $$
declare t text; f regprocedure; r text; n integer := 0;
begin
  foreach t in array array['armory_characters','armory_guilds','armory_members','armory_queue','armory_hides'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'RLS disabled: %', t; end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'direct table access: % %', r,t; end if;
    end loop;
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname like 'armory_%' loop
    n := n+1;
    foreach r in array array['anon','authenticated'] loop
      if has_function_privilege(r,f,'EXECUTE') then raise exception 'function access: % %',r,f; end if;
    end loop;
    if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'server cannot execute %',f; end if;
    if not (select prosecdef and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid=f) then raise exception 'unsafe function %',f; end if;
  end loop;
  if n <> 18 then raise exception 'expected 18 functions, got %', n; end if;
end $$;

-- Invented fixtures. Keep the original batch for the hide regression.
create temp table armory_fixture as select jsonb_build_array(
  jsonb_build_object('slug','xelra-fable','character_id',1,'name','Xelra','surname','Fable','level',60,
    'ruleset_id',1,'ruleset','PvP','race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance',
    'item_level',70,'gear_score',80,'honorable_kills',100,'last_login','2026-11-01T00:00:00Z',
    'equipment',jsonb_build_array(jsonb_build_object('slot','HEAD','item_id',123,'name','Test Hat','level',70,'quality','EPIC','inventory_type','HEAD'))),
  jsonb_build_object('slug','zovra-fable','character_id',2,'name','Zovra','surname','Fable','level',60,
    'ruleset_id',1,'ruleset','PvP','race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance',
    'item_level',60,'gear_score',70,'honorable_kills',90,'equipment','[]'::jsonb)
) as rows;

do $$
begin
  if not public.armory_enqueue('us','character','xelra-fable','submit') then raise exception 'enqueue'; end if;
  if public.armory_enqueue('us','character','xelra-fable','submit') then raise exception 'duplicate enqueue'; end if;
  if not exists(select 1 from public.armory_take('us','character',10) where slug='xelra-fable' and tries=0 and not stored) then raise exception 'take queue'; end if;
  if public.armory_upsert_characters('us',(select rows from armory_fixture)) <> 2 then raise exception 'upsert'; end if;
  if public.armory_upsert_characters('us',jsonb_build_array((select rows->0 from armory_fixture),(select rows->0 from armory_fixture)))<>1 then raise exception 'duplicate slug batch'; end if;
  if not exists(select 1 from public.armory_character('us','xelra-fable') where equipment->0->>'item_id'='123') then raise exception 'character equipment'; end if;
  if public.armory_enqueue('us','character','xelra-fable','submit') then raise exception 'fresh enqueue'; end if;
  if exists(select 1 from public.armory_queue where slug='xelra-fable') then raise exception 'queue not consumed'; end if;
  if not exists(select 1 from public.armory_board('item_level',null,null,10) where slug='xelra-fable' and rank=1 and value=70) then raise exception 'board'; end if;
  if (select count(*) from public.armory_rank('us','xelra-fable') where rank=1 and "of"=2) <> 3 then raise exception 'first ranks'; end if;
  if (select count(*) from public.armory_rank('us','zovra-fable') where rank=2 and "of"=2) <> 3 then raise exception 'second ranks'; end if;
  if public.armory_upsert_guild('us','{"slug":"fable-watch","guild_id":1,"name":"Fable Watch","faction":"Alliance","ruleset_id":1,"ruleset":"PvP","member_count":3}',
    '[{"character_slug":"xelra-fable","name":"Xelra","surname":"Fable","level":60,"class_id":8,"race_id":1,"rank":0},{"character_slug":"novra-fable","name":"Novra","surname":"Fable"},{"character_slug":"pevra-fable","name":"Pevra","surname":"Fable"},{"character_slug":"invalid!","name":"Invalid","surname":"Fable"}]') <> 2 then raise exception 'roster enqueue'; end if;
  if not exists(select 1 from public.armory_roster('us','fable-watch') where character_slug='xelra-fable' and stored and item_level=70) then raise exception 'roster join'; end if;
  if not exists(select 1 from public.armory_guild('us','fable-watch')) then raise exception 'guild read'; end if;
  if (select count(*) from public.armory_search('Xe',10))<>1 or exists(select 1 from public.armory_search('X',10)) or exists(select 1 from public.armory_search('Xe%',10)) then raise exception 'character search'; end if;
  if (select count(*) from public.armory_search_guilds('Fa',10))<>1 then raise exception 'guild search'; end if;
  if not exists(select 1 from public.armory_counts() where region='us' and ruleset_id=1 and characters=2 and guilds=1 and newest is not null) then raise exception 'counts'; end if;
end $$;

-- A stale stored roster member is queued and retains its stored marker.
update public.armory_characters set checked_at=now()-interval '21 days' where region='us' and slug='xelra-fable';
select public.armory_upsert_guild('us','{"slug":"fable-watch","guild_id":1,"name":"Fable Watch","faction":"Alliance","ruleset_id":1,"ruleset":"PvP","member_count":3}',
    '[{"character_slug":"xelra-fable","name":"Xelra","surname":"Fable","level":60,"class_id":8,"race_id":1,"rank":0},{"character_slug":"novra-fable","name":"Novra","surname":"Fable"},{"character_slug":"pevra-fable","name":"Pevra","surname":"Fable"},{"character_slug":"invalid!","name":"Invalid","surname":"Fable"}]');
do $$ begin
  if not exists(select 1 from public.armory_queue where region='us' and slug='xelra-fable' and source='roster') then raise exception 'stale roster not enqueued'; end if;
  if not exists(select 1 from public.armory_take('us','character',100) where slug='xelra-fable' and stored) then raise exception 'roster queue stored flag'; end if;
end $$;

select public.armory_hide('us','xelra-fable');
do $$
begin
  if public.armory_upsert_characters('us',jsonb_build_array((select rows->0 from armory_fixture))) <> 0 then raise exception 'hidden character rewritten'; end if;
  if exists(select 1 from public.armory_character('us','xelra-fable')) or exists(select 1 from public.armory_members where character_slug='xelra-fable') then raise exception 'hide left data'; end if;
  if public.armory_enqueue('us','character','xelra-fable','submit') then raise exception 'hidden enqueue'; end if;
end $$;

-- 404 removes stored membership too; queued guesses back off and stop after three.
insert into public.armory_members(region,guild_slug,character_slug,name,surname,fetched_at) values('us','fable-watch','zovra-fable','Zovra','Fable',now());
select public.armory_retry('us','character','zovra-fable',interval '0 seconds');
select public.armory_missing('us','character','zovra-fable');
select public.armory_enqueue('us','character','missing-fable','submit');
select public.armory_missing('us','character','missing-fable');
do $$ begin
  if exists(select 1 from public.armory_characters where slug='zovra-fable') or exists(select 1 from public.armory_members where character_slug='zovra-fable') then raise exception '404 left data'; end if;
  if exists(select 1 from public.armory_queue where region='us' and kind='character' and slug='zovra-fable') then raise exception 'stored 404 left queue'; end if;
  if not exists(select 1 from public.armory_queue where slug='missing-fable' and tries=1 and next_at=now()+interval '7 days') then raise exception '404 backoff'; end if;
end $$;
select public.armory_missing('us','character','missing-fable');
select public.armory_missing('us','character','missing-fable');
do $$ begin
  if not exists(select 1 from public.armory_queue where slug='missing-fable' and tries=3 and next_at=now()+interval '90 days') then raise exception 'third 404 tombstone'; end if;
  if exists(select 1 from public.armory_take('us','character',100) where slug='missing-fable') then raise exception 'dropped guess taken'; end if;
end $$;
-- An unconfirmed roster member is not a stored character; its 404 preserves the roster.
select public.armory_missing('us','character','novra-fable');
do $$ begin
  if not exists(select 1 from public.armory_members where character_slug='novra-fable') then raise exception 'guess 404 deleted roster'; end if;
end $$;

select public.armory_upsert_characters('eu', (select rows from armory_fixture));
update public.armory_characters set checked_at=now()-interval '21 days', fetched_at=now()-interval '31 days' where region='eu';
do $$ begin
  if not public.armory_enqueue('eu','character','xelra-fable','submit') then raise exception 'stale enqueue'; end if;
  if not exists(select 1 from public.armory_take('eu','character',1) where slug='xelra-fable' and stored) then raise exception 'queue before stale or stored flag'; end if;
end $$;
select public.armory_retry('eu','character','xelra-fable',interval '1 hour');
do $$ begin
  if exists(select 1 from public.armory_take('eu','character',10) where slug='xelra-fable') then raise exception 'retry bypassed by stale'; end if;
  if not exists(select 1 from public.armory_take('eu','character',10) where slug='zovra-fable' and stored) then raise exception 'stale take'; end if;
  if public.armory_touch('eu','character',array['zovra-fable'])<>1 then raise exception 'touch count'; end if;
  if not exists(select 1 from public.armory_characters where region='eu' and slug='zovra-fable' and checked_at=now()) then raise exception 'touch time'; end if;
end $$;
update public.armory_guilds set fetched_at=now()-interval '31 days';
do $$ begin
  perform public.armory_purge();
  if not exists(select 1 from public.armory_character('eu','zovra-fable')) then raise exception 'refreshed character purged'; end if;
  if exists(select 1 from public.armory_characters where slug='xelra-fable') or exists(select 1 from public.armory_members) then raise exception 'purge left data'; end if;
end $$;
select public.armory_missing('eu','character','zovra-fable');

select public.upsert_players('forever','[{"name":"Qevra","realm":"US Test","race":"Human","class":"MAGE","level":60,"guild":"Fable Seed","seen":"2026-11-08"},{"name":"Revra","realm":"EU Test","race":"Human","class":"MAGE","level":60,"guild":"Fable East","seen":"2026-11-08"},{"name":"Sevra","realm":"Unknown Test","race":"Human","class":"MAGE","level":60,"guild":"Fable Both","seen":"2026-11-08"},{"name":"Tevra","realm":"US Test","race":"Human","class":"MAGE","level":60,"guild":"Olympus","seen":"2026-11-08"},{"name":"Uevra","realm":"EU Test","race":"Human","class":"MAGE","level":60,"guild":"Éclat","seen":"2026-11-08"},{"name":"Vevra","realm":"US Test","race":"Human","class":"MAGE","level":60,"guild":"Invalid!","seen":"2026-11-08"}]');
do $$ begin
  if public.armory_seed_from_players()<>6 or public.armory_seed_from_players()<>0 then raise exception 'seed counts'; end if;
  if not exists(select 1 from public.armory_queue where region='us' and kind='guild' and slug='fable-seed') or exists(select 1 from public.armory_queue where region='eu' and slug='fable-seed') then raise exception 'seed region'; end if;
  if not exists(select 1 from public.armory_queue where region='us' and kind='guild' and slug='olympus') then raise exception 'single-word guild not seeded'; end if;
  if not exists(select 1 from public.armory_queue where region='eu' and kind='guild' and slug='éclat') then raise exception 'non-ASCII guild not seeded'; end if;
  if exists(select 1 from public.armory_queue where slug='invalid!') then raise exception 'invalid guild seeded'; end if;
end $$;

-- Three failed guild guesses remain tombstoned in both regions and cannot be reseeded.
select public.armory_missing(r,'guild','fable-both') from unnest(array['us','eu']) r;
select public.armory_missing(r,'guild','fable-both') from unnest(array['us','eu']) r;
select public.armory_missing(r,'guild','fable-both') from unnest(array['us','eu']) r;
do $$ begin
  if (select count(*) from public.armory_queue where kind='guild' and slug='fable-both' and tries=3 and next_at=now()+interval '90 days')<>2 then raise exception 'both-region tombstones'; end if;
  if public.armory_seed_from_players()<>0 then raise exception 'dropped guesses reseeded'; end if;
  if exists(select 1 from public.armory_take('us','guild',100) where slug='fable-both') or exists(select 1 from public.armory_take('eu','guild',100) where slug='fable-both') then raise exception 'dropped guild taken'; end if;
end $$;
update public.armory_queue set added_at=now()-interval '31 days' where slug='fable-both';
do $$ begin
  if public.armory_purge()<>0 then raise exception 'quarter tombstones purged early'; end if;
end $$;
update public.armory_queue set added_at=now()-interval '91 days' where slug='fable-both';
do $$ begin
  if public.armory_purge()<>2 then raise exception 'old tombstones not purged'; end if;
  if public.armory_seed_from_players()<>2 then raise exception 'quarter reseed'; end if;
end $$;

-- The shared slug format applies to stored characters/guilds and hide records as well as seeds.
do $$
begin
  if public.armory_upsert_characters('us',jsonb_build_array((select rows->0 from armory_fixture) || '{"slug":"évara"}'::jsonb))<>1 then raise exception 'single-word non-ASCII character'; end if;
  if public.armory_upsert_guild('us','{"slug":"olympus","guild_id":2,"name":"Olympus","faction":"Alliance","ruleset_id":1,"ruleset":"PvP"}','[]')<>0 then raise exception 'single-word guild write'; end if;
  if public.armory_upsert_guild('eu','{"slug":"éclat","guild_id":3,"name":"Éclat","faction":"Alliance","ruleset_id":1,"ruleset":"PvP"}','[]')<>0 then raise exception 'non-ASCII guild write'; end if;
  perform public.armory_hide('us','évara');
  if exists(select 1 from public.armory_character('us','évara')) then raise exception 'non-ASCII hide'; end if;
  perform public.armory_missing('us','guild','olympus');
  perform public.armory_missing('eu','guild','éclat');
  begin
    perform public.armory_enqueue('us','guild','Olympus','submit');
    raise exception 'uppercase slug accepted';
  exception when check_violation then null; end;
  begin
    perform public.armory_enqueue('us','guild','invalid--slug','submit');
    raise exception 'empty slug segment accepted';
  exception when check_violation then null; end;
end $$;

-- A later roster must not restore a hidden character. Replacements remove departed members.
do $$ begin
  if public.armory_upsert_guild('us','{"slug":"fable-watch","guild_id":1,"name":"Fable Watch","faction":"Alliance","ruleset_id":1,"ruleset":"PvP","member_count":1}',
    '[{"character_slug":"xelra-fable","name":"Xelra","surname":"Fable"}]')<>0 then raise exception 'hidden roster queued'; end if;
  if exists(select 1 from public.armory_roster('us','fable-watch')) then raise exception 'hidden roster restored'; end if;
end $$;
update public.armory_guilds set checked_at=now()-interval '21 days';
select public.armory_retry('us','guild','fable-watch',interval '2 hours');
do $$ begin
  if exists(select 1 from public.armory_take('us','guild',10) where slug='fable-watch') then raise exception 'guild retry bypassed'; end if;
  if not exists(select 1 from public.armory_queue where slug='fable-watch' and tries=1) then raise exception 'stale retry not queued'; end if;
  update public.armory_queue set next_at=now() where region='us' and kind='guild' and slug='fable-watch';
  if not exists(select 1 from public.armory_take('us','guild',100) where slug='fable-watch' and stored) then raise exception 'queued guild stored flag'; end if;
  update public.armory_guilds set fetched_at=now()-interval '31 days' where region='us' and slug='fable-watch';
  if public.armory_touch('us','guild',array['fable-watch'])<>1 then raise exception 'guild touch'; end if;
  if not exists(select 1 from public.armory_guild('us','fable-watch') where checked_at=now()) then raise exception 'guild touch time'; end if;
  if exists(select 1 from public.armory_queue where slug='fable-watch') then raise exception '304 queue left'; end if;
  perform public.armory_purge();
  if not exists(select 1 from public.armory_guild('us','fable-watch')) then raise exception 'refreshed guild purged'; end if;
end $$;
select public.armory_missing('us','guild','fable-watch');
do $$ begin if exists(select 1 from public.armory_guild('us','fable-watch')) then raise exception 'guild 404'; end if; end $$;

-- The service role uses RPCs, never direct table reads; browser roles cannot call RPCs.
set local role anon;
do $$ begin
  begin perform public.armory_counts(); raise exception 'anon RPC succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform public.armory_enqueue('us','character','blocked-fable','submit'); raise exception 'authenticated RPC succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
select * from public.armory_counts();
do $$ begin
  begin perform * from public.armory_characters; raise exception 'direct service read succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Batch bounds and ties: null metrics are omitted and own ranks are not capped at the top 100.
do $$
declare batch jsonb; rejected boolean := false;
begin
  select jsonb_agg((select rows->0 from armory_fixture) || jsonb_build_object('slug','bulk-'||n,'character_id',n,
    'item_level',50,'gear_score',null,'honorable_kills',null,'last_login',case when n=101 then '2026-11-08T00:00:00Z' else null end))
    into batch from generate_series(1,101) n;
  if public.armory_upsert_characters('eu',batch)<>101 then raise exception 'bulk count'; end if;
  if (select count(*) from public.armory_board('item_level','eu',1::smallint,200))<>100 then raise exception 'board cap'; end if;
  if not exists(select 1 from public.armory_board('item_level','eu',1::smallint,1) where slug='bulk-101') then raise exception 'login tiebreak'; end if;
  if exists(select 1 from public.armory_board('gear_score',null,null,100)) then raise exception 'null metric on board'; end if;
  if not exists(select 1 from public.armory_rank('eu','bulk-99') where metric='item_level' and rank=1 and "of"=101) then raise exception 'tied rank or population inconsistent'; end if;
  perform public.armory_upsert_characters('eu',jsonb_build_array((select rows->0 from armory_fixture) || '{"slug":"above-ties","item_level":60,"gear_score":null,"honorable_kills":null}'::jsonb));
  if not exists(select 1 from public.armory_rank('eu','bulk-99') where metric='item_level' and rank=2 and "of"=102) then raise exception 'strictly greater rank'; end if;
  perform public.armory_upsert_characters('eu',jsonb_build_array((select rows->0 from armory_fixture) || '{"slug":"other-ruleset","ruleset_id":2,"item_level":90}'::jsonb));
  perform public.armory_upsert_characters('us',jsonb_build_array((select rows->0 from armory_fixture) || '{"slug":"other-region","item_level":90}'::jsonb));
  if not exists(select 1 from public.armory_rank('eu','bulk-99') where metric='item_level' and rank=2 and "of"=102) then raise exception 'rank scope'; end if;
  perform public.armory_upsert_characters('eu',jsonb_build_array((select rows->0 from armory_fixture) || '{"slug":"below-board","item_level":1,"gear_score":null,"honorable_kills":null}'::jsonb));
  if not exists(select 1 from public.armory_rank('eu','below-board') where metric='item_level' and rank=103 and "of"=103) then raise exception 'rank capped at board limit'; end if;
  select jsonb_agg((select rows->0 from armory_fixture)) into batch from generate_series(1,501);
  begin perform public.armory_upsert_characters('eu',batch);
  exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception '501-row batch accepted'; end if;
end $$;

rollback;
