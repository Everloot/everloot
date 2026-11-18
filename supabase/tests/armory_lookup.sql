-- Disposable database, all migrations applied, roles anon/authenticated/service_role present.
-- The on-demand lookup's storage (#1270): which regions may be asked, the six-hour miss, and the 'lookup' quota.
begin;

do $$
declare
  f regprocedure;
  t timestamptz;
  r record;
  n integer;
begin
  foreach f in array array['public.armory_lookup_regions(text)'::regprocedure, 'public.armory_lookup_miss(text)'::regprocedure] loop
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception '% is public', f; end if;
    if not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'server cannot call %', f; end if;
    if not (select prosecdef and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid=f) then raise exception 'unsafe %', f; end if;
  end loop;
  if has_table_privilege('service_role','public.armory_lookup_misses','SELECT') or has_table_privilege('anon','public.armory_lookup_misses','SELECT') then
    raise exception 'misses table readable outside its functions';
  end if;

  -- Invented fixtures. Nothing stored or hidden: both regions, US first.
  if public.armory_lookup_regions('nera-ashcombe') <> array['us','eu'] then raise exception 'fresh slug %', public.armory_lookup_regions('nera-ashcombe'); end if;
  -- A stored character is never asked for again in its region.
  perform public.armory_upsert_characters('eu', jsonb_build_array(jsonb_build_object('slug','nera-ashcombe','character_id',905,'name','Nera','surname','Ashcombe','level',22,
    'ruleset_id',1,'ruleset','PvP','race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance','equipment','[]'::jsonb)));
  if public.armory_lookup_regions('nera-ashcombe') <> array['us'] then raise exception 'stored region asked'; end if;
  -- A hidden slug is never asked for in its region.
  perform public.armory_hide('us','nera-ashcombe');
  if public.armory_lookup_regions('nera-ashcombe') <> '{}'::text[] then raise exception 'hidden region asked'; end if;
  -- A hidden character found while the lookup ran is not written.
  if public.armory_upsert_characters('us', jsonb_build_array(jsonb_build_object('slug','nera-ashcombe','character_id',906,'name','Nera','surname','Ashcombe','level',22,
    'ruleset_id',1,'ruleset','PvP','race_id',1,'race','Human','class_id',8,'class','Mage','faction','Alliance','equipment','[]'::jsonb))) <> 0 then
    raise exception 'hidden lookup hit written';
  end if;

  -- A miss is kept: no region is asked until it runs out; asking again only extends it.
  perform public.armory_lookup_miss('orla-fenwick');
  if public.armory_lookup_regions('orla-fenwick') <> '{}'::text[] then raise exception 'miss not kept'; end if;
  perform public.armory_lookup_miss('orla-fenwick');
  select until into t from public.armory_lookup_misses where slug='orla-fenwick';
  if t < now() + interval '5 hours 59 minutes' or t > now() + interval '6 hours 1 minute' then raise exception 'miss kept for %', t - now(); end if;
  update public.armory_lookup_misses set until = now() - interval '1 second' where slug='orla-fenwick';
  if public.armory_lookup_regions('orla-fenwick') <> array['us','eu'] then raise exception 'expired miss still kept'; end if;
  -- The next miss drops expired ones.
  perform public.armory_lookup_miss('brin-holloway');
  if exists(select 1 from public.armory_lookup_misses where slug='orla-fenwick') then raise exception 'expired miss not dropped'; end if;

  -- Bad slugs: no regions, and a miss is refused.
  if public.armory_lookup_regions('Nera Ashcombe') <> '{}'::text[] or public.armory_lookup_regions(null) <> '{}'::text[]
    or public.armory_lookup_regions(repeat('a',65)) <> '{}'::text[] then
    raise exception 'bad slug answered';
  end if;
  begin
    perform public.armory_lookup_miss('nera%');
    raise exception 'bad miss kept';
  exception when raise_exception then
    if sqlerrm = 'bad miss kept' then raise; end if;
  end;

  -- The 'lookup' quota: 20 an hour per address; the global bucket counts every address.
  for n in 1..20 loop
    select * into r from public.consume_intake_quota('lookup', repeat('a',64));
    if not r.allowed then raise exception 'lookup % refused', n; end if;
  end loop;
  select * into r from public.consume_intake_quota('lookup', repeat('a',64));
  if r.allowed or r.retry_after < 1 then raise exception 'lookup 21 allowed'; end if;
  select * into r from public.consume_intake_quota('lookup', repeat('b',64));
  if not r.allowed then raise exception 'other address refused'; end if;
  if (select count from public.intake_quota_buckets where bucket='lookup_global') <> 21 then raise exception 'global lookup count'; end if;
  update public.intake_quota_buckets set count = 300 where bucket='lookup_global';
  select * into r from public.consume_intake_quota('lookup', repeat('c',64));
  if r.allowed then raise exception 'global lookup limit ignored'; end if;
  -- The other scopes are unchanged.
  select * into r from public.consume_intake_quota('market', repeat('a',64));
  if not r.allowed then raise exception 'market scope broken'; end if;
end;
$$;

rollback;
