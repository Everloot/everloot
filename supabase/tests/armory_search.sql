-- Disposable database, all migrations applied, roles anon/authenticated/service_role present.
-- armory_search finds a character by first name, surname or the full name, and never a hidden one (#1270).
begin;

do $$
declare
  f regprocedure := 'public.armory_search(text,integer)'::regprocedure;
  q text;
  slugs text[];
begin
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'armory_search is public'; end if;
  if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'server cannot search'; end if;
  if not (select prosecdef and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid=f) then raise exception 'unsafe armory_search'; end if;

  -- Invented fixtures: two regions, one character to hide.
  perform public.armory_upsert_characters('us', jsonb_build_array(
    jsonb_build_object('slug','volvik-morningstar','character_id',901,'name','Volvik','surname','Morningstar','level',31,
      'ruleset_id',1,'ruleset','PvP','race_id',1,'race','Human','class_id',1,'class','Warrior','faction','Alliance','equipment','[]'::jsonb),
    jsonb_build_object('slug','orla-volvikson','character_id',902,'name','Orla','surname','Volvikson','level',20,
      'ruleset_id',1,'ruleset','PvP','race_id',1,'race','Human','class_id',1,'class','Warrior','faction','Alliance','equipment','[]'::jsonb),
    jsonb_build_object('slug','volvik-hushwood','character_id',903,'name','Volvik','surname','Hushwood','level',12,
      'ruleset_id',2,'ruleset','Normal','race_id',1,'race','Human','class_id',1,'class','Warrior','faction','Alliance','equipment','[]'::jsonb)));
  perform public.armory_upsert_characters('eu', jsonb_build_array(
    jsonb_build_object('slug','volvik-morningstar','character_id',904,'name','Volvik','surname','Morningstar','level',60,
      'ruleset_id',2,'ruleset','Normal','race_id',2,'race','Orc','class_id',1,'class','Warrior','faction','Horde','equipment','[]'::jsonb)));
  perform public.armory_hide('us','volvik-hushwood');
  -- A row that slipped in after its hide is still never returned.
  insert into public.armory_characters(region,slug,character_id,name,surname,level,ruleset_id,ruleset,race_id,race,class_id,class,faction,fetched_at,checked_at)
    values('us','volvik-hushwood',903,'Volvik','Hushwood',12,2,'Normal',1,'Human',1,'Warrior','Alliance',now(),now());

  -- First name, surname, a surname prefix and the full name, in any case and spacing, all find Volvik Morningstar.
  foreach q in array array['Volvik','Morningstar','morning','Volvik Morningstar','  volvik   MORNINGSTAR ','volvik morn'] loop
    if not exists(select 1 from public.armory_search(q,25) where region='us' and slug='volvik-morningstar') then raise exception 'us miss for %', q; end if;
    if not exists(select 1 from public.armory_search(q,25) where region='eu' and slug='volvik-morningstar') then raise exception 'eu miss for %', q; end if;
    if exists(select 1 from public.armory_search(q,25) where slug='volvik-hushwood') then raise exception 'hidden character returned for %', q; end if;
  end loop;

  -- "Volvik" also starts a surname; "Volvik Morningstar" does not start Orla Volvikson's names.
  select array_agg(region||'/'||slug order by name,surname,region,slug) into slugs from public.armory_search('volvik',25);
  if slugs <> array['us/orla-volvikson','eu/volvik-morningstar','us/volvik-morningstar'] then raise exception 'volvik order %', slugs; end if;
  if exists(select 1 from public.armory_search('Volvik Morningstar',25) where slug='orla-volvikson') then raise exception 'full name over-matched'; end if;
  if exists(select 1 from public.armory_search('Morningstar Volvik',25)) then raise exception 'reversed name matched'; end if;

  -- The old rules: 2 characters at least, no LIKE wildcards, the limit.
  if exists(select 1 from public.armory_search('V',25)) or exists(select 1 from public.armory_search(' V ',25)) then raise exception 'one letter matched'; end if;
  if exists(select 1 from public.armory_search('Vo%',25)) or exists(select 1 from public.armory_search('V_lvik',25)) then raise exception 'wildcard matched'; end if;
  if exists(select 1 from public.armory_search(null,25)) then raise exception 'null matched'; end if;
  if (select count(*) from public.armory_search('volvik',1)) <> 1 then raise exception 'limit ignored'; end if;
end $$;

-- Each searchable column has a pattern index.
do $$
begin
  if (select count(*) from pg_indexes where schemaname='public' and tablename='armory_characters'
      and indexname in ('armory_characters_name','armory_characters_surname','armory_characters_full_name')
      and indexdef like '%text_pattern_ops%') <> 3 then raise exception 'search indexes missing'; end if;
end $$;

rollback;
