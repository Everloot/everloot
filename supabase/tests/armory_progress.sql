-- Disposable database with the armory progress migration applied. Invented identities only.
begin;
select public.armory_upsert_characters('us','[{"slug":"ember-vale","character_id":9001,"name":"Ember","surname":"Vale","level":26,"ruleset_id":1,"ruleset":"PvP","race_id":8,"race":"Troll","class_id":9,"class":"Warlock","faction":"Horde","equipment":[],"details":{"revision":1}}]');
update public.armory_characters set details=jsonb_build_object('revision',1,
  'achievements',jsonb_build_object('asOf',to_char(now() at time zone 'UTC'-interval '31 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'rows','[]'::jsonb),
  'reputations',jsonb_build_object('asOf',to_char(now() at time zone 'UTC'-interval '31 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'rows','[]'::jsonb),
  'quests',jsonb_build_object('asOf',to_char(now() at time zone 'UTC'-interval '31 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'completed','[1,2]'::jsonb),
  'statistics',jsonb_build_object('asOf',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'rows','[]'::jsonb));
select public.armory_purge();
do $$ begin
  if exists(select 1 from public.armory_characters where details ?| array['achievements','reputations','quests']) then raise exception 'expired progress section retained'; end if;
  if not exists(select 1 from public.armory_characters where details ? 'statistics') then raise exception 'fresh section removed'; end if;
  if not exists(select 1 from public.armory_characters where slug='ember-vale') then raise exception 'character removed with its sections'; end if;
end $$;
do $$ begin
  if has_function_privilege('anon','public.armory_purge()','EXECUTE') or has_function_privilege('authenticated','public.armory_purge()','EXECUTE') then raise exception 'public purge access'; end if;
  if not has_function_privilege('service_role','public.armory_purge()','EXECUTE') then raise exception 'missing server purge access'; end if;
end $$;
rollback;
