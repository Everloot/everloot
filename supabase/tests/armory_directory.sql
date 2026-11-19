begin;
-- Every name, guild and realm in these fixtures is invented.
insert into public.armory_characters(region,slug,character_id,name,surname,level,ruleset_id,ruleset,race_id,race,class_id,class,faction,guild_name,gear_score,item_level,fetched_at,checked_at)
values
 ('us','arla-quill',1,'Arla','Quill',40,1,'PvP',1,'Human',8,'Mage','Alliance','Quill Watch',90,45,'2026-11-10','2026-11-10'),
 ('eu','velkara-mire',2,'Velkara','Mire',60,2,'Normal',8,'Troll',3,'Hunter','Horde','Ember Wardens',60,70,'2026-11-11','2026-11-11'),
 ('eu','brin-mire',3,'Brin','Mire',20,2,'Normal',8,'Troll',3,'Hunter','Horde',null,null,null,'2026-11-12','2026-11-12'),
 ('eu','hidden-quill',4,'Hidden','Quill',60,2,'Normal',8,'Troll',3,'Hunter','Horde','Ember Wardens',99,99,'2026-11-12','2026-11-12');
-- Read-time protection even if an old hidden row is still present.
insert into public.armory_hides(region,slug) values('eu','hidden-quill');
do $$
declare r record; s text;
begin
  select * into r from public.armory_directory(null,null,null,null,null,null,null,null,null,'gear_score',1,0);
  if r.slug<>'arla-quill' or r.total<>3 or r.gear_score<>90 then raise exception 'default gear order/count %',r; end if;
  if (select array_agg(slug) from public.armory_directory(null,null,null,null,null,null,null,null,null,'gear_score',25,0))
    <>array['arla-quill','velkara-mire','brin-mire'] then raise exception 'gear order nulls last'; end if;
  if (select slug from public.armory_directory(null,null,null,null,null,null,null,null,null,'item_level',1,0))<>'velkara-mire' then raise exception 'item sort'; end if;
  if (select slug from public.armory_directory(null,null,null,null,null,null,null,null,null,'level',1,0))<>'velkara-mire' then raise exception 'level sort'; end if;
  if (select slug from public.armory_directory(null,null,null,null,null,null,null,null,null,'name',1,0))<>'arla-quill' then raise exception 'name sort'; end if;
  if (select slug from public.armory_directory(null,null,null,null,null,null,null,null,null,'fetched_at',1,0))<>'brin-mire' then raise exception 'read sort'; end if;
  select * into r from public.armory_directory('v','hUnTeR','troll','horde','eu',2::smallint,50,60,'eMb','gear_score',25,0);
  if r.slug is distinct from 'velkara-mire' or r.total<>1 then raise exception 'combined filters %',r; end if;
  if (select array_agg(slug) from public.armory_directory(null,'Mage',null,null,null,null,null,null,null,'name',25,0))<>array['arla-quill'] then raise exception 'class'; end if;
  if (select array_agg(slug) from public.armory_directory(null,null,'Human',null,null,null,null,null,null,'name',25,0))<>array['arla-quill'] then raise exception 'race'; end if;
  if (select array_agg(slug) from public.armory_directory(null,null,null,'Alliance',null,null,null,null,null,'name',25,0))<>array['arla-quill'] then raise exception 'faction'; end if;
  if (select array_agg(slug) from public.armory_directory(null,null,null,null,'us',null,null,null,null,'name',25,0))<>array['arla-quill'] then raise exception 'region'; end if;
  if (select array_agg(slug) from public.armory_directory(null,null,null,null,null,1::smallint,null,null,null,'name',25,0))<>array['arla-quill'] then raise exception 'ruleset'; end if;
  if (select array_agg(slug) from public.armory_directory(null,null,null,null,null,null,null,null,'Quill','name',25,0))<>array['arla-quill'] then raise exception 'guild'; end if;
  if (select array_agg(slug) from public.armory_directory(null,null,null,null,null,null,41,null,null,'name',25,0))<>array['velkara-mire'] then raise exception 'min level'; end if;
  if (select array_agg(slug) from public.armory_directory(null,null,null,null,null,null,null,30,null,'name',25,0))<>array['brin-mire'] then raise exception 'max level'; end if;
  if (select count(*) from public.armory_directory('mire',null,null,null,null,null,null,null,null,'name',25,0))<>2 then raise exception 'surname prefix'; end if;
  if (select count(*) from public.armory_directory('Velkara Mi',null,null,null,null,null,null,null,null,'name',25,0))<>1 then raise exception 'full name prefix'; end if;
  for s in select unnest(array['%','_','a\','a1']) loop
    if exists(select 1 from public.armory_directory(s,null,null,null,null,null,null,null,null,'name',25,0)) then raise exception 'unsafe prefix %',s; end if;
  end loop;
  if exists(select 1 from public.armory_directory(null,null,null,null,null,null,null,null,'Em%','name',25,0)) then raise exception 'guild wildcard'; end if;
  if exists(select 1 from public.armory_directory(null,null,null,null,null,null,60,20,null,'name',25,0)) then raise exception 'reversed levels'; end if;
  select * into r from public.armory_directory(null,null,null,null,null,null,null,null,null,'gear_score',1,1);
  if r.slug<>'velkara-mire' or r.total<>3 then raise exception 'paging/count'; end if;
  if exists(select 1 from public.armory_directory(null,null,null,null,null,null,null,null,null,'name',25,100)) then raise exception 'past last page'; end if;
  if exists(select 1 from public.armory_directory(null,null,null,null,null,null,null,null,null,'name',-1,0)) then raise exception 'negative limit'; end if;
  if (select count(*) from public.armory_directory(null,null,null,null,null,null,null,null,null,'name',25,-1))<>3 then raise exception 'negative offset'; end if;
  if has_function_privilege('anon','public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer)','execute')
    or has_function_privilege('authenticated','public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer)','execute')
    or not has_function_privilege('service_role','public.armory_directory(text,text,text,text,text,smallint,integer,integer,text,text,integer,integer)','execute') then raise exception 'grants'; end if;
end $$;
-- An accented name remains searchable.
insert into public.armory_characters(region,slug,character_id,name,surname,level,ruleset_id,ruleset,race_id,race,class_id,class,faction,gear_score,fetched_at,checked_at)
values ('us','elara-brun',5,'Élara','Brún',60,1,'PvP',1,'Human',8,'Mage','Alliance',90,'2026-11-10','2026-11-10');
do $$
begin
  if (select slug from public.armory_directory('Él',null,null,null,null,null,null,null,null,'name',25,0)) is distinct from 'elara-brun' then raise exception 'accented prefix'; end if;
end $$;
rollback;
