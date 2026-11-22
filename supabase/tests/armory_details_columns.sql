-- Run after every migration up to 20261122100000_armory_details_columns.sql on a disposable database. Invented
-- identities only. Everything is rolled back at the end.
begin;
select public.armory_upsert_characters('eu', jsonb_build_array(
  jsonb_build_object('slug','xelra-fable','character_id',831,'name','Xelra','surname','Fable','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance','equipment','[]'::jsonb,
    'details', jsonb_build_object('revision',1,
      'quests', jsonb_build_object('asOf', to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'completed', '[1]'::jsonb),
      'playHistory', jsonb_build_object('asOf', to_char(now() at time zone 'UTC' - interval '40 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'groups', '[]'::jsonb, 'ranked', '{"quests":5}'::jsonb))),
  jsonb_build_object('slug','zovra-fable','character_id',832,'name','Zovra','surname','Fable','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',2,'race','Orc','class_id',1,'class','Warrior','faction','Horde','equipment','[]'::jsonb,
    'details', jsonb_build_object('revision',1,'retry',true,
      'quests', jsonb_build_object('asOf', to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'completed', '[2]'::jsonb))),
  jsonb_build_object('slug','nilra-fable','character_id',833,'name','Nilra','surname','Fable','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',1,'race','Human','class_id',5,'class','Priest','faction','Alliance','equipment','[]'::jsonb,
    'details', '{"revision":2}'::jsonb),
  jsonb_build_object('slug','torva-fable','character_id',834,'name','Torva','surname','Fable','level',60,'ruleset_id',1,'ruleset','PvP',
    'race_id',2,'race','Orc','class_id',1,'class','Warrior','faction','Horde','equipment','[]'::jsonb,
    'details', '{"revision":1}'::jsonb)
));

do $$
declare oldest text; d jsonb;
begin
  -- The small columns follow details: the oldest section's read time, the revision and the retry mark.
  select details_oldest into oldest from public.armory_characters where region='eu' and slug='xelra-fable';
  if oldest is distinct from (select details#>>'{playHistory,asOf}' from public.armory_characters where region='eu' and slug='xelra-fable') then
    raise exception 'details_oldest %', oldest; end if;
  if (select details_oldest from public.armory_characters where region='eu' and slug='torva-fable') is not null then
    raise exception 'details_oldest without sections'; end if;
  if not (select details_retry from public.armory_characters where region='eu' and slug='zovra-fable') then raise exception 'details_retry'; end if;
  if (select details_retry from public.armory_characters where region='eu' and slug='xelra-fable') then raise exception 'details_retry false'; end if;
  if (select details_revision from public.armory_characters where region='eu' and slug='nilra-fable') is distinct from '2' then
    raise exception 'details_revision'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='armory_characters_details_oldest') then
    raise exception 'details_oldest index'; end if;

  -- Purge drops a play history older than 30 days and keeps the fresh sections and rows.
  perform public.armory_purge();
  select details into d from public.armory_characters where region='eu' and slug='xelra-fable';
  if d ? 'playHistory' then raise exception 'stale play history kept'; end if;
  if not d ? 'quests' then raise exception 'fresh section dropped'; end if;
  if (select quests_completed from public.armory_characters where region='eu' and slug='xelra-fable') is not null then
    raise exception 'ranked column outlived its play history'; end if;
  if not exists(select 1 from public.armory_characters where region='eu' and slug='zovra-fable' and details ? 'quests') then
    raise exception 'fresh row touched'; end if;

  -- Take still picks a retry older than an hour and a details revision the crawler does not write, and nothing fresh.
  update public.armory_characters set checked_at=now()-interval '2 hours' where region='eu';
  if not exists(select 1 from public.armory_take('eu','character',10) where slug='zovra-fable') then raise exception 'retry not taken'; end if;
  if not exists(select 1 from public.armory_take('eu','character',10) where slug='nilra-fable') then raise exception 'revision not taken'; end if;
  if exists(select 1 from public.armory_take('eu','character',10) where slug='torva-fable') then raise exception 'fresh row taken'; end if;
  if has_function_privilege('anon','public.armory_purge()','EXECUTE') or not has_function_privilege('service_role','public.armory_take(text,text,integer)','EXECUTE') then
    raise exception 'grants'; end if;
end $$;
rollback;
