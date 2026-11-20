-- Invented characters only; rollback leaves no fixture behind.
begin;
select public.armory_upsert_characters('eu', '[
 {"slug":"xelra-fable","character_id":811,"name":"Xelra","surname":"Fable","level":60,"ruleset_id":2,"ruleset":"Normal","race_id":1,"race":"Human","class_id":8,"class":"Mage","faction":"Alliance","gear_score":50,"item_level":40,"honorable_kills":10,"guild_slug":"fable-watch","guild_name":"Fable Watch","last_login":"2026-11-17T00:00:00Z","equipment":[]},
 {"slug":"zelra-fable","character_id":812,"name":"Zelra","surname":"Fable","level":60,"ruleset_id":2,"ruleset":"Normal","race_id":1,"race":"Human","class_id":8,"class":"Mage","faction":"Alliance","gear_score":50,"item_level":40,"honorable_kills":11,"last_login":"2026-11-18T00:00:00Z","equipment":[]},
 {"slug":"torva-fable","character_id":813,"name":"Torva","surname":"Fable","level":60,"ruleset_id":1,"ruleset":"PvP","race_id":2,"race":"Orc","class_id":1,"class":"Warrior","faction":"Horde","gear_score":90,"item_level":80,"honorable_kills":90,"equipment":[]},
 {"slug":"nilra-fable","character_id":814,"name":"Nilra","surname":"Fable","level":60,"ruleset_id":2,"ruleset":"Normal","race_id":1,"race":"Human","class_id":5,"class":"Priest","faction":"Alliance","equipment":[]}
]'::jsonb);
do $$
declare n integer; r record; f regprocedure;
begin
  select * into r from public.armory_board_filtered('gear_score','eu',2::smallint,'Mage','Alliance',1);
  if r.slug <> 'zelra-fable' or r.rank <> 1 then raise exception 'filter/tie/rank failed'; end if;
  select count(*) into n from public.armory_board_filtered('gear_score','us',null,null,null,100);
  if n <> 0 then raise exception 'region failed'; end if;
  select count(*) into n from public.armory_board_filtered('gear_score','eu',1::smallint,'Mage',null,100);
  if n <> 0 then raise exception 'ruleset failed'; end if;
  select count(*) into n from public.armory_board_filtered('gear_score',null,null,null,'Horde',100);
  if n <> 1 then raise exception 'faction failed'; end if;
  select count(*) into n from public.armory_board_filtered('gear_score',null,null,null,null,-1);
  if n <> 0 then raise exception 'limit failed'; end if;
  select count(*) into n from public.armory_board_top_per_class('gear_score',null,null);
  if n <> 2 then raise exception 'one per scored class failed'; end if;
  select * into r from public.armory_board_top_per_class('honorable_kills','eu',2::smallint);
  if r.slug <> 'zelra-fable' then raise exception 'metric/ruleset failed'; end if;
  select * into r from public.armory_board_filtered('item_level','eu',2::smallint,'Mage',null,100) where slug='xelra-fable';
  if r.guild_slug <> 'fable-watch' then raise exception 'guild slug lost'; end if;
  -- A hide marker excludes a row even if it still exists at read time.
  insert into public.armory_hides(region,slug) values ('eu','zelra-fable');
  select * into r from public.armory_board_top_per_class('gear_score','eu',2::smallint);
  if r.slug <> 'xelra-fable' then raise exception 'winner hide failed'; end if;
  select count(*) into n from public.armory_board_filtered('gear_score','eu',null,null,null,100) where slug='zelra-fable';
  if n <> 0 then raise exception 'filtered hide failed'; end if;
  insert into public.armory_characters(region,slug,character_id,name,surname,level,ruleset_id,ruleset,race_id,race,class_id,class,faction,gear_score,fetched_at,checked_at)
    select 'eu','torva-'||i,9000+i,'Torva','Fable',60,1,'PvP',2,'Orc',1,'Warrior','Horde',100+i,now(),now() from generate_series(1,101) i;
  select count(*) into n from public.armory_board_filtered('gear_score',null,null,null,null,999);
  if n <> 100 then raise exception '100 row cap failed'; end if;
  select count(*) into n from public.armory_board_top_per_class('gear_score',null,null) where class='Mage';
  if n <> 1 then raise exception 'class outside top 100 lost'; end if;
  for f in select oid::regprocedure from pg_proc where proname in ('armory_board_filtered','armory_board_top_per_class') loop
    if has_function_privilege('anon',f,'execute') or has_function_privilege('authenticated',f,'execute') then raise exception 'public access'; end if;
    if not has_function_privilege('service_role',f,'execute') then raise exception 'server access'; end if;
    if not (select prosecdef and proconfig @> array['search_path=""','lock_timeout=3s'] from pg_proc where oid=f) then raise exception 'unsafe function'; end if;
  end loop;
end $$;
rollback;
